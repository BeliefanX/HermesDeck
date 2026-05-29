import { NextResponse } from 'next/server';
import { getAssignees } from '@/lib/server/hermes';
import { requireAuth } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

const BOARD_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const board = url.searchParams.get('board') || 'default';
  if (!BOARD_SLUG_RE.test(board)) {
    return NextResponse.json({ error: 'invalid_board' }, { status: 400 });
  }
  try {
    const assignees = await getAssignees(board);
    return NextResponse.json({ assignees }, { headers: { 'Cache-Control': 'private, max-age=8, stale-while-revalidate=24' } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'kanban_assignees_failed', detail: msg.slice(0, 240) }, { status: 502 });
  }
}
