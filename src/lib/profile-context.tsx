'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { deckApi } from './api';
import type { DeckProfile } from './types';

const STORAGE_KEY = 'hermesdeck.active-profile.v1';
const NO_PROFILE = '';

interface ProfileContextValue {
  /** Currently active, authorized profile id. Empty when the user has no assigned/available Agent. */
  activeProfile: string;
  /** Full authorized profile list from /api/deck/profiles. Empty while loading or when none are assigned. */
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

function removeStoredProfile(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
}

function reconcileActiveProfile(prev: string, profiles: DeckProfile[]): string {
  if (profiles.length === 0) {
    removeStoredProfile();
    return NO_PROFILE;
  }
  if (profiles.some((p) => p.id === prev)) return prev;
  const next = profiles.find((p) => p.active)?.id
    || profiles[0]?.id
    || NO_PROFILE;
  if (next) writeStoredProfile(next);
  else removeStoredProfile();
  return next;
}

/** Migrate the legacy chat-only `hermesdeck.chat.v1.profile` field into the
 *  global key. Only runs once and only when the global key is unset, so it
 *  doesn't clobber a profile the user picked from the new switcher.
 *
 *  Legacy retention / sunset: keep until at least two minor releases after the
 *  global profile selector is the only supported UI. Removing earlier would
 *  strand users who skip versions with their old chat-only profile selection. */
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
  const [activeProfile, setActiveProfileState] = useState<string>(NO_PROFILE);
  const [profiles, setProfiles] = useState<DeckProfile[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const pendingStoredProfileRef = useRef<string | null>(null);

  // Same-tab consumers re-render through this provider's context value;
  // cross-tab sync rides the native `storage` event below. No custom event
  // bus is needed.
  const setActiveProfile = useCallback((id: string) => {
    if (!id) return;
    setActiveProfileState((prev) => {
      if (!profilesLoaded) {
        pendingStoredProfileRef.current = id;
        writeStoredProfile(id);
        return NO_PROFILE;
      }
      if (profilesLoaded && profiles.length === 0) {
        removeStoredProfile();
        return NO_PROFILE;
      }
      if (profiles.length > 0 && !profiles.some((p) => p.id === id)) return prev;
      if (prev === id) return prev;
      writeStoredProfile(id);
      return id;
    });
  }, [profiles, profilesLoaded]);

  const refresh = useCallback(async () => {
    try {
      const r = await deckApi.profiles();
      const nextProfiles = r.profiles || [];
      setProfiles(nextProfiles);
      setProfilesLoaded(true);
      setActiveProfileState((prev) => {
        // The server already filters /api/deck/profiles by RBAC. Reconcile the
        // browser's prior/localStorage selection against that authorized list
        // so a stale unassigned profile can never drive client requests.
        const pending = pendingStoredProfileRef.current;
        pendingStoredProfileRef.current = null;
        return reconcileActiveProfile(pending || prev, nextProfiles);
      });
    } catch {
      // Fail closed: until the server-filtered list is known, expose no Agent.
      setProfiles([]);
      setActiveProfileState(NO_PROFILE);
    } finally {
      setLoading(false);
    }
  }, []);

  // Hydrate from localStorage (or migrate from chat) on the client, then fetch
  // and reconcile against the server-filtered authorized profile list before
  // consumers are marked ready.
  useEffect(() => {
    let alive = true;
    let stored = readStoredProfile();
    if (!stored) {
      stored = migrateLegacyChatProfile();
      if (stored) writeStoredProfile(stored);
    }
    // Keep localStorage only as pending input. Never expose it before the
    // server-filtered /api/deck/profiles list has authorized it.
    pendingStoredProfileRef.current = stored;
    void refresh().finally(() => { if (alive) setHydrated(true); });
    return () => { alive = false; };
  }, [refresh]);

  // Cross-tab sync: when another tab changes the active profile, follow.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (!e.newValue) {
        pendingStoredProfileRef.current = null;
        setActiveProfileState(NO_PROFILE);
        return;
      }
      setActiveProfileState((prev) => {
        if (!profilesLoaded) {
          pendingStoredProfileRef.current = e.newValue;
          return NO_PROFILE;
        }
        if (profilesLoaded && profiles.length === 0) {
          removeStoredProfile();
          return NO_PROFILE;
        }
        if (profiles.length > 0 && !profiles.some((p) => p.id === e.newValue)) return prev;
        return prev === e.newValue ? prev : e.newValue!;
      });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [profiles, profilesLoaded]);

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
  activeProfile: NO_PROFILE,
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
