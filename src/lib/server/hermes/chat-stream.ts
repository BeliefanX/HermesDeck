import { spawn } from 'node:child_process';
import {
  HERMES_API_BASE,
  PROFILE_ID_RE,
  apiHeaders,
  combineAbortSignals,
  redactSecrets,
} from './core';
import { tagSessionSource } from './sessions';
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
async function pumpUpstream(stream: ActiveStream, body: ChatStreamBody): Promise<void> {
  emitToHub(stream, 'status', { phase: 'connecting', backend: 'hermes-api-server' });
  const message = typeof body?.message === 'string' ? body.message : '';
  const rawProfile = typeof body?.profileId === 'string' ? body.profileId : 'default';
  const profile = PROFILE_ID_RE.test(rawProfile) ? rawProfile : 'default';
  const model = typeof body?.model === 'string' ? body.model : undefined;
  const reasoningEffort = typeof body?.reasoningEffort === 'string' ? body.reasoningEffort : undefined;
  const previousResponseId = typeof body?.previousResponseId === 'string' ? body.previousResponseId : undefined;
  // Only a real, client-supplied session id may be forwarded to Hermes or
  // reported back as the canonical id. `stream.sessionId` can be a synthetic
  // `pending_*` hub key (minted when the POST carried no sessionId) — that is
  // an internal placeholder and must never reach the upstream or the client.
  const clientSessionId = typeof body?.sessionId === 'string' && body.sessionId ? body.sessionId : undefined;
  const attachments = normalizeAttachments(body?.attachments);
  const hasImages = attachments.some((a) => a.kind === 'image');
  const enrichedMessage = buildPromptWithAttachments(message, attachments);

  let cliChild: import('node:child_process').ChildProcess | null = null;
  let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  // Detach the upstream if the hub itself is aborted (e.g. another send for
  // the same session, or the eviction timer fires).
  stream.abort.signal.addEventListener('abort', () => {
    if (upstreamReader) { try { upstreamReader.cancel('hub-abort'); } catch {} }
    if (cliChild) { try { cliChild.kill('SIGTERM'); } catch {} }
  }, { once: true });

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
    const apiBodyJson = JSON.stringify(apiBody);
    if (apiBodyJson.length > HERMES_REQUEST_BODY_BYTE_LIMIT) {
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

    const reqHeaders = { ...apiHeaders() } as Record<string, string>;
    if (clientSessionId && reqHeaders.Authorization) {
      reqHeaders['X-Hermes-Session-Id'] = clientSessionId;
    }

    // Long tasks are common with tool-heavy prompts. Default cap is 30 min.
    // Client may request a smaller value but we never exceed the hard ceiling.
    const HARD_TIMEOUT_MS = 30 * 60 * 1000;
    const requestedTimeout = Number(body?.timeoutMs || 600_000);
    const timeoutMs = Math.min(Math.max(1000, requestedTimeout), HARD_TIMEOUT_MS);
    const fetchSignal = combineAbortSignals([AbortSignal.timeout(timeoutMs), stream.abort.signal]);
    const response = await fetch(`${HERMES_API_BASE}/v1/responses`, {
      method: 'POST', headers: reqHeaders, body: apiBodyJson, signal: fetchSignal,
    });
    if (!response.ok || !response.body) {
      const rawBody = await response.text().catch(() => '');
      const safe = redactSecrets(rawBody.slice(0, 480));
      throw new Error(`Hermes API Server /v1/responses failed: ${response.status} ${safe}`);
    }
    const sessionId = response.headers.get('X-Hermes-Session-Id') || clientSessionId || '';
    emitToHub(stream, 'status', { phase: 'streaming', backend: 'hermes-api-server', profile, sessionId });

    const reader = response.body.getReader();
    upstreamReader = reader;
    const decoder = new TextDecoder();
    let full = '';
    let responseId = '';
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
    emitToHub(stream, 'done', {
      ok: true,
      backend: 'hermes-api-server',
      content: full.trim(),
      responseId: responseId || undefined,
      sessionId: sessionId || undefined,
      attachments: slimAtts,
    });
    markStreamDone(stream);
    if (sessionId) { void tagSessionSource(sessionId, 'hermesdeck', profile); }
  } catch (apiError) {
    const rawReason = apiError instanceof Error ? apiError.message : String(apiError);
    const reason = redactSecrets(rawReason);
    if (hasImages) {
      emitToHub(stream, 'error', {
        error: `图片对话失败：${reason}`,
        backend: 'hermes-api-server',
      });
      markStreamDone(stream);
      return;
    }
    emitToHub(stream, 'status', { phase: 'fallback-cli', backend: 'hermes-cli', reason });
    const args = ['chat'];
    if (profile && profile !== 'default') args.push('--profile', profile);
    args.push('-Q', '--source', 'hermesdeck', '-q', '--', enrichedMessage);
    const child = spawn('hermes', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    cliChild = child;
    let cliFull = ''; let cliErr = '';
    await new Promise<void>((resolve) => {
      child.stdout.on('data', (chunk) => { const delta = chunk.toString(); cliFull += delta; emitToHub(stream, 'delta', { delta }); });
      child.stderr.on('data', (chunk) => { cliErr += chunk.toString(); emitToHub(stream, 'run-event', { type: 'stderr', payload: chunk.toString(), ts: Date.now() }); });
      child.on('error', (e) => {
        emitToHub(stream, 'error', { error: e.message });
        markStreamDone(stream);
        resolve();
      });
      child.on('close', (code) => {
        if (code === 0) emitToHub(stream, 'done', { ok: true, backend: 'hermes-cli-fallback', content: cliFull.trim(), stderr: cliErr.slice(-1000) });
        else emitToHub(stream, 'error', { error: `hermes exited with code ${code}`, stderr: cliErr.slice(-2000) });
        markStreamDone(stream);
        resolve();
      });
    });
  }
}

/** Entry point used by POST /api/deck/chat/stream. Creates a fresh hub stream
 *  for the session, kicks off the upstream pump in the background, and returns
 *  a subscriber stream for the calling client. Refresh-resumability is provided
 *  by the GET resume route which subscribes to the same hub stream. */
export function createChatStream(body: ChatStreamBody, clientSignal?: AbortSignal): ReadableStream<Uint8Array> {
  const incomingSession = typeof body?.sessionId === 'string' && body.sessionId
    ? body.sessionId
    : `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const stream = createActiveStream(incomingSession);

  // Detach (NOT abort upstream) when the originating client disconnects — the
  // hub keeps the upstream running so a refresh can resume.
  if (clientSignal) {
    if (clientSignal.aborted) {
      // Caller is already gone; we still pump the upstream into the hub for
      // any future resume request. Don't abort.
    }
    // No additional handler — buildSubscriberStream's cancel() handles detach.
  }

  // Fire and forget. Errors are emitted into the hub.
  void pumpUpstream(stream, body);

  return buildSubscriberStream(stream);
}

/** Used by GET /api/deck/chat/stream/resume — re-subscribe to an in-flight or
 *  recently completed stream. Returns null if no such stream exists. */
export function resumeChatStream(sessionId: string, since: number): ReadableStream<Uint8Array> | null {
  const stream = getActiveStream(sessionId);
  if (!stream) return null;
  return buildSubscriberStream(stream, { since });
}
