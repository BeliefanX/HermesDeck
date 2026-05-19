import { NextRequest, NextResponse } from 'next/server';
import { killSession } from '@/lib/server/terminal-pty';
import { guardMutating } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    await killSession(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
