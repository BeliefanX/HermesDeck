import { NextRequest, NextResponse } from 'next/server';
import { resizeSession } from '@/lib/server/terminal-pty';
import { guardMutating } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    resizeSession(id, Number(body?.cols), Number(body?.rows));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
