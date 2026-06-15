import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { DeckProfile } from '@/lib/types';
import type { SafeDeckUserContext } from './auth.ts';
import { isAdminRole } from './rbac.ts';

const FALLBACK_PROFILE_ID_RE = /^[\w.-]{1,64}$/;

function defaultHermesRoot(): string {
  const envHome = process.env.HERMES_HOME?.trim();
  if (!envHome) return join(homedir(), '.hermes');

  const resolved = resolve(envHome);
  // If Deck is ever launched from a named profile home, use the parent
  // default Hermes root so admins still see sibling profiles.
  if (basename(dirname(resolved)) === 'profiles') return dirname(dirname(resolved));
  return resolved;
}

export function localProfileIdsForCatalogFallback(): string[] {
  const ids = new Set<string>(['default']);
  const profilesRoot = join(defaultHermesRoot(), 'profiles');
  try {
    if (!existsSync(profilesRoot)) return [...ids];
    for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!FALLBACK_PROFILE_ID_RE.test(entry.name)) continue;
      ids.add(entry.name);
    }
  } catch {
    // Fallback must never turn a catalog outage into a 500. The caller still
    // returns profiles_catalog_unavailable so the UI can surface the degraded state.
  }
  return [...ids].sort((a, b) => {
    if (a === 'default') return -1;
    if (b === 'default') return 1;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

export function deckProfilesFromIds(ids: readonly string[]): DeckProfile[] {
  const validIds = Array.from(new Set(ids.map((id) => id.trim()).filter((id) => FALLBACK_PROFILE_ID_RE.test(id))));
  const activeCandidate = process.env.HERMES_PROFILE?.trim();
  const activeId = activeCandidate && validIds.includes(activeCandidate) ? activeCandidate : validIds[0] || '';
  return validIds.map((id) => ({
    id,
    name: id,
    active: id === activeId,
    gateway: 'hermes',
    toolsets: [],
  }));
}

export function fallbackProfilesForUser(user: Pick<SafeDeckUserContext, 'role' | 'assignedProfileIds'>): DeckProfile[] {
  const ids = isAdminRole(user.role)
    ? localProfileIdsForCatalogFallback()
    : (user.assignedProfileIds || []).filter((id) => FALLBACK_PROFILE_ID_RE.test(id));
  return deckProfilesFromIds(ids);
}
