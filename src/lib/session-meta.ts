/**
 * Deck-local metadata for sessions — pinned, foldered, archived, tagged,
 * renamed. Keyed by Hermes session id (or local: id). Persisted to
 * localStorage; never sent to Hermes (REBUILD_PLAN: "Implement
 * pin/folder/archive as Deck-local metadata keyed by Hermes session id").
 */

export interface SessionMeta {
  pinned?: boolean;
  folderId?: string;
  archived?: boolean;
  archivedAt?: string;
  customTitle?: string;
  tags?: string[];
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

export function loadMetaStore(): MetaStore {
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

export function saveMetaStore(store: MetaStore): void {
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
    && !merged.customTitle && !(merged.tags && merged.tags.length);
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

export function addFolder(store: MetaStore, name: string): { store: MetaStore; folder: Folder } {
  const folder: Folder = {
    id: `folder_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || '未命名分组',
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
      const isEmpty = !next.pinned && !next.archived && !next.customTitle && !(next.tags && next.tags.length);
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
  return (original || '').trim() || '新对话';
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
