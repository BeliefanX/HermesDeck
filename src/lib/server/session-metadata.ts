import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Folder, MetaStore, SessionMeta } from '@/lib/session-meta';
import type { DeckSession } from '@/lib/types';

const STORE_VERSION = 1;
const MAX_META_SESSIONS_PER_SCOPE = 1000;
const MAX_FOLDERS_PER_SCOPE = 100;
const MAX_TAGS_PER_SESSION = 8;
const MAX_TAG_LENGTH = 24;
const MAX_TITLE_LENGTH = 160;
const MAX_FOLDER_NAME_LENGTH = 80;
const LOCK_STALE_MS = 5 * 60_000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;

type ScopeStore = MetaStore;

type SessionMetadataStore = {
  version: typeof STORE_VERSION;
  scopes: Record<string, ScopeStore>;
  createdAt: string;
  updatedAt: string;
};

function dataDir(): string {
  return process.env.HERMESDECK_DATA_DIR || process.env.HERMESDECK_AUTH_DIR || join(homedir(), '.hermesdeck');
}

function storeFile(): string {
  return join(dataDir(), 'session-metadata.v1.json');
}

function lockFile(): string {
  return `${storeFile()}.lock`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function emptyStore(): SessionMetadataStore {
  const now = nowIso();
  return { version: STORE_VERSION, scopes: {}, createdAt: now, updatedAt: now };
}

export function emptyMetaStore(): MetaStore {
  return { version: 1, byId: {}, folders: [] };
}

function ensureDataDir(): void {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  try { chmodSync(dataDir(), 0o700); } catch {}
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function isoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function scopeKey(userId: string, profileId: string): string {
  return `${encodeURIComponent(userId)}:${encodeURIComponent(profileId.trim() || 'default')}`;
}

function sanitizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const tag = stringValue(item, MAX_TAG_LENGTH);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS_PER_SESSION) break;
  }
  return out.length ? out : undefined;
}

function sanitizeSessionMeta(value: unknown, folderIds: Set<string>): SessionMeta | undefined {
  const rec = safeRecord(value);
  if (!rec) return undefined;
  const meta: SessionMeta = {};
  if (rec.pinned === true) meta.pinned = true;
  const folderId = stringValue(rec.folderId, 120);
  if (folderId && folderIds.has(folderId)) meta.folderId = folderId;
  if (rec.archived === true) {
    meta.archived = true;
    meta.archivedAt = isoTimestamp(rec.archivedAt) || nowIso();
  }
  const title = stringValue(rec.customTitle, MAX_TITLE_LENGTH);
  if (title) meta.customTitle = title;
  const tags = sanitizeTags(rec.tags);
  if (tags) meta.tags = tags;
  // `goal` remains browser-local because it affects outgoing prompt behavior and
  // is unrelated to the session-list expanded menu metadata being synchronized.
  const isEmpty = !meta.pinned && !meta.folderId && !meta.archived && !meta.customTitle && !(meta.tags && meta.tags.length);
  return isEmpty ? undefined : meta;
}

function sanitizeFolder(value: unknown): Folder | null {
  const rec = safeRecord(value);
  if (!rec) return null;
  const id = stringValue(rec.id, 120);
  const name = stringValue(rec.name, MAX_FOLDER_NAME_LENGTH);
  if (!id || !name) return null;
  return {
    id,
    name,
    createdAt: isoTimestamp(rec.createdAt) || nowIso(),
  };
}

export function sanitizeMetaStore(value: unknown, knownSessionIds?: Iterable<string>): MetaStore {
  const rec = safeRecord(value);
  if (!rec) return emptyMetaStore();
  const folders: Folder[] = [];
  const seenFolders = new Set<string>();
  const rawFolders = Array.isArray(rec.folders) ? rec.folders : [];
  for (const raw of rawFolders) {
    const folder = sanitizeFolder(raw);
    if (!folder || seenFolders.has(folder.id)) continue;
    seenFolders.add(folder.id);
    folders.push(folder);
    if (folders.length >= MAX_FOLDERS_PER_SCOPE) break;
  }
  const allowedSessions = knownSessionIds ? new Set(knownSessionIds) : null;
  const byId: Record<string, SessionMeta> = {};
  let metaCount = 0;
  const rawById = safeRecord(rec.byId) || {};
  for (const [id, rawMeta] of Object.entries(rawById)) {
    const sessionId = stringValue(id, 240);
    if (!sessionId) continue;
    if (allowedSessions && !allowedSessions.has(sessionId) && !sessionId.startsWith('local:')) continue;
    const meta = sanitizeSessionMeta(rawMeta, seenFolders);
    if (!meta) continue;
    byId[sessionId] = meta;
    metaCount += 1;
    if (metaCount >= MAX_META_SESSIONS_PER_SCOPE) break;
  }
  return { version: 1, byId, folders };
}

function readStore(): SessionMetadataStore {
  ensureDataDir();
  const file = storeFile();
  if (!existsSync(file)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<SessionMetadataStore>;
    if (parsed?.version !== STORE_VERSION || !safeRecord(parsed.scopes)) return emptyStore();
    return {
      version: STORE_VERSION,
      scopes: parsed.scopes as Record<string, ScopeStore>,
      createdAt: stringValue(parsed.createdAt, 80) || nowIso(),
      updatedAt: stringValue(parsed.updatedAt, 80) || nowIso(),
    };
  } catch {
    return emptyStore();
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withStoreLock<T>(fn: () => T): T {
  ensureDataDir();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  const owner = `${process.pid}:${randomUUID()}`;
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = openSync(lockFile(), 'wx', 0o600);
      writeFileSync(fd, `${owner}\n${nowIso()}\n`);
      try { fsyncSync(fd); } catch {}
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;
      try {
        const stat = readFileSync(lockFile(), 'utf8');
        const ts = isoTimestamp(stat.split(/\r?\n/)[1]);
        if (!ts || Date.now() - new Date(ts).getTime() > LOCK_STALE_MS) {
          rmSync(lockFile(), { force: true });
          continue;
        }
      } catch {}
      if (Date.now() >= deadline) throw new Error('Timed out acquiring Deck session metadata store lock.');
      sleepSync(LOCK_RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch {}
      try {
        const currentOwner = readFileSync(lockFile(), 'utf8').split(/\r?\n/)[0];
        if (currentOwner === owner) rmSync(lockFile(), { force: true });
      } catch {}
    }
  }
}

function writeStore(store: SessionMetadataStore): void {
  ensureDataDir();
  const next = { ...store, updatedAt: nowIso() };
  const tmp = `${storeFile()}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch {}
  const fd = openSync(tmp, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, storeFile());
}

export function getSessionMetaStore(userId: string, profileId: string): MetaStore {
  const store = readStore();
  return sanitizeMetaStore(store.scopes[scopeKey(userId, profileId)] || emptyMetaStore());
}

export function putSessionMetaStore(userId: string, profileId: string, value: unknown, knownSessionIds?: Iterable<string>): MetaStore {
  const sanitized = sanitizeMetaStore(value, knownSessionIds);
  return withStoreLock(() => {
    const store = readStore();
    store.scopes[scopeKey(userId, profileId)] = sanitized;
    writeStore(store);
    return sanitized;
  });
}

export function patchSessionMetaStore(
  userId: string,
  profileId: string,
  updater: (store: MetaStore) => MetaStore,
): MetaStore {
  return withStoreLock(() => {
    const store = readStore();
    const key = scopeKey(userId, profileId);
    const current = sanitizeMetaStore(store.scopes[key] || emptyMetaStore());
    const next = sanitizeMetaStore(updater(current));
    store.scopes[key] = next;
    writeStore(store);
    return next;
  });
}

export function overlaySessionMetadata(sessions: DeckSession[], metaStore: MetaStore): DeckSession[] {
  return sessions.map((session) => {
    const meta = metaStore.byId[session.id];
    if (!meta) return session;
    return {
      ...session,
      title: meta.customTitle || session.title,
      pinned: meta.pinned,
      folderId: meta.folderId,
      archived: meta.archived,
      archivedAt: meta.archivedAt,
      customTitle: meta.customTitle,
      tags: meta.tags,
    };
  });
}
