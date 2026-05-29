/**
 * Deck-local metadata for sessions — pinned, foldered, archived, tagged,
 * renamed. Keyed by Hermes session id (or local: id). Persisted to
 * localStorage; never sent to Hermes; pin/folder/archive state stays Deck-local
 * metadata keyed by Hermes session id.
 */

/**
 * Deck-side approximation of Hermes's `/goal` slash command. Hermes runs the
 * goal-pinning logic inside the gateway loop (gateway/run.py) and drives the
 * Ralph continuation loop from there — neither of which is reachable through
 * the api_server `/v1/responses` path that HermesDeck talks to. We provide a
 * UX-equivalent: when set + unpaused, every outgoing user message gets a
 * `[GOAL] ...` prefix so the model sees the standing target each turn.
 */
export interface SessionGoal {
  text: string;
  setAt: string;
  /** When set, the goal is silenced — kept in storage but not prepended. */
  pausedAt?: string;
}

export interface SessionMeta {
  pinned?: boolean;
  folderId?: string;
  archived?: boolean;
  archivedAt?: string;
  customTitle?: string;
  tags?: string[];
  goal?: SessionGoal;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
}

export interface MetaStore {
  version: 1;
  byId: Record<string, SessionMeta>;
  folders: Folder[];
}

export const META_STORAGE_KEY = 'hermesdeck.session.meta.v1';

export function emptyStore(): MetaStore {
  return { version: 1, byId: {}, folders: [] };
}

// Module-level singleton cache. The previous load/save pair re-parsed the
// JSON blob on every call; pages that read meta during render hit
// localStorage repeatedly per keystroke. We cache the parsed value and
// invalidate on save (or on cross-tab `storage` event below).
let _metaCache: MetaStore | null = null;

function readFromStorage(): MetaStore {
  if (typeof localStorage === 'undefined') return emptyStore();
  try {
    const raw = localStorage.getItem(META_STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as MetaStore;
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return emptyStore();
    return {
      version: 1,
      byId: parsed.byId || {},
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
    };
  } catch {
    return emptyStore();
  }
}

if (typeof window !== 'undefined') {
  // Cross-tab edits invalidate the cache so the next read picks up the
  // freshest value instead of returning a stale snapshot.
  window.addEventListener('storage', (e) => {
    if (e.key === META_STORAGE_KEY) _metaCache = null;
  });
}

export function loadMetaStore(): MetaStore {
  if (_metaCache) return _metaCache;
  _metaCache = readFromStorage();
  return _metaCache;
}

export function saveMetaStore(store: MetaStore): void {
  _metaCache = store;
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota or serialization failure — non-fatal. Worst case we lose this update.
  }
}

export function getMeta(store: MetaStore, sessionId: string): SessionMeta {
  return store.byId[sessionId] || {};
}

export function setMeta(store: MetaStore, sessionId: string, patch: Partial<SessionMeta>): MetaStore {
  const cur = store.byId[sessionId] || {};
  const merged: SessionMeta = { ...cur, ...patch };
  // Drop empty entries so the store doesn't grow unboundedly with cleared meta.
  const isEmpty = !merged.pinned && !merged.folderId && !merged.archived
    && !merged.customTitle && !(merged.tags && merged.tags.length) && !merged.goal;
  const byId = { ...store.byId };
  if (isEmpty) delete byId[sessionId];
  else byId[sessionId] = merged;
  return { ...store, byId };
}

export function clearMeta(store: MetaStore, sessionId: string): MetaStore {
  if (!store.byId[sessionId]) return store;
  const byId = { ...store.byId };
  delete byId[sessionId];
  return { ...store, byId };
}

/**
 * Drop meta entries for sessions the server no longer knows about. Without
 * this, deleting sessions from another device or via Hermes CLI leaves
 * orphaned localStorage entries that accumulate forever.
 *
 * Also clears `folderId` references that point at folders no longer in the
 * store — e.g. a folder deleted from another device. The session itself stays
 * (it still has its own metadata), it just falls back to the unfoldered list
 * instead of carrying a dangling pointer.
 */
export function gcMetaStore(store: MetaStore, knownSessionIds: Iterable<string>): MetaStore {
  const known = new Set(knownSessionIds);
  const knownFolders = new Set(store.folders.map((f) => f.id));
  let changed = false;
  const byId: Record<string, SessionMeta> = {};
  for (const [id, meta] of Object.entries(store.byId)) {
    // Keep entries we still know about, plus any local-only ids (the chat page
    // creates `local:...` ids before reconciling with the server).
    if (!(known.has(id) || id.startsWith('local:'))) {
      changed = true;
      continue;
    }
    if (meta.folderId && !knownFolders.has(meta.folderId)) {
      const { folderId: _drop, ...rest } = meta;
      void _drop;
      byId[id] = rest;
      changed = true;
    } else {
      byId[id] = meta;
    }
  }
  return changed ? { ...store, byId } : store;
}

export function addFolder(store: MetaStore, name: string): { store: MetaStore; folder: Folder } {
  const folder: Folder = {
    id: `folder_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || 'Untitled folder',
    createdAt: new Date().toISOString(),
  };
  return { store: { ...store, folders: [...store.folders, folder] }, folder };
}

export function renameFolder(store: MetaStore, folderId: string, name: string): MetaStore {
  return {
    ...store,
    folders: store.folders.map((f) => (f.id === folderId ? { ...f, name: name.trim() || f.name } : f)),
  };
}

export function deleteFolder(store: MetaStore, folderId: string): MetaStore {
  // Remove the folder definition AND clear folderId from all sessions in it.
  const byId: Record<string, SessionMeta> = {};
  for (const [id, meta] of Object.entries(store.byId)) {
    if (meta.folderId === folderId) {
      const next = { ...meta, folderId: undefined };
      const isEmpty = !next.pinned && !next.archived && !next.customTitle && !(next.tags && next.tags.length) && !next.goal;
      if (!isEmpty) byId[id] = next;
    } else {
      byId[id] = meta;
    }
  }
  return { ...store, folders: store.folders.filter((f) => f.id !== folderId), byId };
}

/** Display title — custom override falls back to the original title. */
export function effectiveTitle(meta: SessionMeta | undefined, original?: string): string {
  const custom = meta?.customTitle?.trim();
  if (custom) return custom;
  return (original || '').trim() || 'New chat';
}

/** Normalize a list of tags: trim, dedupe, drop empty, cap length. */
export function normalizeTags(input: string[] | string): string[] {
  const arr = Array.isArray(input) ? input : input.split(',');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of arr) {
    const t = String(raw).trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t.slice(0, 24));
    if (out.length >= 8) break;
  }
  return out;
}
