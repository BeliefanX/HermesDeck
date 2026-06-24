import { NextRequest, NextResponse } from 'next/server';
import { guardMutating, guardRequestBody, readLimitedJsonObject } from '@/lib/server/csrf';
import { getUserNotificationState, saveUserNotificationPreferences } from '@/lib/server/notifications';
import { requireActiveUser } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 4_000;

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ ok: true, preferences: getUserNotificationState(auth.user.id).preferences });
}

export async function PUT(req: NextRequest) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: MAX_REQUEST_BYTES });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJsonObject(req, MAX_REQUEST_BYTES);
  if (!parsed.ok) return parsed.response;

  const preferences = saveUserNotificationPreferences(auth.user.id, {
    chatCompleted: parsed.value.chatCompleted,
    chatFailed: parsed.value.chatFailed,
    kanbanTaskCompleted: parsed.value.kanbanTaskCompleted,
    cronJobCompleted: parsed.value.cronJobCompleted,
  });
  return NextResponse.json({ ok: true, preferences });
}

export const PATCH = PUT;
