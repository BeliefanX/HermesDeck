import { NextRequest, NextResponse } from 'next/server';
import { registerPendingUser } from '@/lib/server/auth';
import { guardRequestBody, readLimitedJson, isSameOrigin } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

type RegisterBody = {
  username?: unknown;
  password?: unknown;
  displayName?: unknown;
  email?: unknown;
};

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: 'Cross-origin request rejected.' }, { status: 403 });
  }
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 16_000 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJson<RegisterBody>(req, 16_000, {});
  if (!parsed.ok) return parsed.response;

  const result = registerPendingUser(parsed.value);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.code === 'duplicate' ? 409 : 400 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      status: 'pending',
      pending: true,
      message: 'Registration received. An administrator must approve this account before app access is enabled.',
      user: result.user,
    },
    { status: 201 },
  );
}
