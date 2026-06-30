// Read & write the Hermes per-profile configuration files for the deck's
// /config page: config.yaml, SOUL.md, memories/USER.md, memories/MEMORY.md.
//
// Every file lives under the resolved Hermes root — directly for the `default`
// profile, or under `<root>/profiles/<id>` for a named profile. All filesystem
// ops are rooted there: the relative path is built only from a validated profile
// id plus a fixed filename, then realpath-resolved and re-checked so a symlink
// can't escape the Hermes home.
//
// config.yaml is validated as YAML on save (via the same PyYAML that Hermes
// loads it with); a syntax error rejects the write. SOUL.md / USER.md /
// MEMORY.md have character budgets — those are surfaced to the UI but not
// enforced server-side (Hermes itself truncates / budgets them).

import { promises as fs } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { defaultHermesRoot, PROFILE_ID_RE } from './core';
import { runPython } from '../run-python';
import {
  CONFIG_FILE_META,
  type ConfigFileKey,
  type ConfigFileMeta,
  type DeckConfigBundle,
  type DeckConfigFile,
  type SaveConfigResult,
  configFileMeta,
  countConfigChars,
  charLimitFor,
} from '@/lib/config-files';

const MAX_CONFIG_BYTES = 1024 * 1024; // 1MB — far above any real config file.

interface ConfigError extends Error {
  code?: string;
  detail?: string;
  line?: number;
  col?: number;
}

function fail(message: string, code: string): never {
  const e = new Error(message) as ConfigError;
  e.code = code;
  throw e;
}

/** Validate a profile id before joining it into a filesystem path. */
function validateProfileId(raw: unknown): string {
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!id || id === '.' || id === '..' || !PROFILE_ID_RE.test(id)) {
    fail('invalid_profile', 'INVALID_PROFILE');
  }
  return id;
}

function profileBaseDir(profileId: string, root = defaultHermesRoot()): string {
  return profileId === 'default' ? root : join(root, 'profiles', profileId);
}

function displayBaseDir(profileId: string, root: string): string {
  return profileBaseDir(profileId, root);
}

function posixJoin(...parts: string[]): string {
  return parts.filter(Boolean).join('/');
}

/**
 * Resolve `child` and verify it stays inside `base`. When the file does not
 * exist yet (creating a new SOUL.md / memories/USER.md), walk up to the
 * nearest existing ancestor and check that instead.
 */
async function realpathInside(base: string, child: string): Promise<string> {
  const baseReal = await fs.realpath(base).catch(() => resolve(base));
  let childReal: string;
  try {
    childReal = await fs.realpath(child);
  } catch {
    let cur = resolve(child);
    let resolved = '';
    while (cur && cur !== resolve(cur, '..')) {
      try { resolved = await fs.realpath(cur); break; } catch { /* keep walking up */ }
      cur = resolve(cur, '..');
    }
    childReal = resolved || resolve(child);
  }
  const baseWithSep = baseReal.endsWith(sep) ? baseReal : baseReal + sep;
  if (childReal !== baseReal && !childReal.startsWith(baseWithSep)) {
    fail('path_escapes_base', 'PATH_ESCAPES_BASE');
  }
  return childReal;
}

interface RawFile {
  meta: ConfigFileMeta;
  content: string;
  size: number;
  mtime: string;
  exists: boolean;
  readOnly: boolean;
}

async function readConfigFile(root: string, base: string, meta: ConfigFileMeta): Promise<RawFile> {
  const abs = join(base, meta.subdir, meta.filename);
  try {
    await realpathInside(root, abs);
    const st = await fs.stat(abs);
    if (!st.isFile() || st.size > MAX_CONFIG_BYTES) {
      return { meta, content: '', size: st.size, mtime: st.mtime.toISOString(), exists: true, readOnly: true };
    }
    const content = await fs.readFile(abs, 'utf8');
    return {
      meta,
      content,
      size: st.size,
      mtime: st.mtime.toISOString(),
      exists: true,
      // POSIX owner-write bit — informational only; saves are still attempted.
      readOnly: (st.mode & 0o200) === 0,
    };
  } catch {
    return { meta, content: '', size: 0, mtime: '', exists: false, readOnly: false };
  }
}

async function readConfigYamlBody(base: string): Promise<string> {
  try {
    return await fs.readFile(join(base, 'config.yaml'), 'utf8');
  } catch {
    return '';
  }
}

/** Read all four config files for a profile, with limits + char counts. */
export async function readProfileConfig(profileIdRaw: string): Promise<DeckConfigBundle> {
  const profileId = validateProfileId(profileIdRaw);
  const root = defaultHermesRoot();
  const base = profileBaseDir(profileId, root);
  const display = displayBaseDir(profileId, root);

  const raw = await Promise.all(CONFIG_FILE_META.map((m) => readConfigFile(root, base, m)));
  const configBody = raw.find((r) => r.meta.key === 'config')?.content ?? '';

  const files: DeckConfigFile[] = raw.map((r) => ({
    key: r.meta.key,
    filename: r.meta.filename,
    displayPath: posixJoin(display, r.meta.subdir, r.meta.filename),
    kind: r.meta.kind,
    exists: r.exists,
    content: r.content,
    size: r.size,
    mtime: r.mtime,
    charCount: countConfigChars(r.meta.key, r.content),
    charLimit: charLimitFor(r.meta.key, configBody),
    readOnly: r.readOnly,
  }));

  return { profile: profileId, baseDir: display, files };
}

interface YamlCheck {
  ok: boolean;
  error?: string;
  line?: number;
  col?: number;
  skipped?: boolean;
}

/**
 * Validate config.yaml with PyYAML — the same parser Hermes loads it with —
 * so "valid here" means "loadable by Hermes". When the validator can't run
 * (no python / no pyyaml) the save is allowed rather than blocked on our
 * own infrastructure failure.
 */
async function validateYaml(content: string): Promise<YamlCheck> {
  const script = `
import os, json
content = os.environ.get("CONFIG_CONTENT", "")
out = {"ok": True}
_yaml = None
try:
    import yaml as _y
    _yaml = _y
except Exception:
    out = {"ok": True, "skipped": True}
if _yaml is not None:
    try:
        data = _yaml.safe_load(content)
        if data is not None and not isinstance(data, dict):
            out = {"ok": False, "error": "config.yaml top level must be a key/value mapping"}
    except _yaml.YAMLError as e:
        line = (str(e).splitlines() or [""])[0][:280]
        out = {"ok": False, "error": line or "invalid YAML"}
        mark = getattr(e, "problem_mark", None)
        if mark is not None:
            out["line"] = int(getattr(mark, "line", 0)) + 1
            out["col"] = int(getattr(mark, "column", 0)) + 1
    except Exception as e:
        out = {"ok": False, "error": (type(e).__name__ + ": " + str(e))[:280]}
print(json.dumps(out, ensure_ascii=False))
`;
  const r = await runPython<YamlCheck>(script, {
    timeoutMs: 8000,
    env: { CONFIG_CONTENT: content },
  });
  if (!r.ok) return { ok: true, skipped: true };
  return r.value;
}

export interface SaveConfigInput {
  profileId: string;
  fileKey: ConfigFileKey;
  content: unknown;
  /** Optimistic-lock token (mtime from the prior read). */
  mtime?: string;
}

/** Validate (config.yaml only) then atomically write a single config file. */
export async function saveProfileConfigFile(input: SaveConfigInput): Promise<SaveConfigResult> {
  const profileId = validateProfileId(input.profileId);
  const meta = configFileMeta(input.fileKey);
  if (typeof input.content !== 'string') fail('invalid_content', 'INVALID_CONTENT');
  const content = input.content as string;
  if (content.includes('\0')) fail('invalid_content', 'INVALID_CONTENT');
  if (Buffer.byteLength(content, 'utf8') > MAX_CONFIG_BYTES) {
    fail('content_too_large', 'CONTENT_TOO_LARGE');
  }

  let validationSkipped = false;
  if (meta.kind === 'yaml') {
    const v = await validateYaml(content);
    if (!v.ok) {
      const e = new Error('yaml_invalid') as ConfigError;
      e.code = 'YAML_INVALID';
      e.detail = v.error || 'invalid YAML';
      e.line = v.line;
      e.col = v.col;
      throw e;
    }
    validationSkipped = Boolean(v.skipped);
  }

  const root = defaultHermesRoot();
  const base = profileBaseDir(profileId, root);
  const dir = join(base, meta.subdir);
  const file = join(dir, meta.filename);
  await realpathInside(root, file);

  // Optimistic concurrency: reject if the file changed since it was read.
  if (input.mtime) {
    try {
      const cur = await fs.stat(file);
      if (cur.mtime.toISOString() !== input.mtime) {
        fail('mtime_mismatch', 'MTIME_MISMATCH');
      }
    } catch (err) {
      if ((err as ConfigError).code === 'MTIME_MISMATCH') throw err;
      // File absent — this is a create; nothing to lock against.
    }
  }

  // Atomic write: temp file + rename so a crash mid-write can't truncate a
  // good config. Mode 0o600 — these files can hold private agent context.
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  await fs.writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.rename(tmp, file);
  } catch (err) {
    try { await fs.unlink(tmp); } catch { /* best effort */ }
    throw err;
  }

  const st = await fs.stat(file);
  // Editing config.yaml can move the USER/MEMORY budgets, so re-derive the
  // limit from whatever config.yaml now says.
  const configBody = meta.key === 'config' ? content : await readConfigYamlBody(base);
  return {
    ok: true,
    key: meta.key,
    mtime: st.mtime.toISOString(),
    size: st.size,
    charCount: countConfigChars(meta.key, content),
    charLimit: charLimitFor(meta.key, configBody),
    validationSkipped: validationSkipped || undefined,
  };
}
