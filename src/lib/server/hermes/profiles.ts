import type { DeckProfile } from '@/lib/types';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { apiHeaders, defaultHermesRoot, getHermesApiBase, HERMES_API_BASE, makeCache, PROFILE_ID_RE, redactSecrets } from './core.ts';

const ADMIN_CATALOG_LOCAL_PROFILE_LIMIT = 64;

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

function identityFromRecord(record: Record<string, unknown>): string {
  for (const key of ['profile_id', 'profileId', 'routed_profile_id', 'routedProfileId', 'id', 'name']) {
    const id = coerceProfileId(record[key]);
    if (id) return id;
  }
  const profile = record.profile;
  if (typeof profile === 'string') return coerceProfileId(profile);
  if (isRecord(profile)) return identityFromRecord(profile);
  const data = record.data;
  if (isRecord(data)) return identityFromRecord(data);
  return '';
}

async function responseJsonOrNull(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function healthProfileIdentity(response: Response, payload: unknown): string {
  for (const header of ['x-hermes-profile-id', 'x-profile-id', 'x-routed-profile-id']) {
    const id = coerceProfileId(response.headers.get(header));
    if (id) return id;
  }
  if (isRecord(payload)) return identityFromRecord(payload);
  return '';
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

export class AssignedProfilesUnavailableError extends Error {
  status = 502;
  code = 'assigned_profiles_unavailable';
  details: string[];

  constructor(details: string[]) {
    super(details.length ? `No assigned Hermes profiles are routable: ${details.join('; ')}` : 'No valid Hermes profiles are assigned.');
    this.name = 'AssignedProfilesUnavailableError';
    this.details = details;
  }
}

function assignedProfileIds(ids: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of ids) {
    const id = coerceProfileId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

async function localProfileIdsForAdminCatalogFallback(): Promise<string[]> {
  const seen = new Set<string>(['default']);
  const result = ['default'];
  const profilesDir = join(defaultHermesRoot(), 'profiles');
  let entries: { name: string; isDirectory(): boolean }[] = [];
  try {
    entries = await fs.readdir(profilesDir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))) {
    if (!entry.isDirectory()) continue;
    const id = coerceProfileId(entry.name);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= ADMIN_CATALOG_LOCAL_PROFILE_LIMIT) break;
  }
  return result;
}

export type ProfileRoutabilityProof = { ok: true } | { ok: false; detail: string };

export async function proveProfileRoutable(profileId: string): Promise<ProfileRoutabilityProof> {
  const apiBase = getHermesApiBase(profileId);
  if (!apiBase) return { ok: false, detail: `${profileId}: no configured API server base` };

  const base = apiBase.replace(/\/+$/, '');
  try {
    const response = await fetch(`${base}/health`, {
      cache: 'no-store',
      headers: apiHeaders(profileId),
      signal: AbortSignal.timeout(2500),
    });
    if (response.ok) {
      if (profileId === 'default') return { ok: true };
      const payload = await responseJsonOrNull(response);
      const routedProfileId = healthProfileIdentity(response, payload);
      if (!routedProfileId) {
        return { ok: false, detail: `${profileId}: /health did not prove routed profile identity` };
      }
      if (routedProfileId !== profileId) {
        return { ok: false, detail: `${profileId}: /health proved routed profile '${routedProfileId}'` };
      }
      return { ok: true };
    }
    const text = await response.text().catch(() => '');
    const suffix = text ? `: ${redactSecrets(text).slice(0, 160)}` : '';
    return { ok: false, detail: `${profileId}: /health returned HTTP ${response.status}${suffix}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: `${profileId}: /health probe failed: ${redactSecrets(message).slice(0, 160)}` };
  }
}

export async function getAssignedRoutableProfiles(ids: readonly unknown[]): Promise<DeckProfile[]> {
  const candidates = assignedProfileIds(ids);
  const invalidCount = ids.length - candidates.length;
  const details: string[] = invalidCount > 0 ? [`${invalidCount} invalid or duplicate assigned profile id(s) ignored`] : [];
  const profiles: DeckProfile[] = [];

  for (const id of candidates) {
    const proof = await proveProfileRoutable(id);
    if (!proof.ok) {
      details.push(proof.detail);
      continue;
    }
    profiles.push({ id, name: id, active: false, toolsets: [] });
  }

  if (!profiles.length) throw new AssignedProfilesUnavailableError(details);
  return normalizeActiveProfile(profiles);
}

async function getLocalRoutableProfilesForAdminCatalogFallback(): Promise<DeckProfile[]> {
  const ids = await localProfileIdsForAdminCatalogFallback();
  const profiles: DeckProfile[] = [];
  for (const id of ids) {
    const proof = await proveProfileRoutable(id);
    if (!proof.ok) continue;
    profiles.push({ id, name: id, active: false, toolsets: [] });
  }
  return normalizeActiveProfile(profiles);
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

class ProfilesApiFetchError extends Error {
  path: string;
  kind: 'http' | 'network' | 'invalid_json' | 'malformed_payload' | 'empty';
  status?: number;

  constructor(path: string, kind: ProfilesApiFetchError['kind'], message: string, status?: number) {
    super(message);
    this.name = 'ProfilesApiFetchError';
    this.path = path;
    this.kind = kind;
    this.status = status;
  }
}

async function fetchProfilesApi(path: string): Promise<DeckProfile[]> {
  const base = HERMES_API_BASE.replace(/\/+$/, '');
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      cache: 'no-store',
      headers: apiHeaders(),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ProfilesApiFetchError(path, 'network', `${path} request failed: ${redactSecrets(message).slice(0, 160)}`);
  }
  if (!response.ok) throw new ProfilesApiFetchError(path, 'http', `${path} returned HTTP ${response.status}`, response.status);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProfilesApiFetchError(path, 'invalid_json', `${path} returned invalid JSON.`);
  }

  let rawProfiles: unknown[];
  try {
    rawProfiles = extractApiProfiles(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ProfilesApiFetchError(path, 'malformed_payload', `${path} ${message}`);
  }

  const profiles = rawProfiles.map(normalizeApiProfile).filter((profile): profile is DeckProfile => profile !== null);
  return Array.from(new Map(profiles.map((profile) => [profile.id, profile])).values());
}

async function getStrictProfilesUncached(): Promise<DeckProfile[]> {
  const errors: string[] = [];
  const failures: ProfilesApiFetchError[] = [];
  const candidates: DeckProfile[][] = [];
  for (const path of ['/v1/profiles', '/api/profiles']) {
    try {
      const profiles = await fetchProfilesApi(path);
      if (!profiles.length) throw new ProfilesApiFetchError(path, 'empty', `${path} returned no profiles.`);
      candidates.push(profiles);
    } catch (err) {
      if (err instanceof ProfilesApiFetchError) failures.push(err);
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (candidates.length) {
    // Some Hermes API builds expose both endpoints, with /v1/profiles scoped to
    // the current/default runtime and /api/profiles carrying the full profile
    // catalog. Never stop at the first singleton response: choose the richest
    // API-backed catalog so admin/super_admin can see all Agents.
    const best = candidates.reduce((winner, item) => (item.length > winner.length ? item : winner), candidates[0]!);
    return normalizeActiveProfile(best);
  }

  const bothStrictCatalogRoutesMissing = failures.length === 2
    && failures.every((failure) => failure.kind === 'http' && failure.status === 404);
  if (bothStrictCatalogRoutesMissing) {
    const fallback = await getLocalRoutableProfilesForAdminCatalogFallback();
    if (fallback.length) return fallback;

    throw new Error(`Hermes Agent profile list unavailable and no local routable Hermes profiles were found: ${errors.join('; ')}`);
  }

  throw new Error(`Hermes Agent profile list unavailable: ${errors.join('; ')}`);
}

export const getStrictProfiles = makeCache(2_000, getStrictProfilesUncached);
