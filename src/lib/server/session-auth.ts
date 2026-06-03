import {
  SESSION_COOKIE,
  toSafeUserContext,
  verifySessionToken,
  type DeckUserStatus,
  type SafeDeckUserContext,
  type VerifyResult,
} from './auth.ts';

type VerifiedSession = Extract<VerifyResult, { ok: true }>;

const PROTECTED_AUTH_SESSION_STATUSES: DeckUserStatus[] = ['active', 'pending', 'disabled', 'rejected'];

export type ProtectedSessionAuth =
  | { ok: true; session: VerifiedSession; user: SafeDeckUserContext }
  | { ok: false; reason: 'unauthenticated' }
  | { ok: false; reason: 'inactive_user'; session: VerifiedSession; user: SafeDeckUserContext };

export function readSessionCookie(req: Pick<Request, 'headers'>, name = SESSION_COOKIE): string | undefined {
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.split(/; */).find((cookie) => cookie.startsWith(`${name}=`));
  if (!match) return undefined;
  try {
    return decodeURIComponent(match.slice(name.length + 1));
  } catch (err) {
    if (err instanceof URIError) return undefined;
    throw err;
  }
}

export function inspectProtectedSessionToken(token: string | undefined | null, now = Date.now()): ProtectedSessionAuth {
  const session = verifySessionToken(token, now, { allowStatuses: PROTECTED_AUTH_SESSION_STATUSES });
  if (!session.ok) return { ok: false, reason: 'unauthenticated' };

  const user = toSafeUserContext(session.user);
  if (user.status !== 'active' || !user.capabilities.canUseApp) {
    return { ok: false, reason: 'inactive_user', session, user };
  }

  return { ok: true, session, user };
}
