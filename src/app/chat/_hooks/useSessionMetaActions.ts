'use client';
import { useCallback } from 'react';
import {
  type MetaStore,
  addFolder,
  deleteFolder,
  getMeta,
  normalizeTags,
  renameFolder,
  setMeta,
  saveMetaStore,
} from '@/lib/session-meta';
import type { DeckMessage } from '@/lib/types';
import { deckApi } from '@/lib/api';
import type { ChatT } from '../_lib/i18n';
import type { LocalSession } from '../_lib/storage';

/**
 * Bundles all "Deck-local session metadata" actions: pin / archive / folder /
 * tags / rename / delete. Also owns the metaStore setter (with persistence).
 *
 * Returns the persistent metaStore setter, the small `updateMeta` helper, and
 * each domain action — all stable references so the component can pass them
 * to children without re-rendering.
 */
export function useSessionMetaActions({
  metaStore, setMetaStoreRaw, active, profile, showArchived, t,
  setSessions, setMessages, setResponseIds, setActive, setError, clearTimeline,
}: {
  metaStore: MetaStore;
  setMetaStoreRaw: React.Dispatch<React.SetStateAction<MetaStore>>;
  active: string;
  profile: string;
  showArchived: boolean;
  t: ChatT;
  setSessions: React.Dispatch<React.SetStateAction<LocalSession[]>>;
  setMessages: React.Dispatch<React.SetStateAction<Record<string, DeckMessage[]>>>;
  setResponseIds: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setActive: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  clearTimeline: () => void;
}) {
  const updateMeta = useCallback((sessionId: string, patch: Partial<ReturnType<typeof getMeta>>) => {
    setMetaStoreRaw((cur) => {
      const next = setMeta(cur, sessionId, patch);
      saveMetaStore(next);
      return next;
    });
  }, [setMetaStoreRaw]);

  const setMetaStore = useCallback((updater: (cur: MetaStore) => MetaStore) => {
    setMetaStoreRaw((cur) => {
      const next = updater(cur);
      saveMetaStore(next);
      return next;
    });
  }, [setMetaStoreRaw]);

  const performRemoveDeckMeta = useCallback((id: string) => {
    if (!id) return;
    setMetaStore((cur) => {
      if (!cur.byId[id]) return cur;
      const byId = { ...cur.byId };
      delete byId[id];
      return { ...cur, byId };
    });
  }, [setMetaStore]);

  const performDeleteSession = useCallback(async (id: string) => {
    if (!id) return;
    // Optimistic: clear from UI immediately so the click feels responsive,
    // then call the backend. If the DB delete fails the toast surfaces it
    // but we keep the UI clean — the orphan entry would just reappear on
    // next refresh, which is the right signal.
    setSessions((s) => s.filter((x) => x.id !== id));
    setMessages((m) => { const next = { ...m }; delete next[id]; return next; });
    setResponseIds((r) => { const next = { ...r }; delete next[id]; return next; });
    setMetaStore((cur) => {
      if (!cur.byId[id]) return cur;
      const byId = { ...cur.byId };
      delete byId[id];
      return { ...cur, byId };
    });
    if (active === id) setActive('');
    try {
      await deckApi.deleteSession(id, profile);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(t.deleteFailed(msg));
    }
  }, [active, profile, setActive, setError, setMessages, setMetaStore, setResponseIds, setSessions, t]);

  const togglePin = useCallback((sessionId: string) => {
    const meta = getMeta(metaStore, sessionId);
    updateMeta(sessionId, { pinned: !meta.pinned });
  }, [metaStore, updateMeta]);

  const toggleArchive = useCallback((sessionId: string) => {
    const meta = getMeta(metaStore, sessionId);
    if (meta.archived) {
      updateMeta(sessionId, { archived: false, archivedAt: undefined });
    } else {
      updateMeta(sessionId, { archived: true, archivedAt: new Date().toISOString() });
      // Switch away if the archived one was active — archive view is hidden by default.
      if (active === sessionId && !showArchived) setActive('');
    }
  }, [active, metaStore, setActive, showArchived, updateMeta]);

  const moveToFolder = useCallback((sessionId: string, folderId: string | null) => {
    updateMeta(sessionId, { folderId: folderId ?? undefined });
  }, [updateMeta]);

  const applyRename = useCallback((sessionId: string, value: string) => {
    const trimmed = value.trim();
    updateMeta(sessionId, { customTitle: trimmed || undefined });
  }, [updateMeta]);

  const applyTags = useCallback((sessionId: string, value: string) => {
    const tags = normalizeTags(value);
    updateMeta(sessionId, { tags: tags.length ? tags : undefined });
  }, [updateMeta]);

  const applyNewFolder = useCallback((name: string, thenMoveSessionId?: string) => {
    setMetaStore((cur) => {
      const { store, folder } = addFolder(cur, name);
      if (thenMoveSessionId) {
        return setMeta(store, thenMoveSessionId, { folderId: folder.id });
      }
      return store;
    });
  }, [setMetaStore]);

  const applyRenameFolder = useCallback((folderId: string, name: string) => {
    if (!name.trim()) return;
    setMetaStore((cur) => renameFolder(cur, folderId, name));
  }, [setMetaStore]);

  const applyDeleteFolder = useCallback((folderId: string) => {
    setMetaStore((cur) => deleteFolder(cur, folderId));
  }, [setMetaStore]);

  return {
    updateMeta, setMetaStore,
    performRemoveDeckMeta, performDeleteSession,
    togglePin, toggleArchive, moveToFolder,
    applyRename, applyTags,
    applyNewFolder, applyRenameFolder, applyDeleteFolder,
  };
}
