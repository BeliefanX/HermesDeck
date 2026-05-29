import { NextResponse } from 'next/server';
import { getBoards, setActiveBoard } from '@/lib/server/hermes';
import { guardMutating, guardRequestBody, readLimitedJson, requireAuth } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

const BOARD_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
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
  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: 16_000 });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJson(req, 16_000);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value;
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
