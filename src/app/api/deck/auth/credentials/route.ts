import { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  cookieSecureFor,
  issueSessionToken,
  updatePassword,
  updateUsername,
  verifyPassword,
  verifySessionToken,
} from '@/lib/server/auth';
import { guardRequestBody, readLimitedJson, isSameOrigin } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin request rejected.' }, { status: 403 });
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = verifySessionToken(token);
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
  }

  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 16_000 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJson<{ currentPassword?: string; newUsername?: string; newPassword?: string }>(req, 16_000, {});
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;

  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newUsername = typeof body.newUsername === 'string' ? body.newUsername.trim() : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!newUsername && !newPassword) {
    return NextResponse.json({ ok: false, error: 'Nothing to update.' }, { status: 400 });
  }
  if (!currentPassword || !verifyPassword(currentPassword, session.user.id)) {
    return NextResponse.json({ ok: false, error: 'Current password is incorrect.' }, { status: 401 });
  }

  if (newUsername && newUsername !== session.user.username) {
    const r = updateUsername(newUsername, session.user.id);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
  }

  let passwordChanged = false;
  if (newPassword) {
    const r = updatePassword(currentPassword, newPassword, session.user.id);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
    passwordChanged = true;
  }

  const freshSession = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  const username = freshSession.ok ? freshSession.user.username : newUsername || session.user.username;
  const res = NextResponse.json({ ok: true, username, passwordChanged });
  const fresh = issueSessionToken(session.user.id);
  res.cookies.set({
    name: SESSION_COOKIE,
    value: fresh,
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecureFor(req),
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}
