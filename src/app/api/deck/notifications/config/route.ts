import { NextRequest, NextResponse } from 'next/server';
import { getNotificationConfig, getUserNotificationState } from '@/lib/server/notifications';
import { requireActiveUser } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const state = getUserNotificationState(auth.user.id);
  const config = getNotificationConfig();
  return NextResponse.json({
    ok: true,
    config,
    preferences: state.preferences,
    subscriptionCount: state.subscriptions.length,
  });
}
