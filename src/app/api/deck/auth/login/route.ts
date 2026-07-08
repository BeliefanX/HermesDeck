import { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  authenticateUser,
  cookieSecureFor,
  issueSessionToken,
  rateLimitCheck,
  rateLimitRecordFailure,
  rateLimitReset,
  toSafeUserContext,
} from '@/lib/server/auth';
import { guardRequestBody, readLimitedJson, isSameOrigin } from '@/lib/server/csrf';
import { hasMfa, makeMfaToken, userMfaFactors } from '@/lib/server/mfa';

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
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 16_000 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJson<{ username?: string; password?: string }>(req, 16_000, {});
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
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

  // authenticateUser always runs a password hash, even for unknown users, so
  // timing does not leak whether the username exists.
  const auth = authenticateUser(username, password, { allowStatuses: ['active', 'pending'] });
  if (!auth.ok) {
    rateLimitRecordFailure(limitKey);
    return NextResponse.json({ ok: false, error: 'Invalid username or password.' }, { status: 401 });
  }

  rateLimitReset(limitKey);
  if (auth.user.status === 'pending') {
    return NextResponse.json({
      ok: true,
      pending: true,
      status: 'pending',
      message: 'Your account is pending administrator approval.',
      user: toSafeUserContext(auth.user),
    });
  }

  if (hasMfa(auth.user)) {
    return NextResponse.json({
      ok: true,
      pending: false,
      mfaRequired: true,
      mfaToken: makeMfaToken(auth.user.id),
      factors: userMfaFactors(auth.user),
    });
  }

  const token = issueSessionToken(auth.user.id);
  const res = NextResponse.json({
    ok: true,
    pending: false,
    username: auth.user.username,
    role: auth.user.role,
    status: auth.user.status,
    user: toSafeUserContext(auth.user),
  });
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
