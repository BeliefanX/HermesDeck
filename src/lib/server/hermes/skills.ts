// Read & write Hermes skill content from the deck UI.
//
// Skills live on disk under `~/.hermes/skills/` as either
//   <skills-root>/<name>/SKILL.md                  (root-level)
//   <skills-root>/<category>/<name>/SKILL.md       (categorized)
// We also recognize a per-profile skills directory at
//   ~/.hermes/profiles/<profile>/skills/<...>/SKILL.md
// but the "Tools" page currently only surfaces the global ones.
//
// Path safety: every filesystem op is rooted under a known base directory.
// The caller passes a *relative* path like `software-development/spike` (the
// directory containing SKILL.md). We reject anything with `..` or absolute
// roots, then realpath-resolve and re-check that the result is still inside
// the base — so a symlink pointing outside `~/.hermes/skills/` cannot escape.

import { promises as fs } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

const SKILLS_BASE = join(homedir(), '.hermes', 'skills');
const SKILL_FILENAME = 'SKILL.md';
const MAX_CONTENT_BYTES = 512 * 1024; // 512KB — comfortably above any real skill

export interface SkillIndexEntry {
  /** Relative path (POSIX-style) of the directory containing SKILL.md. */
  relPath: string;
  /** Skill name (last segment). */
  name: string;
  /** First path segment when nested, else undefined. */
  category?: string;
}

export interface SkillContent {
  relPath: string;
  name: string;
  category?: string;
  /** Raw SKILL.md text. */
  content: string;
  /** Filesystem mtime as ISO. Used as an optimistic-lock token on save. */
  mtime: string;
  /** Byte size on disk. */
  size: number;
  /** True if SKILL.md is read-only on disk (informational; saves still try). */
  readOnly?: boolean;
}

/** Validate a relative path before joining it against the base. Throws on
 *  anything that could escape — leading slash, `..` segment, NUL byte, or a
 *  weirdly long input. */
function normalizeRelPath(input: unknown): string {
  if (typeof input !== 'string') throw new Error('invalid_path');
  const s = input.trim();
  if (!s || s.length > 256) throw new Error('invalid_path');
  if (s.includes('\0')) throw new Error('invalid_path');
  if (s.startsWith('/') || s.startsWith('\\')) throw new Error('invalid_path');
  // Reject Windows drive letters — we're macOS/Linux but defensive parsing is cheap.
  if (/^[A-Za-z]:/.test(s)) throw new Error('invalid_path');
  const parts = s.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0 || parts.length > 6) throw new Error('invalid_path');
  for (const p of parts) {
    if (p === '..' || p === '.') throw new Error('invalid_path');
    if (!/^[A-Za-z0-9_.\- ]+$/.test(p)) throw new Error('invalid_path');
  }
  return parts.join('/');
}

async function realpathInside(base: string, child: string): Promise<string> {
  // The base may itself be a symlink (it isn't on a clean install, but we
  // resolve both sides anyway so the prefix comparison works either way).
  const baseReal = await fs.realpath(base).catch(() => resolve(base));
  let childReal: string;
  try {
    childReal = await fs.realpath(child);
  } catch {
    // The file may not exist yet (new skill). Walk up to the nearest existing
    // ancestor so we still verify we're inside the base.
    let cur = resolve(child);
    while (cur && cur !== resolve(cur, '..')) {
      try { childReal = await fs.realpath(cur); break; } catch {}
      cur = resolve(cur, '..');
    }
    childReal = childReal! || resolve(child);
  }
  const baseWithSep = baseReal.endsWith(sep) ? baseReal : baseReal + sep;
  if (childReal !== baseReal && !childReal.startsWith(baseWithSep)) {
    throw new Error('path_escapes_base');
  }
  return childReal;
}

/** Build an index of every SKILL.md under the global skills base. Used to
 *  attach `relPath` to the parsed `hermes skills list` rows so the UI can
 *  request content without re-deriving the path. */
export async function indexSkillFiles(): Promise<SkillIndexEntry[]> {
  const out: SkillIndexEntry[] = [];
  async function walk(dir: string, depth: number, segments: string[]): Promise<void> {
    if (depth > 4) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // If this directory contains SKILL.md, record it and stop descending —
    // skills are always leaves. (A nested skill under another skill would be
    // unusual but harmless to skip.)
    const hasSkill = entries.some((e) => e.isFile() && e.name === SKILL_FILENAME);
    if (hasSkill) {
      const name = segments[segments.length - 1] || '';
      const category = segments.length > 1 ? segments[0] : undefined;
      out.push({
        relPath: segments.join('/'),
        name,
        category,
      });
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      // `.archive` and other dot-prefixed dirs are deliberately hidden by Hermes.
      if (ent.name.startsWith('.')) continue;
      await walk(join(dir, ent.name), depth + 1, [...segments, ent.name]);
    }
  }
  await walk(SKILLS_BASE, 0, []);
  return out;
}

export async function readSkill(relPathRaw: unknown): Promise<SkillContent> {
  const relPath = normalizeRelPath(relPathRaw);
  const dir = join(SKILLS_BASE, ...relPath.split('/'));
  const dirReal = await realpathInside(SKILLS_BASE, dir);
  const file = join(dirReal, SKILL_FILENAME);
  await realpathInside(SKILLS_BASE, file);
  const stat = await fs.stat(file);
  if (stat.size > MAX_CONTENT_BYTES) {
    throw new Error(`skill_too_large (${stat.size} bytes, max ${MAX_CONTENT_BYTES})`);
  }
  const content = await fs.readFile(file, 'utf8');
  const segments = relPath.split('/');
  // POSIX read/write bits — `mode & 0o200` set means owner can write.
  const ownerWritable = (stat.mode & 0o200) !== 0;
  return {
    relPath,
    name: segments[segments.length - 1] || '',
    category: segments.length > 1 ? segments[0] : undefined,
    content,
    mtime: stat.mtime.toISOString(),
    size: stat.size,
    readOnly: !ownerWritable,
  };
}

export interface SaveSkillRequest {
  relPath: unknown;
  content: unknown;
  /** Optional optimistic-lock token from the prior read. When supplied and
   *  it doesn't match current mtime, the save is rejected. */
  mtime?: unknown;
}

export interface SaveSkillResult {
  ok: true;
  mtime: string;
  size: number;
}

export async function saveSkill(req: SaveSkillRequest): Promise<SaveSkillResult> {
  const relPath = normalizeRelPath(req.relPath);
  if (typeof req.content !== 'string') throw new Error('invalid_content');
  const content = req.content;
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_CONTENT_BYTES) {
    throw new Error(`content_too_large (${bytes} bytes, max ${MAX_CONTENT_BYTES})`);
  }
  const dir = join(SKILLS_BASE, ...relPath.split('/'));
  const dirReal = await realpathInside(SKILLS_BASE, dir);
  const file = join(dirReal, SKILL_FILENAME);
  await realpathInside(SKILLS_BASE, file);

  // Optimistic concurrency: if the caller passed an mtime, reject when the
  // on-disk file has been modified since they read it.
  if (typeof req.mtime === 'string' && req.mtime) {
    try {
      const cur = await fs.stat(file);
      if (cur.mtime.toISOString() !== req.mtime) {
        const e = new Error('mtime_mismatch');
        (e as { code?: string }).code = 'MTIME_MISMATCH';
        throw e;
      }
    } catch (err) {
      if ((err as { code?: string }).code === 'MTIME_MISMATCH') throw err;
      // File missing is OK — this is a create.
    }
  }

  // Write atomically: temp + rename, so a crash mid-write doesn't truncate
  // a perfectly good SKILL.md. The temp filename includes the pid + a random
  // suffix to avoid collisions if two saves race.
  const tmp = `${file}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(tmp, content, { encoding: 'utf8', mode: 0o644 });
  try {
    await fs.rename(tmp, file);
  } catch (e) {
    try { await fs.unlink(tmp); } catch {}
    throw e;
  }
  const stat = await fs.stat(file);
  return { ok: true, mtime: stat.mtime.toISOString(), size: stat.size };
}
