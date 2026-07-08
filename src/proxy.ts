import { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  cookieSecureFor,
  issueSessionToken,
} from '@/lib/server/auth';
import { inspectProtectedSessionToken } from '@/lib/server/session-auth';

// Next 16 `proxy` always runs on Node.js — runtime / matcher / route-segment
// configs are NOT allowed in this file. Path skipping is done inline instead.

// Skip-list patterns: never gate static assets, the SW bootstrap, or /offline.
// We do this in code instead of via the deprecated `config.matcher` because
// Next 16 rejects route-segment config inside proxy files.
const SKIP_PREFIXES = [
  '/_next/',
  '/icons/',
  '/workbox-',
];
const SKIP_EXACT = new Set<string>([
  '/favicon.ico',
  '/manifest.webmanifest',
  '/sw.js',
  '/offline',
  '/robots.txt',
]);

// EXACT-match list of unauthenticated routes. Prefix matching used to permit
// any future child path under these prefixes (e.g. `/login/admin-shell`) to be
// silently unauthenticated.
const PUBLIC_PATHS = new Set<string>([
  '/login',
  '/register',
  '/pending',
  '/api/deck/auth/login',
  '/api/deck/auth/logout',
  '/api/deck/auth/session',
  '/api/deck/auth/register',
  // Password-first MFA completes before a normal session cookie exists.
  // The route validates purpose-bound mfaToken for login actions and still
  // requires a protected session for enrollment/settings actions.
  '/api/deck/auth/mfa',
]);

function shouldSkip(path: string): boolean {
  if (SKIP_EXACT.has(path)) return true;
  for (const p of SKIP_PREFIXES) if (path.startsWith(p)) return true;
  return false;
}

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.has(path);
}

function isApiPath(path: string): boolean {
  return path.startsWith('/api/');
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (shouldSkip(pathname)) return NextResponse.next();
  if (isPublic(pathname)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const result = inspectProtectedSessionToken(token);

  if (!result.ok) {
    if (result.reason === 'inactive_user') {
      return NextResponse.json({ ok: false, error: 'inactive_user', detail: 'User is not active.' }, { status: 403 });
    }
    if (isApiPath(pathname)) {
      return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    if (pathname === '/') {
      return NextResponse.rewrite(url);
    }
    if (pathname && pathname !== '/login') {
      url.searchParams.set('next', pathname + (search || ''));
    }
    return NextResponse.redirect(url);
  }

  if (result.session.shouldRefresh) {
    const res = NextResponse.next();
    res.cookies.set({
      name: SESSION_COOKIE,
      value: issueSessionToken(result.user.id),
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecureFor(req),
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return res;
  }

  return NextResponse.next();
}
