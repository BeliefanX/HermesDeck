import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, cookieSecureFor } from '@/lib/server/auth';
import { isSameOrigin } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin request rejected.' }, { status: 403 });
  }
  // Native <form> POST sends application/x-www-form-urlencoded — detect it and
  // 303-redirect to /login so the browser navigates without needing client JS.
  // fetch() callers (Accept JSON) keep the legacy JSON contract.
  //
  // Build the redirect URL from the Origin header (the user's actual host),
  // not req.url — Next dev binds 0.0.0.0 and req.url would otherwise force the
  // browser onto a different host and drop the cookie.
  const wantsRedirect = (req.headers.get('content-type') || '').includes('form');
  let redirectTarget: URL | null = null;
  if (wantsRedirect) {
    const origin = req.headers.get('origin');
    try { redirectTarget = origin ? new URL('/login', origin) : new URL('/login', req.url); }
    catch { redirectTarget = new URL('/login', req.url); }
  }
  const res = redirectTarget
    ? NextResponse.redirect(redirectTarget, { status: 303 })
    : NextResponse.json({ ok: true });
  // Cookie attributes must mirror the issued cookie, otherwise some browsers
  // refuse to overwrite it.
  res.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecureFor(req),
    path: '/',
    maxAge: 0,
  });
  return res;
}
