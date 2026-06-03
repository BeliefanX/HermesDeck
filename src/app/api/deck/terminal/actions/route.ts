import { NextResponse } from 'next/server';
import { listTerminalActions } from '@/lib/server/hermes';
import { requireAdmin } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ actions: listTerminalActions() });
}
