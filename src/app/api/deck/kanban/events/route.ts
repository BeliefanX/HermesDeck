import { watchBoardEvents } from '@/lib/server/hermes';
import { requireAuth } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

const BOARD_SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export async function GET(req: Request) {
  const auth = requireAuth(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const board = url.searchParams.get('board') || 'default';
  if (!BOARD_SLUG_RE.test(board)) {
    return new Response(JSON.stringify({ error: 'invalid_board' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const lastIdParam = url.searchParams.get('lastId');
  const lastId = lastIdParam ? Math.max(0, Number(lastIdParam) | 0) : 0;
  const intervalParam = url.searchParams.get('interval');
  const intervalSec = intervalParam ? Math.max(0.5, Math.min(5, Number(intervalParam))) : 1;

  // Hook into the request's AbortSignal so the Python subprocess dies as soon
  // as the client disconnects (page navigated away, EventSource closed, etc.).
  const handle = watchBoardEvents(board, { lastId, intervalSec, signal: req.signal });

  return new Response(handle.stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // Disable Nginx-style buffering when proxied.
      'X-Accel-Buffering': 'no',
    },
  });
}
