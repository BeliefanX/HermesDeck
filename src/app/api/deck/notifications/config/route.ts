import { NextRequest, NextResponse } from 'next/server';
import { getNotificationConfigForUser } from '@/lib/server/notifications';
import { requireActiveUser } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ ok: true, ...getNotificationConfigForUser(auth.user.id) });
}
