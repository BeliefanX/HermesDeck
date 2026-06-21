export interface StreamCallbacks {
  onStatus?: (status: string, data?: unknown) => void;
  onDelta?: (delta: string) => void;
  onEvent?: (event: string, data: unknown) => void;
  onDone?: (data: unknown) => void;
  onError?: (message: string) => void;
  /** Fired with the latest server-side seq each time we observe one in the
   *  `hub` envelope or in any forwarded SSE event metadata. The chat hook
   *  persists this so a refresh can ask for `?since=<seq>` to skip what we
   *  already saw. */
  onSeq?: (seq: number) => void;
  /** Fired once with the hub envelope when reconnecting / resuming. Lets the
   *  caller know the canonical sessionId and whether the buffer dropped any
   *  events the client never saw. */
  onHub?: (info: { sessionId: string; latestSeq: number; gap: boolean; startedAt: number }) => void;
}

type StatusPayload = { phase?: string; [k: string]: unknown };
type DeltaPayload = { delta?: string; [k: string]: unknown };
type ErrorPayload = { error?: string; [k: string]: unknown };

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

// Long-running tool calls / agent loops can sit silent for several minutes —
// the previous 60s ceiling was tripping on perfectly healthy long tasks. The
// server emits a heartbeat comment every 15s so under normal conditions the
// watchdog should never fire. Anything past 5 minutes of total silence is a
// real connection problem.
const STALL_MS = 5 * 60_000;

// Shared parser for any /chat SSE response — used by both POST (new turn) and
// GET resume.
//
// `since` is the seq the caller already saw — for POST it's 0 (fresh stream);
// for resume it's whatever the client persisted before the page refresh. We
// treat the next non-hub frame as seq=since+1 so observedSeq stays aligned with
// the hub's monotonic sequence counter.
async function consumeStream(
  res: Response, callbacks: StreamCallbacks, signal?: AbortSignal, since = 0,
): Promise<void> {
  if (!res.ok || !res.body) {
    let bodyText = '';
    try { bodyText = await res.text(); } catch {}
    throw new Error(bodyText || `Stream failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let observedSeq = since;
  // Tracks the last time we saw stream traffic. HermesDeck's server-side chat
  // bridge emits SSE comment heartbeats every 15s while Hermes Agent is inside
  // long tool calls/subagent work. Those heartbeats are the intended liveness
  // signal for the 5m watchdog; treating them as "no events" caused healthy
  // long Kevin/HermesDeck tasks to detach the tab while the upstream kept
  // running and created separate API sessions in the sidebar.
  let lastEventAt = Date.now();
  const handleBlock = (block: string) => {
    let event = 'message';
    const dataLines: string[] = [];
    // Skip pure-comment blocks ("`: keep-alive ...`") — they're heartbeat
    // pings emitted by the server to keep proxies happy. They are not delivered
    // to app callbacks, but they do prove the Deck SSE bridge is alive.
    let isComment = true;
    for (const line of block.split(/\r?\n/)) {
      if (!line) continue;
      if (line.startsWith(':')) continue; // comment line, ignored
      isComment = false;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (isComment) {
      lastEventAt = Date.now();
      return;
    }
    if (!dataLines.length) return;
    // Real event observed — reset the stall watchdog clock.
    lastEventAt = Date.now();
    const raw = dataLines.join('\n');
    let data: unknown = raw;
    try { data = JSON.parse(raw); } catch {}

    // The hub envelope itself is metadata, not part of the seq counter. Its
    // latestSeq is a producer high-water mark, not a consumed cursor; replayed
    // frames must advance the cursor only after they are delivered below.
    if (event === 'hub') {
      const obj = isObj(data) ? data : {};
      const latestSeq = typeof obj.latestSeq === 'number' ? obj.latestSeq : 0;
      const gap = !!obj.gap;
      callbacks.onHub?.({
        sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : '',
        latestSeq,
        gap,
        startedAt: typeof obj.startedAt === 'number' ? obj.startedAt : Date.now(),
      });
      if (gap) {
        throw new Error('stream replay gap: buffered events were lost; refresh the session history before continuing');
      }
      return;
    }

    observedSeq += 1;
    callbacks.onEvent?.(event, data);
    if (event === 'status') {
      const phase = isObj(data) && typeof (data as StatusPayload).phase === 'string'
        ? (data as StatusPayload).phase!
        : raw;
      callbacks.onStatus?.(phase, data);
    } else if (event === 'delta') {
      const delta = isObj(data) && typeof (data as DeltaPayload).delta === 'string'
        ? (data as DeltaPayload).delta!
        : raw;
      callbacks.onDelta?.(delta);
    } else if (event === 'done') {
      callbacks.onDone?.(data);
    } else if (event === 'error') {
      const err = isObj(data) && typeof (data as ErrorPayload).error === 'string'
        ? (data as ErrorPayload).error!
        : raw;
      callbacks.onError?.(err);
    }
    callbacks.onSeq?.(observedSeq);
  };

  const stallTimer = setInterval(() => {
    if (Date.now() - lastEventAt > STALL_MS) {
      clearInterval(stallTimer);
      try { reader.cancel('stream stalled (no events for 5m)'); } catch {}
      callbacks.onError?.('stream stalled (no events for 5m)');
    }
  }, 10_000);
  // External abort — caller closing this consumer. Wired BEFORE the read loop
  // so a signal that fires during `reader.read()` still cancels the underlying
  // stream cleanly rather than waiting for the next yield point.
  const onAbort = () => { try { reader.cancel('aborted'); } catch {} };
  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() || '';
      parts.forEach(handleBlock);
    }
    if (buffer.trim()) handleBlock(buffer);
  } finally {
    clearInterval(stallTimer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export async function streamChat(payload: Record<string, unknown>, callbacks: StreamCallbacks, signal?: AbortSignal) {
  const res = await fetch('/api/deck/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  await consumeStream(res, callbacks, signal, 0);
}

/** Re-attach to a server-side stream by session id. Returns false when the
 *  hub no longer has a record (run already finished and was evicted, or never
 *  existed) — the caller should fall back to fetching persisted messages.
 *
 *  `sessionId` MUST be the hub key — i.e. the session id the client originally
 *  sent in the POST body, NOT any reconciled / canonical id Hermes returned
 *  later. The hub buffer is keyed by the original POSTed id. */
export async function resumeChatStreamClient(
  sessionId: string,
  profileId: string,
  since: number,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<boolean> {
  const res = await fetch(`/api/deck/chat/resume?sessionId=${encodeURIComponent(sessionId)}&profileId=${encodeURIComponent(profileId)}&since=${since}`, {
    method: 'GET',
    signal,
  });
  if (res.status === 404) return false;
  await consumeStream(res, callbacks, signal, since);
  return true;
}
