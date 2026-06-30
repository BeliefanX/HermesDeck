import { NextResponse } from 'next/server';
import { listMarkdownFiles } from '@/lib/server/hermes';
import { requireAuth } from '@/lib/server/csrf';
import { isKnownUnavailableError, statusForUnexpectedError } from '../../../_unavailable';

export const dynamic = 'force-dynamic';

const BOARD_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TASK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, ctx: RouteCtx) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  const params = await ctx.params;
  if (!params || !TASK_ID_RE.test(params.id)) {
    return NextResponse.json({ error: 'invalid_task_id' }, { status: 400 });
  }
  const url = new URL(req.url);
  const board = url.searchParams.get('board') || 'default';
  if (!BOARD_SLUG_RE.test(board)) {
    return NextResponse.json({ error: 'invalid_board' }, { status: 400 });
  }
  try {
    const r = await listMarkdownFiles(board, params.id);
    return NextResponse.json(r, { headers: { 'Cache-Control': 'private, max-age=3, stale-while-revalidate=10' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isKnownUnavailableError(err)) {
      return NextResponse.json({ error: 'kanban_markdown_failed', detail: msg.slice(0, 240) }, { status: statusForUnexpectedError(err) });
    }
    return NextResponse.json({ root: null, entries: [], unavailableReason: msg.slice(0, 240) }, { headers: { 'Cache-Control': 'private, max-age=10, stale-while-revalidate=60' } });
  }
}
