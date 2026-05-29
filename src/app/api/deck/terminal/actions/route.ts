import { NextResponse } from 'next/server';
import { listTerminalActions } from '@/lib/server/hermes';
import { requireAuth } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ actions: listTerminalActions() });
}
