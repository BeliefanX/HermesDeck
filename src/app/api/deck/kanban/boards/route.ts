import { NextResponse } from 'next/server';
import { getBoards, setActiveBoard } from '@/lib/server/hermes';
import { guardMutating } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

const BOARD_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export async function GET() {
  try {
    const boards = await getBoards();
    return NextResponse.json(
      { boards },
      { headers: { 'Cache-Control': 'private, max-age=3, stale-while-revalidate=10' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { boards: [], error: 'kanban_boards_failed', detail: msg.slice(0, 200) },
      { status: 502 },
    );
  }
}

export async function POST(req: Request) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const slug = (body as { slug?: unknown })?.slug;
  if (typeof slug !== 'string' || !BOARD_SLUG_RE.test(slug)) {
    return NextResponse.json({ error: 'invalid_slug' }, { status: 400 });
  }
  try {
    await setActiveBoard(slug);
    return NextResponse.json({ ok: true, active: slug });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'set_active_failed', detail: msg.slice(0, 200) }, { status: 502 });
  }
}
