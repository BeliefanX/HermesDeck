import { NextRequest, NextResponse } from 'next/server';
import { deleteSession } from '@/lib/server/hermes';
import { guardMutating } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const profile = req.nextUrl.searchParams.get('profile') || 'default';
  try {
    const result = await deleteSession(decodeURIComponent(id), profile);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, removed: 0, error: 'session_delete_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}
