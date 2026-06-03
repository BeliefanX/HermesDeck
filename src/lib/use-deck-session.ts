'use client';
import { useEffect, useMemo, useState } from 'react';
import { deckApi } from './api';
import type { DeckAuthSession, DeckUserCapabilities } from './types';

const EMPTY_CAPABILITIES: DeckUserCapabilities = Object.freeze({
  canUseApp: false,
  canManageUsers: false,
  canApproveUsers: false,
  canUseTerminal: false,
  canManageOwnCredentials: false,
});

export function useDeckSession() {
  const [session, setSession] = useState<DeckAuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const ac = new AbortController();
    deckApi.session(ac.signal)
      .then((data) => {
        if (!alive) return;
        setSession(data?.authenticated ? data : { authenticated: false });
      })
      .catch(() => {
        if (alive) setSession({ authenticated: false });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; ac.abort(); };
  }, []);

  const capabilities = useMemo(
    () => session?.capabilities || EMPTY_CAPABILITIES,
    [session?.capabilities],
  );

  return { session, capabilities, loading };
}
