import { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  cookieSecureFor,
  getUsername,
  issueSessionToken,
  rateLimitCheck,
  rateLimitRecordFailure,
  rateLimitReset,
  verifyPassword,
} from '@/lib/server/auth';
import { isSameOrigin } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

function clientIp(req: NextRequest): string {
  // X-Forwarded-For is client-spoofable when no reverse proxy is stripping it.
  // Only honor it when HERMESDECK_TRUST_PROXY=1 (operator promise).
  const trustProxy = process.env.HERMESDECK_TRUST_PROXY === '1';
  if (trustProxy) {
    const xf = req.headers.get('x-forwarded-for');
    if (xf) return xf.split(',')[0]!.trim();
    const xr = req.headers.get('x-real-ip');
    if (xr) return xr.trim();
  }
  return 'local';
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin request rejected.' }, { status: 403 });
  }
  let body: { username?: string; password?: string };
  try { body = await req.json(); } catch { body = {}; }
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) {
    return NextResponse.json({ ok: false, error: 'Missing credentials.' }, { status: 400 });
  }

  const ip = clientIp(req);
  const limitKey = `${ip}|${username.toLowerCase()}`;
  const limit = rateLimitCheck(limitKey);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Too many failed attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  // Always run verifyPassword, even when the username is wrong, so that timing
  // does not leak whether the username exists.
  const passwordOk = verifyPassword(password);
  const usernameOk = username === getUsername();
  if (!usernameOk || !passwordOk) {
    rateLimitRecordFailure(limitKey);
    return NextResponse.json({ ok: false, error: 'Invalid username or password.' }, { status: 401 });
  }

  rateLimitReset(limitKey);
  const token = issueSessionToken();
  const res = NextResponse.json({ ok: true, username: getUsername() });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecureFor(req),
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
