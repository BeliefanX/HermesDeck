'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { deckApi } from './api';
import type { DeckProfile } from './types';

const STORAGE_KEY = 'hermesdeck.active-profile.v1';
const FALLBACK_PROFILE = 'default';

interface ProfileContextValue {
  /** Currently active profile id. Always a non-empty string; defaults to 'default' before hydration. */
  activeProfile: string;
  /** Full profile list from /api/deck/profiles. Empty array while loading. */
  profiles: DeckProfile[];
  /** True before the first /api/deck/profiles fetch resolves. */
  loading: boolean;
  /** True once we've read localStorage on the client. */
  hydrated: boolean;
  setActiveProfile: (id: string) => void;
  /** Re-fetch the profile list. */
  refresh: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

function readStoredProfile(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v && v.trim() ? v : null;
  } catch { return null; }
}

function writeStoredProfile(id: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, id); } catch {}
}

/** Migrate the legacy chat-only `hermesdeck.chat.v1.profile` field into the
 *  global key. Only runs once and only when the global key is unset, so it
 *  doesn't clobber a profile the user picked from the new switcher. */
function migrateLegacyChatProfile(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('hermesdeck.chat.v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { profile?: unknown };
    if (parsed && typeof parsed.profile === 'string' && parsed.profile.trim()) {
      return parsed.profile.trim();
    }
  } catch {}
  return null;
}

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [activeProfile, setActiveProfileState] = useState<string>(FALLBACK_PROFILE);
  const [profiles, setProfiles] = useState<DeckProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  // Same-tab consumers re-render through this provider's context value;
  // cross-tab sync rides the native `storage` event below. No custom event
  // bus is needed.
  const setActiveProfile = useCallback((id: string) => {
    if (!id) return;
    setActiveProfileState((prev) => {
      if (prev === id) return prev;
      writeStoredProfile(id);
      return id;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await deckApi.profiles();
      setProfiles(r.profiles || []);
      setActiveProfileState((prev) => {
        // If the current selection no longer exists, fall back to the
        // server-marked active profile, then to the first, then 'default'.
        const exists = (r.profiles || []).some((p) => p.id === prev);
        if (exists) return prev;
        const next = r.profiles?.find((p) => p.active)?.id
          || r.profiles?.[0]?.id
          || FALLBACK_PROFILE;
        writeStoredProfile(next);
        return next;
      });
    } catch {
      // Network / Hermes down — keep whatever we had.
    } finally {
      setLoading(false);
    }
  }, []);

  // Hydrate from localStorage (or migrate from chat) on the client, then fetch.
  useEffect(() => {
    let stored = readStoredProfile();
    if (!stored) {
      stored = migrateLegacyChatProfile();
      if (stored) writeStoredProfile(stored);
    }
    if (stored) setActiveProfileState(stored);
    setHydrated(true);
    void refresh();
  }, [refresh]);

  // Cross-tab sync: when another tab changes the active profile, follow.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      setActiveProfileState((prev) => (prev === e.newValue ? prev : e.newValue!));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo<ProfileContextValue>(() => ({
    activeProfile, profiles, loading, hydrated, setActiveProfile, refresh,
  }), [activeProfile, profiles, loading, hydrated, setActiveProfile, refresh]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

// Module-level fallback so the hook can stay rules-of-hooks compliant.
// `useActiveProfile` no longer calls `useRef` conditionally — we just return
// the same frozen object every time, which is what callers outside the
// provider need anyway.
const PROFILE_CONTEXT_FALLBACK: ProfileContextValue = Object.freeze({
  activeProfile: FALLBACK_PROFILE,
  profiles: [] as DeckProfile[],
  loading: false,
  hydrated: false,
  setActiveProfile: () => {},
  refresh: async () => {},
});

export function useActiveProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  return ctx || PROFILE_CONTEXT_FALLBACK;
}
