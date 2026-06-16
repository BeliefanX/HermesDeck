import {
  PROFILE_ID_RE,
  apiHeaders,
  combineAbortSignals,
  getHermesApiBase,
  redactSecrets,
} from './core';
import {
  buildPromptWithAttachments,
  extractAttachmentsFromEvent,
  normalizeAttachments,
  type EmittedAttachment,
} from './attachments';
import {
  createActiveStream,
  emitToHub,
  eventsSince,
  getActiveStream,
  hasGap,
  markStreamDone,
  type ActiveStream,
  type ActiveStreamMetadata,
  type HubEvent,
} from './stream-hub';

export interface ChatStreamBody {
  message?: unknown;
  profileId?: unknown;
  model?: unknown;
  reasoningEffort?: unknown;
  previousResponseId?: unknown;
  sessionId?: unknown;
  attachments?: unknown;
  timeoutMs?: unknown;
  /** Server-computed: only true when Deck has proven this session id belongs to the requested profile. */
  __trustedSessionIdForProfile?: unknown;
}

export interface ChatStreamProjectionHooks {
  onStart?: (input: { sessionId: string; body: ChatStreamBody; metadata: ActiveStreamMetadata }) => void;
  onCanonicalSessionId?: (input: { oldSessionId: string; sessionId: string; profileId: string }) => void;
  onDone?: (input: { sessionId: string; profileId: string; content?: string; responseId?: string; attachments?: unknown; model?: string; reasoningEffort?: string }) => void;
  onError?: (input: { sessionId: string; profileId: string; error: string; detail?: string }) => void;
}

function runProjectionHook(fn: (() => void) | undefined): void {
  if (!fn) return;
  try { fn(); } catch { /* projection failures must not break live chat */ }
}

// Hermes /v1/responses currently rejects request bodies > 1MB. We pre-check
// here so the user sees a useful error rather than the upstream's truncated
// 413 with the full URL in the message.
const HERMES_REQUEST_BODY_BYTE_LIMIT = 1_000_000;

// Server emits a heartbeat every 15s while the stream is running so:
//   - upstream proxies (nginx, Cloudflare) don't drop an "idle" connection
//   - the client watchdog has a steady byte signal even during long tool calls
const HEARTBEAT_INTERVAL_MS = 15_000;
// SSE encoding helper: same wire format as core.sendSse but operates on
// arbitrary write callbacks so it can plug into a hub-subscriber lambda.
function encodeSseFrame(event: string, jsonData: string): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${jsonData}\n\n`);
}

function safeRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeObservedReasoning(value: unknown): string | undefined {
  const raw = firstString(value)?.toLowerCase();
  return raw && raw !== 'auto' ? raw : undefined;
}

/** Extract the effective runtime model/reasoning when Hermes exposes it in
 * stream events. The final response object is the source of truth; request-body
 * values are only a pre-flight override and must not be treated as observed. */
export function extractRuntimeSettingsFromEvent(obj: unknown): { model?: string; reasoningEffort?: string } {
  const root = safeRecord(obj);
  if (!root) return {};
  const response = safeRecord(root.response);
  const item = safeRecord(root.item);
  const reasoning = safeRecord(root.reasoning) || safeRecord(response?.reasoning) || safeRecord(item?.reasoning);
  const model = firstString(
    response?.model,
    response?.current_model,
    response?.currentModel,
    root.model,
    root.current_model,
    root.currentModel,
    item?.model,
  );
  const reasoningEffort = normalizeObservedReasoning(
    reasoning?.effort
      ?? root.reasoning_effort
      ?? root.reasoningEffort
      ?? root.current_reasoning_effort
      ?? root.currentReasoningEffort
      ?? response?.reasoning_effort
      ?? response?.reasoningEffort
      ?? response?.current_reasoning_effort
      ?? response?.currentReasoningEffort
      ?? item?.reasoning_effort
      ?? item?.reasoningEffort,
  );
  return { ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}) };
}

function safeEnqueue(controller: ReadableStreamDefaultController<Uint8Array>, frame: Uint8Array): boolean {
  try {
    controller.enqueue(frame);
    return true;
  } catch {
    return false;
  }
}

// `: ...` is the SSE comment syntax — it keeps the connection alive without
// triggering an event listener on the client.
function encodeHeartbeatComment(): Uint8Array {
  return new TextEncoder().encode(`: keep-alive ${Date.now()}\n\n`);
}

interface SubscribeOptions {
  /** Replay buffered events with seq > since before going live. */
  since?: number;
  /** Called once with `{ ok, gap }` after replay completes. */
  onReplayDone?: (info: { gap: boolean; replayed: number }) => void;
}

/** Build a ReadableStream that subscribes to the given hub stream and forwards
 *  every emitted event as an SSE frame to the client. The returned stream ends
 *  when the upstream marks itself done OR the client cancels (we just detach,
 *  the upstream keeps running into the hub buffer). */
function buildSubscriberStream(stream: ActiveStream, opts: SubscribeOptions = {}): ReadableStream<Uint8Array> {
  let unsub: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const cleanup = () => {
    closed = true;
    if (unsub) { unsub(); unsub = null; }
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  };
  const finish = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    cleanup();
    try { controller.close(); } catch {}
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const since = typeof opts.since === 'number' && opts.since >= 0 ? opts.since : 0;
      const gap = hasGap(stream, since);
      const replay = eventsSince(stream, since);
      safeEnqueue(controller, encodeSseFrame('hub', JSON.stringify({
        sessionId: stream.sessionId,
        startedAt: stream.startedAt,
        latestSeq: stream.nextSeq - 1,
        gap,
      })));
      for (const ev of replay) {
        if (closed) return;
        safeEnqueue(controller, encodeSseFrame(ev.event, ev.data));
      }
      opts.onReplayDone?.({ gap, replayed: replay.length });

      if (stream.done) {
        finish(controller);
        return;
      }

      const onEvent = (ev: HubEvent) => {
        if (closed) return;
        safeEnqueue(controller, encodeSseFrame(ev.event, ev.data));
        if (ev.event === 'done' || ev.event === 'error') {
          // Detach from the hub immediately — we don't want any further
          // events to fire our handler, and the controller is about to close.
          // Use a microtask to allow any in-flight emit to finish first.
          setTimeout(() => {
            if (closed) return;
            finish(controller);
          }, 0);
        }
      };
      stream.subscribers.add(onEvent);
      unsub = () => stream.subscribers.delete(onEvent);

      heartbeat = setInterval(() => {
        if (closed) {
          if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
          return;
        }
        if (!safeEnqueue(controller, encodeHeartbeatComment())) {
          // Controller already closed — treat as a graceful detach.
          cleanup();
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      // Client tab closed / refresh / new request — just detach. The hub keeps
      // the upstream running; a refresh can resume against the same sessionId.
      cleanup();
    },
  });
}

/** Start the upstream fetch + parse loop in the background, feeding all events
 *  into the hub. Resolves once the upstream stream has terminated (success or
 *  error). The returned promise is not awaited by the route — its purpose is
 *  to keep error handling co-located. */
async function pumpUpstream(stream: ActiveStream, body: ChatStreamBody, hooks?: ChatStreamProjectionHooks): Promise<void> {
  emitToHub(stream, 'status', {
    phase: 'connecting',
    backend: 'hermes-api-server',
    profile: stream.profileId,
    sessionId: stream.sessionId,
  });
  const message = typeof body?.message === 'string' ? body.message : '';
  const rawProfile = stream.profileId || (typeof body?.profileId === 'string' ? body.profileId : 'default');
  const profile = PROFILE_ID_RE.test(rawProfile) ? rawProfile : 'default';
  const model = typeof body?.model === 'string' ? body.model : undefined;
  const reasoningEffort = typeof body?.reasoningEffort === 'string' ? body.reasoningEffort : undefined;
  const previousResponseId = typeof body?.previousResponseId === 'string' ? body.previousResponseId : undefined;
  // Only a Deck-trusted session id may be forwarded to Hermes or treated as a
  // continuation handle. For named profiles, the route replaces unproven
  // client-provided ids with a server-generated Deck id before setting this
  // flag, so the upstream runtime session can share Deck's projection id
  // without accepting arbitrary cross-profile continuation handles.
  const clientSessionId = typeof body?.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : '';
  const canForwardClientSessionId = body?.__trustedSessionIdForProfile !== false;
  const profileMatchesClientSession = (sessionId: string) => {
    if (!sessionId || sessionId === stream.sessionId) return;
    runProjectionHook(() => hooks?.onCanonicalSessionId?.({ oldSessionId: stream.sessionId, sessionId, profileId: profile }));
  };
  const attachments = normalizeAttachments(body?.attachments);
  const hasImages = attachments.some((a) => a.kind === 'image');
  const enrichedMessage = buildPromptWithAttachments(message, attachments);

  let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  // Detach the upstream if the hub itself is aborted (e.g. another send for
  // the same session, or the eviction timer fires).
  stream.abort.signal.addEventListener('abort', () => {
    if (upstreamReader) { try { upstreamReader.cancel('hub-abort'); } catch {} }
  }, { once: true });

  // Long tasks are common with tool-heavy prompts. Default cap is 30 min.
  // Client may request a smaller value but we never exceed the hard ceiling.
  const HARD_TIMEOUT_MS = 30 * 60 * 1000;
  const requestedTimeout = Number(body?.timeoutMs || 600_000);
  const timeoutMs = Math.min(Math.max(1000, requestedTimeout), HARD_TIMEOUT_MS);

  try {
    const inputForApi: unknown = hasImages
      ? [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: enrichedMessage },
              ...attachments
                .filter((a) => a.kind === 'image' && a.dataUrl)
                .map((a) => ({
                  type: 'input_image',
                  image_url: { url: a.dataUrl as string, detail: 'auto' },
                })),
            ],
          },
        ]
      : enrichedMessage;
    const apiBody: Record<string, unknown> = { input: inputForApi, stream: true };
    if (model) apiBody.model = model;
    if (reasoningEffort && reasoningEffort !== 'auto') apiBody.reasoning = { effort: reasoningEffort };
    if (previousResponseId) apiBody.previous_response_id = previousResponseId;
    apiBody.metadata = {
      ...((apiBody.metadata && typeof apiBody.metadata === 'object') ? apiBody.metadata as Record<string, unknown> : {}),
      profileId: profile,
      source: 'hermesdeck',
    };
    const apiBodyJson = JSON.stringify(apiBody);
    if (apiBodyJson.length > HERMES_REQUEST_BODY_BYTE_LIMIT) {
      runProjectionHook(() => hooks?.onError?.({
        sessionId: stream.sessionId,
        profileId: profile,
        error: 'payload_too_large',
        detail: 'Total request size exceeds the upstream 1MB cap — shrink any image attachments and retry.',
      }));
      emitToHub(stream, 'error', {
        error: 'payload_too_large',
        backend: 'hermes-api-server',
        byteSize: apiBodyJson.length,
        limit: HERMES_REQUEST_BODY_BYTE_LIMIT,
        hint: 'Total request size exceeds the upstream 1MB cap — shrink any image attachments and retry.',
      });
      markStreamDone(stream);
      return;
    }

    const apiBase = getHermesApiBase(profile);
    if (!apiBase) {
      const detail = `Selected Hermes profile '${profile}' has no configured API server base/port; refusing to route chat to the default profile API.`;
      runProjectionHook(() => hooks?.onError?.({
        sessionId: stream.sessionId,
        profileId: profile,
        error: 'profile_routing_unavailable',
        detail,
      }));
      emitToHub(stream, 'error', {
        error: 'profile_routing_unavailable',
        detail,
        backend: 'hermes-api-server',
        profile,
      });
      markStreamDone(stream);
      return;
    }

    const reqHeaders = { ...apiHeaders(profile) } as Record<string, string>;
    if (clientSessionId && canForwardClientSessionId && reqHeaders.Authorization) {
      reqHeaders['X-Hermes-Session-Id'] = clientSessionId;
    }

    const fetchSignal = combineAbortSignals([AbortSignal.timeout(timeoutMs), stream.abort.signal]);
    const response = await fetch(`${apiBase.replace(/\/+$/, '')}/v1/responses`, {
      method: 'POST', headers: reqHeaders, body: apiBodyJson, signal: fetchSignal,
    });
    if (!response.ok || !response.body) {
      const rawBody = await response.text().catch(() => '');
      const safe = redactSecrets(rawBody.slice(0, 480));
      throw new Error(`Hermes API Server /v1/responses failed: ${response.status} ${safe}`);
    }
    const sessionId = response.headers.get('X-Hermes-Session-Id')
      || (canForwardClientSessionId ? clientSessionId : stream.sessionId)
      || '';
    profileMatchesClientSession(sessionId);
    emitToHub(stream, 'status', { phase: 'streaming', backend: 'hermes-api-server', profile, sessionId });

    const reader = response.body.getReader();
    upstreamReader = reader;
    const decoder = new TextDecoder();
    let full = '';
    let responseId = '';
    let observedModel = '';
    let observedReasoningEffort = '';
    let buf = '';
    const emittedAtts: EmittedAttachment[] = [];
    const seenAttKeys = new Set<string>();
    const noteAttachments = (obj: unknown) => {
      const found = extractAttachmentsFromEvent(obj);
      for (const att of found) {
        const key = att.dataUrl ? att.dataUrl.slice(0, 80) : (att.url || `${att.name}|${att.size}`);
        if (seenAttKeys.has(key)) continue;
        seenAttKeys.add(key);
        emittedAtts.push(att);
        emitToHub(stream, 'attachment', att);
      }
    };

    // Only `output_text` deltas go into the assistant message bubble. Tool-call
    // argument deltas (`response.function_call_arguments.delta`,
    // `response.tool_call.*.delta`, etc.) ALSO carry a `delta` field but it's
    // JSON args, not user-facing text — they were previously leaking into the
    // chat bubble as if the model had typed them.
    const isTextDeltaType = (t: string) =>
      t === 'response.output_text.delta' ||
      t === 'response.output_text_delta' ||
      t === 'response.text.delta' ||
      t === 'message.delta' ||
      t === 'output_text.delta';

    const consume = (block: string) => {
      const dataLines = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart());
      if (!dataLines.length) return;
      const raw = dataLines.join('\n');
      if (raw === '[DONE]') return;
      try {
        const obj = JSON.parse(raw);
        const type = String(obj.type || obj.event || '');
        const candidateResponseId = obj?.response?.id || obj?.item?.id || (type.startsWith('response.') ? obj.id : undefined);
        if (candidateResponseId && !responseId) responseId = String(candidateResponseId);
        const observed = extractRuntimeSettingsFromEvent(obj);
        if (observed.model) observedModel = observed.model;
        if (observed.reasoningEffort) observedReasoningEffort = observed.reasoningEffort;

        // Always forward the raw event so the client can render tool calls,
        // skill events, subagent delegations, etc. into the chat thread.
        emitToHub(stream, 'run-event', { type: type || 'api.event', payload: obj, ts: Date.now() });

        // Pluck out any image / file artifacts.
        noteAttachments(obj);

        // Text-only delta extraction.
        const isTextDelta = isTextDeltaType(type);
        const choiceDelta = obj?.choices?.[0]?.delta?.content;
        if (isTextDelta) {
          const deltaRaw = obj.delta ?? obj.output_text_delta ?? choiceDelta;
          if (typeof deltaRaw === 'string' && deltaRaw) {
            full += deltaRaw;
            emitToHub(stream, 'delta', { delta: deltaRaw });
          } else if (Array.isArray(deltaRaw)) {
            for (const part of deltaRaw) {
              if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
                const t = String((part as { text: string }).text);
                if (t) {
                  full += t;
                  emitToHub(stream, 'delta', { delta: t });
                }
              }
            }
          }
        } else if (typeof choiceDelta === 'string' && choiceDelta && !type) {
          // Older OpenAI Chat Completions shape (no `type`). Treat
          // choices[0].delta.content as text.
          full += choiceDelta;
          emitToHub(stream, 'delta', { delta: choiceDelta });
        }
      } catch {
        if (raw) {
          full += raw;
          emitToHub(stream, 'delta', { delta: raw });
        }
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split('\n\n'); buf = blocks.pop() || '';
      blocks.forEach(consume);
    }
    if (buf.trim()) consume(buf);
    const slimAtts = emittedAtts.length
      ? emittedAtts.map((a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size, kind: a.kind, url: a.url }))
      : undefined;
    const donePayload = {
      ok: true,
      backend: 'hermes-api-server',
      content: full.trim(),
      responseId: responseId || undefined,
      sessionId: sessionId || undefined,
      attachments: slimAtts,
      model: observedModel || undefined,
      reasoningEffort: observedReasoningEffort || undefined,
    };
    runProjectionHook(() => hooks?.onDone?.({
      sessionId: sessionId || stream.sessionId,
      profileId: profile,
      content: donePayload.content,
      responseId: responseId || undefined,
      attachments: slimAtts,
      model: observedModel || undefined,
      reasoningEffort: observedReasoningEffort || undefined,
    }));
    emitToHub(stream, 'done', donePayload);
    markStreamDone(stream);
  } catch (apiError) {
    const rawReason = apiError instanceof Error ? apiError.message : String(apiError);
    const reason = redactSecrets(rawReason);
    runProjectionHook(() => hooks?.onError?.({
      sessionId: stream.sessionId,
      profileId: profile,
      error: hasImages ? 'image_chat_failed' : 'hermes_api_unavailable',
      detail: reason.slice(0, 480),
    }));
    emitToHub(stream, 'error', {
      error: hasImages ? `图片对话失败：${reason}` : 'hermes_api_unavailable',
      detail: reason.slice(0, 480),
      backend: 'hermes-api-server',
    });
    markStreamDone(stream);
  }
}

/** Entry point used by POST /api/deck/chat/stream. Creates a fresh hub stream
 *  for the session, kicks off the upstream pump in the background, and returns
 *  a subscriber stream for the calling client. Refresh-resumability is provided
 *  by the GET resume route which subscribes to the same hub stream. */
export function createChatStream(
  body: ChatStreamBody,
  metadata: ActiveStreamMetadata,
  clientSignal?: AbortSignal,
  hooks?: ChatStreamProjectionHooks,
): ReadableStream<Uint8Array> {
  const incomingSession = typeof body?.sessionId === 'string' && body.sessionId
    ? body.sessionId
    : `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const stream = createActiveStream(incomingSession, metadata);

  // Detach (NOT abort upstream) when the originating client disconnects — the
  // hub keeps the upstream running so a refresh can resume.
  if (clientSignal) {
    if (clientSignal.aborted) {
      // Caller is already gone; we still pump the upstream into the hub for
      // any future resume request. Don't abort.
    }
    // No additional handler — buildSubscriberStream's cancel() handles detach.
  }

  // Persist a Deck-owned projection before the upstream starts. This is only
  // metadata/messages observed by HermesDeck, not a Hermes runtime DB fallback.
  runProjectionHook(() => hooks?.onStart?.({ sessionId: incomingSession, body, metadata }));

  // Fire and forget. Errors are emitted into the hub.
  void pumpUpstream(stream, body, hooks);

  return buildSubscriberStream(stream);
}

/** Used by GET /api/deck/chat/stream/resume — re-subscribe to an in-flight or
 *  recently completed stream. Returns null if no such stream exists. */
export function resumeChatStream(sessionId: string, since: number): ReadableStream<Uint8Array> | null {
  const stream = getActiveStream(sessionId);
  if (!stream) return null;
  return buildSubscriberStream(stream, { since });
}
