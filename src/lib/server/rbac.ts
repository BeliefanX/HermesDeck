import {
  type DeckRole,
  type SafeDeckUserContext,
} from './auth.ts';
import { inspectProtectedSessionToken, readSessionCookie } from './session-auth.ts';

export type RbacGuard<T = SafeDeckUserContext> =
  | { ok: true; user: T }
  | { ok: false; response: Response };

export type RbacCheck = { ok: true } | { ok: false; response: Response };

export const PROFILE_ID_RE = /^[\w.-]{1,64}$/;

// Compatibility note: persisted/auth API fields are still named
// `assignedProfileIds`, but product semantics are assigned Agent runtime ids
// (Hermes Agent profile ids), not Deck user profiles.

export function rbacJsonError(status: 401 | 403 | 400, error: string, detail?: string): Response {
  return Response.json(
    { ok: false, error, ...(detail ? { detail } : {}) },
    { status },
  );
}

type RbacFailure = { ok: false; response: Response };

export function unauthorized(detail = 'Not authenticated.'): RbacFailure {
  return { ok: false, response: rbacJsonError(401, 'unauthenticated', detail) };
}

export function forbidden(detail = 'Not authorized.'): RbacFailure {
  return { ok: false, response: rbacJsonError(403, 'unauthorized', detail) };
}

export function badRbacRequest(error: string, detail?: string): RbacFailure {
  return { ok: false, response: rbacJsonError(400, error, detail) };
}

function isRequestLike(value: Request | SafeDeckUserContext): value is Request {
  return value instanceof Request;
}

export function isAdminRole(role: DeckRole | undefined | null): boolean {
  return role === 'admin' || role === 'super_admin';
}

export function isSuperAdminRole(role: DeckRole | undefined | null): boolean {
  return role === 'super_admin';
}

export function requireDeckUser(req: Request): RbacGuard {
  const session = inspectProtectedSessionToken(readSessionCookie(req));
  if (!session.ok) {
    if (session.reason === 'inactive_user') {
      return { ok: false, response: rbacJsonError(403, 'inactive_user', 'User is not active.') };
    }
    return unauthorized();
  }
  if (session.user.status !== 'active' || !session.user.capabilities.canUseApp) {
    return { ok: false, response: rbacJsonError(403, 'inactive_user', 'User is not active.') };
  }
  return { ok: true, user: session.user };
}

export const requireActiveUser = requireDeckUser;

export function requireRole(req: Request, roles: readonly DeckRole[]): RbacGuard {
  const userGuard = requireActiveUser(req);
  if (!userGuard.ok) return userGuard;
  if (!roles.includes(userGuard.user.role)) return forbidden('Required role is missing.');
  return userGuard;
}

export function requireAdmin(req: Request): RbacGuard {
  return requireRole(req, ['admin', 'super_admin']);
}

export function normalizeProfileId(profileId: unknown, fallback = 'default'): string | null {
  const raw = typeof profileId === 'string' && profileId.trim() ? profileId.trim() : fallback;
  return PROFILE_ID_RE.test(raw) ? raw : null;
}

export function hasProfileAccess(user: SafeDeckUserContext, profileId: string): boolean {
  if (isSuperAdminRole(user.role)) return true;
  if (user.status !== 'active' || !user.capabilities.canUseApp) return false;
  return user.assignedProfileIds.includes(profileId);
}

export function requireProfileAccess(
  reqOrUser: Request | SafeDeckUserContext,
  profileId: unknown,
  options?: { fallback?: string; missingIsBadRequest?: boolean },
): RbacCheck | RbacGuard {
  const fallback = options?.fallback ?? 'default';
  const normalized = normalizeProfileId(profileId, fallback);
  if (!normalized) return badRbacRequest('invalid_profile', 'Agent id is invalid.');

  const userGuard: RbacGuard = isRequestLike(reqOrUser)
    ? requireActiveUser(reqOrUser)
    : { ok: true, user: reqOrUser };
  if (!userGuard.ok) return userGuard;

  if (!hasProfileAccess(userGuard.user, normalized)) {
    return forbidden('Agent is not assigned to this user.');
  }
  return { ok: true };
}

type ProfileLike = { id?: unknown; profileId?: unknown; name?: unknown };

export function profileIdOf(profile: ProfileLike): string | undefined {
  if (typeof profile.id === 'string' && profile.id) return profile.id;
  if (typeof profile.profileId === 'string' && profile.profileId) return profile.profileId;
  if (typeof profile.name === 'string' && profile.name) return profile.name;
  return undefined;
}

export function filterProfilesForUser<T extends ProfileLike>(user: SafeDeckUserContext, profiles: T[]): T[] {
  if (isSuperAdminRole(user.role)) return profiles;
  const allowed = new Set(user.assignedProfileIds);
  return profiles.filter((profile) => {
    const id = profileIdOf(profile);
    return !!id && allowed.has(id);
  });
}

export function profileScopeForUser(
  user: SafeDeckUserContext,
  requestedProfile?: string | null,
): { ok: true; profiles: string[]; requested?: string } | { ok: false; response: Response } {
  const requested = requestedProfile?.trim() || '';
  if (requested) {
    const normalized = normalizeProfileId(requested, requested);
    if (!normalized) return { ok: false, response: rbacJsonError(400, 'invalid_profile', 'Agent id is invalid.') };
    if (!hasProfileAccess(user, normalized)) return { ok: false, response: rbacJsonError(403, 'unauthorized', 'Agent is not assigned to this user.') };
    return { ok: true, profiles: [normalized], requested: normalized };
  }
  if (isSuperAdminRole(user.role)) return { ok: true, profiles: [] };
  const profiles = user.assignedProfileIds.filter((id) => PROFILE_ID_RE.test(id));
  if (!profiles.length) return { ok: false, response: rbacJsonError(403, 'unauthorized', 'No Agents are assigned to this user.') };
  return { ok: true, profiles };
}
