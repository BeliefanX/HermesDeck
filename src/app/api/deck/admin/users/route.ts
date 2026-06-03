import { NextRequest, NextResponse } from 'next/server';
import { listSafeDeckUsers } from '@/lib/server/auth';
import { requireAdmin } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ ok: true, users: listSafeDeckUsers() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: 'admin_users_list_failed', detail: msg.slice(0, 200) },
      { status: 500 },
    );
  }
}
