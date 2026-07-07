import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { ActiveStreamAuthorizationError, createChatStream, proveProfileRoutable, SessionProfileRoutingError, type ChatStreamProjectionHooks } from '@/lib/server/hermes';
import { getDeckModelPreference } from '@/lib/server/auth';
import {
  clearProjectedResponseChain,
  finalizeProjectedTurn,
  getProjectedContinuation,
  reconcileProjectedSessionId,
  recordProjectedRunEvent,
  recordProjectedTurnError,
  startProjectedTurn,
} from '@/lib/server/deck-chat-projection';
import { guardMutating, guardRequestBody, readLimitedJson } from '@/lib/server/csrf';
import { normalizeProfileId, rbacJsonError, requireActiveUser, requireProfileAccess } from '@/lib/server/rbac';
import { dispatchChatNotification } from '@/lib/server/notifications';

export const dynamic = 'force-dynamic';

// Hard cap on the request body size. The deck only uses this endpoint to send
// the user message + (small) attachment metadata; the actual image bytes are
// already in `attachments[].dataUrl`, so 8MB leaves plenty of headroom while
// blocking obvious attacker inputs. The upstream Hermes /v1/runs cap is
// 10MB and is enforced by createChatStream.
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

function isPreviousResponseNotFound(detail?: string): boolean {
  return /previous response not found/i.test(detail || '');
}

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
  if (profileId !== 'default') {
    const proof = await proveProfileRoutable(profileId);
    if (!proof.ok) {
      return new Response(JSON.stringify({
        error: 'profile_routing_unavailable',
        detail: `Selected Agent '${profileId}' is not routable by its configured API base/key: ${proof.detail}`,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
  const hasExplicitModel = typeof bodyRecord.model === 'string' && bodyRecord.model.trim().length > 0;
  const requestedSessionId = typeof bodyRecord.sessionId === 'string' && bodyRecord.sessionId.trim()
    ? bodyRecord.sessionId.trim()
    : '';
  const hasPreviousResponseId = typeof bodyRecord.previousResponseId === 'string' && bodyRecord.previousResponseId.trim().length > 0;
  const projectionViewer = { userId: auth.user.id, role: auth.user.role };
  const projectedContinuation = requestedSessionId ? getProjectedContinuation(requestedSessionId, profileId, projectionViewer) : null;
  const projectedSessionIsTrusted = !!projectedContinuation;
  const canonicalPreviousResponseId = projectedContinuation?.responseId || '';
  const fallbackConversationHistory = !canonicalPreviousResponseId
    ? projectedContinuation?.conversationHistory
    : undefined;
  if (hasPreviousResponseId && !projectedSessionIsTrusted) {
    return rbacJsonError(
      403,
      'session_profile_unverified',
      'Cannot continue a session without a Deck-owned proof that it belongs to the selected agent.',
    );
  }
  if (hasPreviousResponseId && !canonicalPreviousResponseId && !projectedContinuation?.responseChainStale) {
    return rbacJsonError(
      403,
      'response_profile_unverified',
      'Cannot continue a response chain without a Deck-owned proof that it belongs to the selected agent session.',
    );
  }
  const generatedDeckSessionId = requestedSessionId && !projectedSessionIsTrusted
    ? `deck_${randomUUID()}`
    : '';
  const sessionIdForStream = projectedContinuation?.sessionId || generatedDeckSessionId || requestedSessionId;
  // Never forward a user/client-provided unproven session id to Hermes Agent,
  // including default profile tabs restored from stale browser state. If we had
  // to replace it above, the replacement is a
  // server-generated Deck id scoped by this authenticated request, so it is safe
  // to use as the upstream session id. That keeps the API-created runtime
  // session and the Deck projection under one id instead of showing a separate
  // "api" topic for the same turn.
  const trustedSessionIdForProfile = (requestedSessionId !== '' && projectedSessionIsTrusted)
    || generatedDeckSessionId !== '';
  const preference = hasExplicitModel ? null : getDeckModelPreference(auth.user.id, profileId);
  const effectiveBody = {
    ...bodyRecord,
    profileId,
    // The browser request body is untrusted at this boundary. Strip both public
    // history spellings after the spread so only Deck's owner/profile-proven
    // projection fallback can reach the stream layer via the private field.
    conversationHistory: undefined,
    conversation_history: undefined,
    ...(sessionIdForStream ? { sessionId: sessionIdForStream } : {}),
    ...(canonicalPreviousResponseId ? { previousResponseId: canonicalPreviousResponseId } : { previousResponseId: undefined }),
    ...(fallbackConversationHistory?.length ? { __trustedConversationHistoryForProfile: fallbackConversationHistory } : { __trustedConversationHistoryForProfile: undefined }),
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
        reconcileProjectedSessionId(requestedSessionId, sessionId, metadata.profileId, projectionViewer);
      }
    },
    onCanonicalSessionId({ oldSessionId, sessionId, profileId: projectedProfileId }) {
      reconcileProjectedSessionId(oldSessionId, sessionId, projectedProfileId, projectionViewer);
    },
    onRunEvent({ sessionId, profileId: projectedProfileId, type, payload }) {
      recordProjectedRunEvent({ sessionId, profileId: projectedProfileId, viewer: projectionViewer, type, payload });
    },
    onDone({ sessionId, profileId: projectedProfileId, content, responseId, attachments: doneAttachments, model, reasoningEffort }) {
      finalizeProjectedTurn({ sessionId, profileId: projectedProfileId, viewer: projectionViewer, content, responseId, attachments: doneAttachments, model, reasoningEffort });
      void dispatchChatNotification({ kind: 'chat_completed', userId: auth.user.id, profileId: projectedProfileId, sessionId }).catch(() => {});
    },
    onError({ sessionId, profileId: projectedProfileId, error, detail }) {
      if (canonicalPreviousResponseId && isPreviousResponseNotFound(detail)) {
        clearProjectedResponseChain({
          sessionId,
          profileId: projectedProfileId,
          viewer: projectionViewer,
          staleResponseId: canonicalPreviousResponseId,
        });
      }
      recordProjectedTurnError({ sessionId, profileId: projectedProfileId, viewer: projectionViewer, error, detail });
      void dispatchChatNotification({ kind: 'chat_failed', userId: auth.user.id, profileId: projectedProfileId, sessionId, error: detail || error }).catch(() => {});
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
    if (error instanceof SessionProfileRoutingError) {
      return new Response(JSON.stringify({ error: error.code, detail: error.message }), {
        status: error.status,
        headers: { 'Content-Type': 'application/json' },
      });
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
