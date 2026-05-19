'use client';
import { useEffect, useRef } from 'react';
import type { DeckMessage } from '@/lib/types';
import {
  type MetaStore,
  loadMetaStore,
} from '@/lib/session-meta';
import {
  type LocalSession,
  type PersistedChatState,
  PANELS_KEY,
  SHOW_SUBAGENTS_KEY,
  SHOW_TOOL_DETAILS_KEY,
  SOURCE_FILTER_KEY,
  safeParseStored,
  sessionMatchesProfile,
  storageKeyForProfile,
} from '../_lib/storage';

interface HydrationParams {
  profile: string;
  profileHydrated: boolean;
  hydrated: boolean;
  setHydrated: React.Dispatch<React.SetStateAction<boolean>>;
  // Targets to hydrate
  setSessions: React.Dispatch<React.SetStateAction<LocalSession[]>>;
  setMessages: React.Dispatch<React.SetStateAction<Record<string, DeckMessage[]>>>;
  setResponseIds: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setActive: React.Dispatch<React.SetStateAction<string>>;
  setShowSessions: React.Dispatch<React.SetStateAction<boolean>>;
  setShowTimeline: React.Dispatch<React.SetStateAction<boolean>>;
  setEnabledSources: React.Dispatch<React.SetStateAction<string[] | null>>;
  setShowSubagents: React.Dispatch<React.SetStateAction<boolean>>;
  setShowToolDetails: React.Dispatch<React.SetStateAction<boolean>>;
  setMetaStoreRaw: React.Dispatch<React.SetStateAction<MetaStore>>;
  // Live values for persistence
  showSessions: boolean;
  showTimeline: boolean;
  enabledSources: string[] | null;
  showSubagents: boolean;
  showToolDetails: boolean;
  sessions: LocalSession[];
  messages: Record<string, DeckMessage[]>;
  responseIds: Record<string, string>;
  active: string;
}

/**
 * Owns:
 * - One-shot hydration of chat state + per-flag stashes from localStorage.
 * - Per-flag persistence (panels, source-filter, subagents, tool-details).
 * - Debounced + flush-on-pagehide chat-state persistence.
 */
export function useChatHydration(p: HydrationParams) {
  // Hydrate profile-scoped chat cache. Global UI flags are hydrated once below;
  // sessions/messages/active are reloaded whenever the active Hermes profile
  // changes so one profile's browser cache never appears under another.
  const uiFlagsHydratedRef = useRef(false);
  useEffect(() => {
    if (!p.profileHydrated) return;
    const stored = safeParseStored(p.profile);
    p.setSessions(stored?.sessions || []);
    p.setMessages(stored?.messages || {});
    p.setResponseIds(stored?.responseIds || {});
    p.setActive(stored?.active || '');

    if (!uiFlagsHydratedRef.current) {
      uiFlagsHydratedRef.current = true;
      try {
        const stash = localStorage.getItem(PANELS_KEY);
        if (stash) {
          const parsed = JSON.parse(stash) as { sessions?: boolean; timeline?: boolean };
          if (typeof parsed.sessions === 'boolean') p.setShowSessions(parsed.sessions);
          if (typeof parsed.timeline === 'boolean') p.setShowTimeline(parsed.timeline);
        }
      } catch {}
      try {
        const stash = localStorage.getItem(SOURCE_FILTER_KEY);
        if (stash) {
          const parsed = JSON.parse(stash) as string[] | null;
          if (parsed === null || Array.isArray(parsed)) p.setEnabledSources(parsed);
        }
      } catch {}
      try {
        const stash = localStorage.getItem(SHOW_SUBAGENTS_KEY);
        if (stash === '1') p.setShowSubagents(true);
      } catch {}
      try {
        const stash = localStorage.getItem(SHOW_TOOL_DETAILS_KEY);
        if (stash === '1') p.setShowToolDetails(true);
      } catch {}
      p.setMetaStoreRaw(loadMetaStore());
    }
    p.setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.profileHydrated, p.profile]);

  useEffect(() => {
    if (!p.hydrated) return;
    try { localStorage.setItem(PANELS_KEY, JSON.stringify({ sessions: p.showSessions, timeline: p.showTimeline })); } catch {}
  }, [p.hydrated, p.showSessions, p.showTimeline]);

  useEffect(() => {
    if (!p.hydrated) return;
    try { localStorage.setItem(SOURCE_FILTER_KEY, JSON.stringify(p.enabledSources)); } catch {}
  }, [p.hydrated, p.enabledSources]);

  useEffect(() => {
    if (!p.hydrated) return;
    try { localStorage.setItem(SHOW_SUBAGENTS_KEY, p.showSubagents ? '1' : '0'); } catch {}
  }, [p.hydrated, p.showSubagents]);

  useEffect(() => {
    if (!p.hydrated) return;
    try { localStorage.setItem(SHOW_TOOL_DETAILS_KEY, p.showToolDetails ? '1' : '0'); } catch {}
  }, [p.hydrated, p.showToolDetails]);

  // Persistence: debounce regular writes (messages mutate per streamed delta,
  // and the snapshot can run into MBs, so per-token JSON.stringify stalls
  // the composer). Flush synchronously on pagehide so a tab close doesn't
  // lose the very last delta the timer hasn't fired for yet.
  //
  // Cap the snapshot so localStorage quota doesn't blow up after weeks of use.
  // Heuristic: keep messages for the most-recently-touched MAX_PERSIST sessions,
  // and within each, keep at most MESSAGE_TAIL of the latest entries — older
  // sessions remain in the metadata index (so they show in the sidebar) but
  // their messages get re-fetched from the server on demand.
  const MAX_PERSIST_SESSIONS = 60;
  const MESSAGE_TAIL = 400;
  const persistChatRef = useRef(() => {});
  useEffect(() => {
    persistChatRef.current = () => {
      const cachedSessions = p.sessions.filter((s) => (
        sessionMatchesProfile(s, p.profile, p.profile) && (p.messages[s.id]?.length || 0) > 0
      ));
      // Pick the sessions whose messages we'll persist: most-recent first,
      // bounded by MAX_PERSIST_SESSIONS. Keep the active session pinned even
      // if it's older — refreshing the page should never lose the open thread.
      const ranked = [...cachedSessions].sort((a, b) => {
        const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0;
        const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0;
        return tb - ta;
      });
      const persistIds = new Set<string>();
      if (p.active) persistIds.add(p.active);
      for (const s of ranked) {
        if (persistIds.size >= MAX_PERSIST_SESSIONS) break;
        persistIds.add(s.id);
      }
      const storedMessages: Record<string, DeckMessage[]> = {};
      for (const [id, list] of Object.entries(p.messages)) {
        if (!list.length) continue;
        if (!persistIds.has(id)) continue;
        // Tail-truncate very long threads. The first message gets kept too
        // because shortTitle / first-prompt-as-title rendering depends on it.
        if (list.length <= MESSAGE_TAIL) {
          storedMessages[id] = list;
        } else {
          storedMessages[id] = [list[0], ...list.slice(list.length - MESSAGE_TAIL + 1)];
        }
      }
      const storedResponseIds: Record<string, string> = {};
      for (const [id, val] of Object.entries(p.responseIds)) {
        if (persistIds.has(id)) storedResponseIds[id] = val;
      }
      const active = p.active && persistIds.has(p.active) ? p.active : undefined;
      const payload: PersistedChatState = {
        sessions: cachedSessions,
        messages: storedMessages,
        responseIds: storedResponseIds,
        active,
        profile: p.profile,
      };
      try {
        localStorage.setItem(storageKeyForProfile(p.profile), JSON.stringify(payload));
      } catch (err) {
        // QuotaExceededError — try once more with messages dropped to free
        // headroom. The server still has the thread; this is just a cache.
        if (err instanceof Error && /quota/i.test(err.name + err.message)) {
          const fallback: PersistedChatState = {
            sessions: cachedSessions,
            messages: {},
            responseIds: storedResponseIds,
            active,
            profile: p.profile,
          };
          try { localStorage.setItem(storageKeyForProfile(p.profile), JSON.stringify(fallback)); } catch {}
        }
      }
    };
  }, [p.sessions, p.messages, p.responseIds, p.active, p.profile]);

  useEffect(() => {
    if (!p.hydrated) return;
    const handle = window.setTimeout(() => persistChatRef.current(), 600);
    return () => window.clearTimeout(handle);
  }, [p.hydrated, p.sessions, p.messages, p.responseIds, p.active, p.profile]);

  useEffect(() => {
    if (!p.hydrated) return;
    const flush = () => persistChatRef.current();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [p.hydrated]);
}
