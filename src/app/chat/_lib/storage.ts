import type { DeckMessage, DeckSession } from '@/lib/types';

export type LocalSession = DeckSession;

export type PersistedChatState = {
  sessions: LocalSession[];
  messages: Record<string, DeckMessage[]>;
  responseIds: Record<string, string>;
  active?: string;
  profile?: string;
};

export const STORAGE_KEY = 'hermesdeck.chat.v1';
export const PANELS_KEY = 'hermesdeck.chat.panels.v1';
export const SOURCE_FILTER_KEY = 'hermesdeck.chat.sourcefilter.v1';
export const SHOW_SUBAGENTS_KEY = 'hermesdeck.chat.show-subagents.v1';
export const SHOW_TOOL_DETAILS_KEY = 'hermesdeck.chat.show-tool-details.v1';

function normalizeProfile(profile?: string): string {
  return profile && profile.trim() ? profile.trim() : 'default';
}

export function storageKeyForProfile(profile = 'default'): string {
  return `${STORAGE_KEY}.${encodeURIComponent(normalizeProfile(profile))}`;
}

export function sourceFilterKeyForProfile(profile = 'default'): string {
  return `${SOURCE_FILTER_KEY}.${encodeURIComponent(normalizeProfile(profile))}`;
}

export function parseSourceFilter(raw: string | null): string[] | null | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as string[] | null;
    if (parsed === null || Array.isArray(parsed)) return parsed;
  } catch {}
  return undefined;
}

function parseStored(raw: string | null): PersistedChatState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedChatState;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch { return null; }
}

function sessionProfile(s: Partial<LocalSession>, missingProfileFallback: string): string {
  return normalizeProfile(s.profileId || missingProfileFallback);
}

export function sessionMatchesProfile(s: Partial<LocalSession>, profile = 'default', missingProfileFallback = 'default'): boolean {
  return sessionProfile(s, missingProfileFallback) === normalizeProfile(profile);
}

export function safeParseStored(profile = 'default'): PersistedChatState | null {
  const target = normalizeProfile(profile);
  try {
    const scoped = parseStored(localStorage.getItem(storageKeyForProfile(target)));
    if (scoped) return stripLegacyLocal(scoped, target, { assumeMissingProfileIsTarget: true });

    // Backward-compatible one-time read from the old global cache. Sessions
    // without a profileId are treated as the legacy state's profile, or default
    // if the old state did not record one, so a sparse profile (alpha-labs) does
    // not inherit default-profile leftovers.
    // Legacy retention / sunset: this read path is intentionally preserved while
    // `hermesdeck.chat.v1` may exist in users' browsers; remove only after a
    // migration window where scoped keys have been written for all active users.
    const legacy = parseStored(localStorage.getItem(STORAGE_KEY));
    if (!legacy) return null;
    const migrated = stripLegacyLocal(legacy, target, { assumeMissingProfileIsTarget: false });
    if (migrated.sessions.length || Object.keys(migrated.messages).length || migrated.active) {
      try { localStorage.setItem(storageKeyForProfile(target), JSON.stringify(migrated)); } catch {}
    }
    return migrated;
  } catch { return null; }
}

// One-time migration: drop legacy `local:` placeholder/draft sessions that lived
// only in browser storage. Backed sessions all have UUID-style IDs now. Also
// scope the recovered payload to one Hermes profile so cached state cannot leak
// across profile switches. Keep this guard alongside the legacy global-cache
// read above; otherwise old draft rows can reappear when users jump versions.
export function stripLegacyLocal(
  state: PersistedChatState,
  profile = 'default',
  opts: { assumeMissingProfileIsTarget?: boolean } = {},
): PersistedChatState {
  const target = normalizeProfile(profile);
  const missingProfileFallback = opts.assumeMissingProfileIsTarget
    ? target
    : normalizeProfile(state.profile || 'default');
  const sessions = (state.sessions || [])
    .filter((s) => s.id && !s.id.startsWith('local:'))
    .map((s) => ({ ...s, profileId: sessionProfile(s, missingProfileFallback) }))
    .filter((s) => s.profileId === target);
  const allowedIds = new Set(sessions.map((s) => s.id));

  const messages: Record<string, DeckMessage[]> = {};
  for (const [id, list] of Object.entries(state.messages || {})) {
    if (!id.startsWith('local:') && allowedIds.has(id)) messages[id] = list;
  }
  const responseIds: Record<string, string> = {};
  for (const [id, val] of Object.entries(state.responseIds || {})) {
    if (!id.startsWith('local:') && allowedIds.has(id)) responseIds[id] = val;
  }
  const active = state.active && !state.active.startsWith('local:') && allowedIds.has(state.active)
    ? state.active
    : undefined;
  return { sessions, messages, responseIds, active, profile: target };
}

// Merge cached + remote, preferring remote field values (title/messageCount may
// have moved server-side since the cache snapshot). Order: pinned/folder logic
// is applied later — here we just present remote-first by updatedAt.
export function mergeSessions(cached: LocalSession[], remote: DeckSession[], profile = 'default'): LocalSession[] {
  const target = normalizeProfile(profile);
  const remoteScoped = remote
    .map((s) => ({ ...s, profileId: sessionProfile(s, target) }))
    .filter((s) => s.profileId === target);
  const remoteIds = new Set(remoteScoped.map((s) => s.id));
  const cachedExtra = cached
    .filter((s) => sessionMatchesProfile(s, target, target))
    .filter((s) => !remoteIds.has(s.id));
  return [...remoteScoped, ...cachedExtra];
}

let sessionIdCounter = 0;
export function genSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: time-based id, valid as a session_id (matches /^[A-Za-z0-9_.-]+$/).
  // Per-tab counter disambiguates calls in the same millisecond.
  sessionIdCounter += 1;
  return `s_${Date.now().toString(36)}_${sessionIdCounter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
