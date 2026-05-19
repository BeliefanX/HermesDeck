import { NextRequest } from 'next/server';
import { createChatStream } from '@/lib/server/hermes';
import { guardMutating } from '@/lib/server/csrf';

export const dynamic = 'force-dynamic';

// Hard cap on the request body size. The deck only uses this endpoint to send
// the user message + (small) attachment metadata; the actual image bytes are
// already in `attachments[].dataUrl`, so 8MB leaves plenty of headroom while
// blocking obvious attacker inputs. The upstream Hermes /v1/responses cap is
// 1MB and is enforced by createChatStream.
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const guard = guardMutating(req);
  if (!guard.ok) return guard.response;

  const ct = req.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('application/json')) {
    return new Response(JSON.stringify({ error: 'expected application/json' }), {
      status: 415, headers: { 'Content-Type': 'application/json' },
    });
  }
  const cl = Number(req.headers.get('content-length') || '0');
  if (cl > MAX_REQUEST_BYTES) {
    return new Response(JSON.stringify({ error: 'payload_too_large', limit: MAX_REQUEST_BYTES }), {
      status: 413, headers: { 'Content-Type': 'application/json' },
    });
  }
  const text = await req.text().catch(() => '');
  if (text.length > MAX_REQUEST_BYTES) {
    return new Response(JSON.stringify({ error: 'payload_too_large', limit: MAX_REQUEST_BYTES }), {
      status: 413, headers: { 'Content-Type': 'application/json' },
    });
  }
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; }
  catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return new Response(JSON.stringify({ error: 'invalid_body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(createChatStream(body, req.signal), {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx / Cloudflare default to buffering text/event-stream which
      // breaks the heartbeat-as-keepalive trick. This header is the
      // canonical opt-out.
      'X-Accel-Buffering': 'no',
    },
  });
}
