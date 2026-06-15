import type { DeckProfile } from '@/lib/types';
import { apiHeaders, HERMES_API_BASE, makeCache, PROFILE_ID_RE } from './core';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function coerceProfileId(value: unknown): string {
  const id = stringValue(value);
  return id && PROFILE_ID_RE.test(id) ? id : '';
}

function normalizeApiProfile(raw: unknown): DeckProfile | null {
  if (typeof raw === 'string') {
    const id = coerceProfileId(raw);
    return id ? { id, name: id, active: false, toolsets: [] } : null;
  }
  if (!isRecord(raw)) return null;

  const id = coerceProfileId(raw.id) || coerceProfileId(raw.profileId) || coerceProfileId(raw.name);
  if (!id) return null;
  const toolsets = Array.isArray(raw.toolsets) ? raw.toolsets.filter((item): item is string => typeof item === 'string') : [];
  const active = raw.active === true || raw.isActive === true || raw.current === true;
  return {
    id,
    name: stringValue(raw.name) || id,
    active,
    model: stringValue(raw.model),
    gateway: stringValue(raw.gateway),
    alias: stringValue(raw.alias) || undefined,
    toolsets,
  };
}

function sortProfiles(profiles: DeckProfile[]): DeckProfile[] {
  return [...profiles].sort((a, b) => {
    if (a.id === 'default') return -1;
    if (b.id === 'default') return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function normalizeActiveProfile(profiles: DeckProfile[]): DeckProfile[] {
  const sorted = sortProfiles(profiles);
  const requestedActive = coerceProfileId(process.env.HERMES_PROFILE);
  const activeId = requestedActive && sorted.some((profile) => profile.id === requestedActive)
    ? requestedActive
    : sorted.find((profile) => profile.active)?.id || sorted[0]?.id || '';

  return sorted.map((profile) => ({ ...profile, active: profile.id === activeId }));
}

function extractApiProfiles(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) throw new Error('profiles API returned a non-object payload.');
  for (const key of ['profiles', 'items', 'data']) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }
  if (isRecord(payload.data) && Array.isArray(payload.data.profiles)) return payload.data.profiles;
  throw new Error('profiles API payload does not contain a profile list.');
}

async function fetchProfilesApi(path: string): Promise<DeckProfile[]> {
  const base = HERMES_API_BASE.replace(/\/+$/, '');
  const response = await fetch(`${base}${path}`, {
    cache: 'no-store',
    headers: apiHeaders(),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${path} returned invalid JSON.`);
  }

  const profiles = extractApiProfiles(payload)
    .map(normalizeApiProfile)
    .filter((profile): profile is DeckProfile => profile !== null);
  return Array.from(new Map(profiles.map((profile) => [profile.id, profile])).values());
}

async function getStrictProfilesUncached(): Promise<DeckProfile[]> {
  const errors: string[] = [];
  const candidates: DeckProfile[][] = [];
  for (const path of ['/v1/profiles', '/api/profiles']) {
    try {
      const profiles = await fetchProfilesApi(path);
      if (!profiles.length) throw new Error(`${path} returned no profiles.`);
      candidates.push(profiles);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (candidates.length) {
    // Some Hermes API builds expose both endpoints, with /v1/profiles scoped to
    // the current/default runtime and /api/profiles carrying the full profile
    // catalog. Never stop at the first singleton response: choose the richest
    // API-backed catalog so admin/super_admin can see all Agents while still
    // avoiding any local filesystem enumeration fallback in Deck.
    const best = candidates.reduce((winner, item) => (item.length > winner.length ? item : winner), candidates[0]!);
    return normalizeActiveProfile(best);
  }

  throw new Error(`Hermes Agent profile list unavailable: ${errors.join('; ')}`);
}

export const getStrictProfiles = makeCache(2_000, getStrictProfilesUncached);
export const getProfiles = getStrictProfiles;
