import { NextRequest, NextResponse } from 'next/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { SESSION_COOKIE, SESSION_TTL_MS, cookieSecureFor, issueSessionToken, rateLimitCheck, rateLimitRecordFailure, rateLimitReset, setUserTotp, verifyPassword, verifySessionToken } from '@/lib/server/auth';
import { guardRequestBody, isSameOrigin, readLimitedJson } from '@/lib/server/csrf';
import { consumeMfaToken, generateTotpSecret, isWebAuthnConfigurationError, makeAuthenticationOptions, makeRegistrationOptions, otpauthUri, peekMfaToken, totpQrDataUrl, userMfaFactors, verifyAuthentication, verifyRegistration, verifyTotp } from '@/lib/server/mfa';

export const dynamic = 'force-dynamic';

type Body = {
  action?: string;
  currentPassword?: string;
  code?: string;
  secret?: string;
  mfaToken?: string;
  challengeId?: string;
  response?: unknown;
  name?: string;
};

export async function GET(req: NextRequest) {
  const session = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session.ok) return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  return NextResponse.json({ ok: true, mfa: userMfaFactors(session.user) });
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ ok: false, error: 'Cross-origin request rejected.' }, { status: 403 });
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 32_000 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJson<Body>(req, 32_000, {});
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  if (body.action === 'login-totp') return finishTotp(req, body);
  if (body.action === 'passkey-login-options') return passkeyLoginOptions(req, body);
  if (body.action === 'passkey-login-verify') return finishPasskey(req, body);

  const session = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session.ok) return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });

  if (body.action === 'totp-enroll-start') {
    if (!verifyPassword(body.currentPassword || '', session.user.id)) return NextResponse.json({ ok: false, error: 'Current password is incorrect.' }, { status: 401 });
    const secret = generateTotpSecret();
    const otpauth = otpauthUri(session.user, secret);
    return NextResponse.json({ ok: true, secret, otpauth, qrDataUrl: await totpQrDataUrl(otpauth) });
  }
  if (body.action === 'totp-enroll-confirm') {
    if (!verifyPassword(body.currentPassword || '', session.user.id)) return NextResponse.json({ ok: false, error: 'Current password is incorrect.' }, { status: 401 });
    if (!body.secret || !verifyTotp(body.secret, body.code || '')) return NextResponse.json({ ok: false, error: 'Invalid TOTP code.' }, { status: 400 });
    const saved = setUserTotp(session.user.id, body.secret);
    if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'totp-disable') {
    if (!verifyPassword(body.currentPassword || '', session.user.id)) return NextResponse.json({ ok: false, error: 'Current password is incorrect.' }, { status: 401 });
    const secret = session.user.mfa?.totp?.secret;
    if (secret && !verifyTotp(secret, body.code || '')) return NextResponse.json({ ok: false, error: 'Invalid TOTP code.' }, { status: 400 });
    const saved = setUserTotp(session.user.id, null);
    if (!saved.ok) return NextResponse.json({ ok: false, error: saved.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  if (body.action === 'passkey-register-options') {
    if (!verifyPassword(body.currentPassword || '', session.user.id)) return NextResponse.json({ ok: false, error: 'Current password is incorrect.' }, { status: 401 });
    try {
      const out = await makeRegistrationOptions(session.user, req, body.name);
      return NextResponse.json({ ok: true, ...out });
    } catch (error) {
      return webAuthnConfigError(error);
    }
  }
  if (body.action === 'passkey-register-verify') {
    try {
      const result = await verifyRegistration(session.user.id, body.challengeId || '', body.response as RegistrationResponseJSON, req, body.name);
      return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    } catch (error) {
      return webAuthnConfigError(error);
    }
  }

  return NextResponse.json({ ok: false, error: 'Unknown MFA action.' }, { status: 400 });
}

function issueLogin(req: NextRequest, userId: string) {
  const token = issueSessionToken(userId);
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: SESSION_COOKIE, value: token, httpOnly: true, sameSite: 'lax', secure: cookieSecureFor(req), path: '/', maxAge: Math.floor(SESSION_TTL_MS / 1000) });
  return res;
}

function clientIp(req: NextRequest): string {
  if (process.env.HERMESDECK_TRUST_PROXY === '1') return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim() || 'local';
  return 'local';
}

function mfaLimitKey(req: NextRequest, userId: string) {
  return `mfa|${clientIp(req)}|${userId}`;
}

function finishTotp(req: NextRequest, body: Body) {
  const token = body.mfaToken || '';
  const user = peekMfaToken(token);
  const key = mfaLimitKey(req, user?.id || 'invalid');
  const limit = rateLimitCheck(key);
  if (!limit.allowed) return NextResponse.json({ ok: false, error: 'Too many failed attempts. Try again later.' }, { status: 429 });
  const secret = user?.mfa?.totp?.secret;
  if (!user || !secret || !verifyTotp(secret, body.code || '')) {
    rateLimitRecordFailure(key);
    return NextResponse.json({ ok: false, error: 'Invalid MFA code.' }, { status: 401 });
  }
  consumeMfaToken(token);
  rateLimitReset(key);
  return issueLogin(req, user.id);
}

async function passkeyLoginOptions(req: NextRequest, body: Body) {
  const user = peekMfaToken(body.mfaToken || '');
  if (!user || !(user.mfa?.passkeys?.length)) return NextResponse.json({ ok: false, error: 'Invalid MFA challenge.' }, { status: 401 });
  try {
    const out = await makeAuthenticationOptions(user, req);
    return NextResponse.json({ ok: true, ...out });
  } catch (error) {
    return webAuthnConfigError(error);
  }
}

async function finishPasskey(req: NextRequest, body: Body) {
  const token = body.mfaToken || '';
  const user = peekMfaToken(token);
  if (!user) return NextResponse.json({ ok: false, error: 'Invalid MFA challenge.' }, { status: 401 });
  try {
    const result = await verifyAuthentication(user, body.challengeId || '', body.response as AuthenticationResponseJSON, req);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 401 });
    consumeMfaToken(token);
    return issueLogin(req, user.id);
  } catch (error) {
    return webAuthnConfigError(error);
  }
}

function webAuthnConfigError(error: unknown): NextResponse {
  if (!isWebAuthnConfigurationError(error)) throw error;
  return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
}
