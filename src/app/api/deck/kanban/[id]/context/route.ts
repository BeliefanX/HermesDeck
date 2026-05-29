import { NextResponse } from 'next/server';
import { getTaskContext } from '@/lib/server/hermes';
import { requireAuth } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

const BOARD_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TASK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, ctx: RouteCtx) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  let id: string;
  try {
    const p = await ctx.params;
    id = p?.id;
    if (!id || !TASK_ID_RE.test(id)) {
      return NextResponse.json({ error: 'invalid_task_id' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'invalid_task_id' }, { status: 400 });
  }
  const url = new URL(req.url);
  const board = url.searchParams.get('board') || 'default';
  if (!BOARD_SLUG_RE.test(board)) {
    return NextResponse.json({ error: 'invalid_board' }, { status: 400 });
  }
  try {
    const out = await getTaskContext(board, id);
    return NextResponse.json(out, { headers: { 'Cache-Control': 'private, max-age=2' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'kanban_context_failed', detail: msg.slice(0, 240) }, { status: 502 });
  }
}
