import { NextRequest, NextResponse } from 'next/server';
import { guardMutating, guardRequestBody, readLimitedJsonObject } from '@/lib/server/csrf';
import { dispatchChatNotification, getNotificationConfig } from '@/lib/server/notifications';
import { normalizeProfileId, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 4_000;

export async function POST(req: NextRequest) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: MAX_REQUEST_BYTES });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJsonObject(req, MAX_REQUEST_BYTES);
  if (!parsed.ok) return parsed.response;

  const config = getNotificationConfig();
  if (!config.available) {
    return NextResponse.json({ ok: false, error: 'notifications_unavailable', detail: config.reason || 'vapid_not_configured', config }, { status: 503 });
  }

  const profileId = normalizeProfileId(parsed.value.profileId, 'default');
  if (!profileId) return NextResponse.json({ ok: false, error: 'invalid_profile' }, { status: 400 });
  const access = requireProfileAccess(auth.user, profileId, { fallback: profileId });
  if (!access.ok) return access.response;

  const sessionId = typeof parsed.value.sessionId === 'string' && parsed.value.sessionId.trim()
    ? parsed.value.sessionId.trim().slice(0, 160)
    : 'test';
  const result = await dispatchChatNotification({
    userId: auth.user.id,
    profileId,
    sessionId,
    kind: 'chat_completed',
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true, sent: result.sent, unavailable: result.unavailable === true });
}
