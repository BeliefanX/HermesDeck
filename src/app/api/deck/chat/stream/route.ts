import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { ActiveStreamAuthorizationError, createChatStream, type ChatStreamProjectionHooks } from '@/lib/server/hermes';
import { getDeckModelPreference } from '@/lib/server/auth';
import {
  finalizeProjectedTurn,
  hasProjectedSession,
  projectedResponseIdMatches,
  reconcileProjectedSessionId,
  recordProjectedTurnError,
  startProjectedTurn,
} from '@/lib/server/deck-chat-projection';
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
  const requestedSessionId = typeof bodyRecord.sessionId === 'string' && bodyRecord.sessionId.trim()
    ? bodyRecord.sessionId.trim()
    : '';
  const hasPreviousResponseId = typeof bodyRecord.previousResponseId === 'string' && bodyRecord.previousResponseId.trim().length > 0;
  const previousResponseId = hasPreviousResponseId ? (bodyRecord.previousResponseId as string).trim() : '';
  const projectedSessionIsTrusted = requestedSessionId ? hasProjectedSession(requestedSessionId, profileId) : false;
  if (profileId !== 'default' && hasPreviousResponseId && !projectedSessionIsTrusted) {
    return rbacJsonError(
      403,
      'session_profile_unverified',
      'Cannot continue a named-profile session without a Deck-owned proof that it belongs to the selected agent.',
    );
  }
  if (profileId !== 'default' && hasPreviousResponseId && !projectedResponseIdMatches(requestedSessionId, profileId, previousResponseId)) {
    return rbacJsonError(
      403,
      'response_profile_unverified',
      'Cannot continue a named-profile response chain without a Deck-owned proof that it belongs to the selected agent session.',
    );
  }
  const generatedDeckSessionId = profileId !== 'default' && requestedSessionId && !projectedSessionIsTrusted
    ? `deck_${randomUUID()}`
    : '';
  const sessionIdForStream = generatedDeckSessionId || requestedSessionId;
  // For named profiles, never forward a user/client-provided unproven session
  // id to Hermes Agent. If we had to replace it above, the replacement is a
  // server-generated Deck id scoped by this authenticated request, so it is safe
  // to use as the upstream session id. That keeps the API-created runtime
  // session and the Deck projection under one id instead of showing a separate
  // "api" topic for the same turn.
  const trustedSessionIdForProfile = profileId === 'default'
    || (requestedSessionId !== '' && projectedSessionIsTrusted)
    || generatedDeckSessionId !== '';
  const preference = hasExplicitModel ? null : getDeckModelPreference(auth.user.id, profileId);
  const effectiveBody = {
    ...bodyRecord,
    profileId,
    ...(sessionIdForStream ? { sessionId: sessionIdForStream } : {}),
    __trustedSessionIdForProfile: trustedSessionIdForProfile,
    ...(!hasExplicitModel && preference?.modelId ? { model: preference.modelId } : {}),
  };
  let stream: ReadableStream<Uint8Array>;
  const projectionHooks: ChatStreamProjectionHooks = {
    onStart({ sessionId, body: streamBody, metadata }) {
      startProjectedTurn({
        sessionId,
        profileId: metadata.profileId,
        ownerUserId: metadata.ownerUserId,
        ownerRole: metadata.ownerRole,
        message: typeof streamBody.message === 'string' ? streamBody.message : '',
        attachments: streamBody.attachments,
        model: typeof streamBody.model === 'string' ? streamBody.model : undefined,
        reasoningEffort: typeof streamBody.reasoningEffort === 'string' ? streamBody.reasoningEffort : undefined,
        previousResponseId: typeof streamBody.previousResponseId === 'string' ? streamBody.previousResponseId : undefined,
      });
      if (requestedSessionId && requestedSessionId !== sessionId) {
        reconcileProjectedSessionId(requestedSessionId, sessionId, metadata.profileId);
      }
    },
    onCanonicalSessionId({ oldSessionId, sessionId, profileId: projectedProfileId }) {
      reconcileProjectedSessionId(oldSessionId, sessionId, projectedProfileId);
    },
    onDone({ sessionId, profileId: projectedProfileId, content, responseId, attachments: doneAttachments, model, reasoningEffort }) {
      finalizeProjectedTurn({ sessionId, profileId: projectedProfileId, content, responseId, attachments: doneAttachments, model, reasoningEffort });
    },
    onError({ sessionId, profileId: projectedProfileId, error, detail }) {
      recordProjectedTurnError({ sessionId, profileId: projectedProfileId, error, detail });
    },
  };
  try {
    stream = createChatStream(effectiveBody, {
      profileId,
      ownerUserId: auth.user.id,
      ownerRole: auth.user.role,
    }, req.signal, projectionHooks);
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
