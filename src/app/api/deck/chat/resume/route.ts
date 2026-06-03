import { NextRequest } from 'next/server';
import { getActiveStream, resumeChatStream } from '@/lib/server/hermes';
import { isAdminRole, requireActiveUser, requireProfileAccess, rbacJsonError } from '@/lib/server/rbac';

export const dynamic = 'force-dynamic';

// GET /api/deck/chat/resume?sessionId=...&since=NN
//
// Subscribes to an already-running chat stream in the in-process hub. Replays
// the buffered events from `since` (exclusive), then live events. Lets the
// client re-attach after a page refresh without losing the running task.
//
// Returns 404 when no active or recently-completed stream exists for the
// session — the caller should treat that as "the run is already over,
// re-fetch messages from /api/deck/sessions/:id/messages".
//
// This endpoint is GET and idempotent (no upstream side effects), so we don't
// run it through guardMutating(); it still exposes private in-flight chat data
// and must require a valid session cookie.
export async function GET(req: NextRequest) {
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;
  const url = new URL(req.url);
  const sessionId = (url.searchParams.get('sessionId') || '').trim();
  const profileId = (url.searchParams.get('profileId') || url.searchParams.get('profile') || '').trim();
  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'missing_session_id' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  const active = getActiveStream(sessionId);
  if (!active) {
    return new Response(JSON.stringify({ error: 'not_found', sessionId }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (profileId && profileId !== active.profileId) {
    return rbacJsonError(403, 'unauthorized', 'Requested profile does not own this stream.');
  }
  const access = requireProfileAccess(auth.user, active.profileId, { fallback: active.profileId });
  if (!access.ok) return access.response;
  if (active.ownerUserId !== auth.user.id && !isAdminRole(auth.user.role)) {
    return rbacJsonError(403, 'unauthorized', 'Stream belongs to another user.');
  }
  // Reasonable bound — anything beyond a few thousand events is nonsense and
  // also bigger than our buffer cap, so fall through to gap-detection.
  const sinceRaw = Number(url.searchParams.get('since') || '0');
  const since = Number.isFinite(sinceRaw) && sinceRaw >= 0 ? Math.min(sinceRaw, 1_000_000) : 0;

  const stream = resumeChatStream(sessionId, since);
  if (!stream) return new Response(JSON.stringify({ error: 'not_found', sessionId }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
