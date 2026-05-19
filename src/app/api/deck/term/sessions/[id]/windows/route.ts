import { NextRequest, NextResponse } from 'next/server';
import { listWindows } from '@/lib/server/terminal-pty';
import { requireAuth } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    return NextResponse.json({ windows: await listWindows(id) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
