'use client';
import { useMemo } from 'react';
import { effectiveTitle, getMeta, type Folder, type MetaStore } from '@/lib/session-meta';
import type { LocalSession } from '../_lib/storage';

/**
 * Derive sidebar grouping memos from session list + filters. Pure-derivation —
 * no effects, just useMemo wrappers, so callers get stable references.
 */
export function useChatGroups({
  sessions, metaStore, search, showArchived, enabledSources, showSubagents,
}: {
  sessions: LocalSession[];
  metaStore: MetaStore;
  search: string;
  showArchived: boolean;
  enabledSources: string[] | null;
  showSubagents: boolean;
}) {
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sessions) {
      if (!showSubagents && s.parentSessionId) continue;
      const k = (s.source || 'hermes').toLowerCase();
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return counts;
  }, [sessions, showSubagents]);

  const sourceFilterActive = enabledSources !== null;

  const enabledSourceSet = useMemo(
    () => enabledSources ? new Set(enabledSources) : null,
    [enabledSources],
  );

  const sessionGroups = useMemo(() => {
    // Cap only the long *unfoldered* tail. Slicing the raw list before
    // filtering silently hid pinned / foldered sessions that happened to fall
    // past index 80 — those are user-curated and must always be visible.
    const cap = 80;

    const rawQ = search.trim().toLowerCase();
    // Treat `#foo` as a tag-only query — strip the marker before comparing.
    const tagQ = rawQ.startsWith('#') ? rawQ.slice(1) : rawQ;
    const tagOnly = rawQ.startsWith('#');
    const q = rawQ;
    const matches = (s: LocalSession) => {
      const meta = getMeta(metaStore, s.id);
      const tagHit = (meta.tags || []).some((t) => t.toLowerCase().includes(tagQ));
      if (tagOnly) return tagHit;
      const title = effectiveTitle(meta, s.title).toLowerCase();
      if (title.includes(q)) return true;
      return tagHit;
    };

    const filtered = sessions.filter((s) => {
      const meta = getMeta(metaStore, s.id);
      if (showArchived ? !meta.archived : !!meta.archived) return false;
      if (q && !matches(s)) return false;
      if (enabledSourceSet && !enabledSourceSet.has((s.source || 'hermes').toLowerCase())) return false;
      if (!showSubagents && s.parentSessionId) return false;
      return true;
    });

    if (showArchived) {
      return {
        pinned: [] as LocalSession[],
        folderGroups: [] as { folder: Folder; sessions: LocalSession[] }[],
        unfoldered: filtered.slice(0, cap),
        truncated: Math.max(0, filtered.length - cap),
      };
    }

    const pinned = filtered.filter((s) => getMeta(metaStore, s.id).pinned);
    const rest = filtered.filter((s) => !getMeta(metaStore, s.id).pinned);

    const folderGroups = metaStore.folders.map((folder) => ({
      folder,
      sessions: rest.filter((s) => getMeta(metaStore, s.id).folderId === folder.id),
    }));
    const knownFolderIds = new Set(metaStore.folders.map((f) => f.id));
    const unfolderedAll = rest.filter((s) => {
      const fid = getMeta(metaStore, s.id).folderId;
      return !fid || !knownFolderIds.has(fid);
    });

    return {
      pinned,
      folderGroups,
      unfoldered: unfolderedAll.slice(0, cap),
      truncated: Math.max(0, unfolderedAll.length - cap),
    };
  }, [sessions, metaStore, search, showArchived, enabledSourceSet, showSubagents]);

  const subagentCount = useMemo(
    () => sessions.reduce((acc, s) => acc + (s.parentSessionId ? 1 : 0), 0),
    [sessions],
  );

  return { sourceCounts, sourceFilterActive, enabledSourceSet, sessionGroups, subagentCount };
}
