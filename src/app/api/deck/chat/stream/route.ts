import { NextRequest } from 'next/server';
import { ActiveStreamAuthorizationError, createChatStream } from '@/lib/server/hermes';
import { getDeckModelPreference } from '@/lib/server/auth';
import { guardMutating, guardRequestBody, readLimitedJson } from '@/lib/server/csrf';
import { normalizeProfileId, rbacJsonError, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';

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
  const auth = requireActiveUser(req);
  if (!auth.ok) return auth.response;

  const bodyGuard = guardRequestBody(req, { contentTypes: ['application/json'], maxBytes: MAX_REQUEST_BYTES });
  if (!bodyGuard.ok) return bodyGuard.response;
  const parsed = await readLimitedJson<Record<string, unknown>>(req, MAX_REQUEST_BYTES, {});
  if (!parsed.ok) return parsed.response;
  const body: unknown = parsed.value;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return new Response(JSON.stringify({ error: 'invalid_body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  const bodyRecord = body as Record<string, unknown>;
  const profileId = normalizeProfileId(bodyRecord.profileId, 'default');
  if (!profileId) {
    return new Response(JSON.stringify({ error: 'invalid_profile' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  const access = requireProfileAccess(auth.user, profileId, { fallback: profileId });
  if (!access.ok) return access.response;
  const hasExplicitModel = typeof bodyRecord.model === 'string' && bodyRecord.model.trim().length > 0;
  const preference = hasExplicitModel ? null : getDeckModelPreference(auth.user.id, profileId);
  const effectiveBody = {
    ...bodyRecord,
    profileId,
    ...(!hasExplicitModel && preference?.modelId ? { model: preference.modelId } : {}),
  };
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = createChatStream(effectiveBody, {
      profileId,
      ownerUserId: auth.user.id,
      ownerRole: auth.user.role,
    }, req.signal);
  } catch (error) {
    if (error instanceof ActiveStreamAuthorizationError) {
      return rbacJsonError(403, 'stream_supersede_forbidden', error.message);
    }
    throw error;
  }
  return new Response(stream, {
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
