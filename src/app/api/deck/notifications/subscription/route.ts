import { NextRequest, NextResponse } from 'next/server';
import { guardMutating, guardRequestBody, readLimitedJsonObject } from '@/lib/server/csrf';
import { getUserNotificationState, removePushSubscription, upsertPushSubscription } from '@/lib/server/notifications';
import { requireActiveUser } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 16_000;

export async function POST(req: NextRequest) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: MAX_REQUEST_BYTES });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJsonObject(req, MAX_REQUEST_BYTES);
  if (!parsed.ok) return parsed.response;

  const result = upsertPushSubscription(auth.user.id, parsed.value, req.headers.get('user-agent'));
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, subscriptionCount: result.subscriptionCount });
}

export async function DELETE(req: NextRequest) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: MAX_REQUEST_BYTES });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJsonObject(req, MAX_REQUEST_BYTES);
  if (!parsed.ok) return parsed.response;

  const result = removePushSubscription(auth.user.id, parsed.value.endpoint);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, subscriptionCount: result.subscriptionCount });
}

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const state = getUserNotificationState(auth.user.id);
  return NextResponse.json({ ok: true, subscriptionCount: state.subscriptions.length });
}
