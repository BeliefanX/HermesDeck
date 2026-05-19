// In-memory stream hub for chat streams.
//
// Why this exists:
//   1. Long-running tools can sit silent for minutes; we need server-side
//      heartbeats to keep proxies and the client watchdog awake.
//   2. A page refresh kills the SSE connection, but the user's task is still
//      running upstream — losing the live view of it for several minutes is
//      a worse UX than every other Hermes channel offers.
//
// The hub owns the upstream lifecycle: the upstream fetch lives until the run
// completes or the abort timeout fires, regardless of whether any client is
// currently subscribed. Buffered events let a reconnecting client replay the
// gap with `?since=<seq>`.
//
// This is in-memory and per-process. Next.js dev mode HMR may produce a fresh
// module instance — we attach the registry to globalThis so it survives.

export interface HubEvent {
  seq: number;
  /** SSE event name (delta / status / run-event / attachment / error / done / heartbeat). */
  event: string;
  /** Pre-serialized JSON payload. */
  data: string;
  ts: number;
}

export interface ActiveStream {
  sessionId: string;
  startedAt: number;
  /** Ring buffer of recent events. Capped to MAX_BUFFER. */
  buffer: HubEvent[];
  /** Monotonic event sequence; first event has seq=1. */
  nextSeq: number;
  /** True once upstream has finished (success or error). */
  done: boolean;
  /** Reason logged when an outsider aborts the run. */
  abortReason?: string;
  /** Used to abort the upstream fetch when the hub cancels the run. */
  abort: AbortController;
  /** Live subscribers — fired for every newly emitted event. */
  subscribers: Set<(ev: HubEvent) => void>;
  /** Timer that evicts the buffer N minutes after `done`. */
  evictTimer?: ReturnType<typeof setTimeout>;
}

const MAX_BUFFER = 4000;
// Keep finished streams around for 10 minutes so a slow refresh / network blip
// can still recover the full transcript. After that we drop them — by then the
// final messages are persisted in Hermes' state.db anyway.
const RETAIN_AFTER_DONE_MS = 10 * 60 * 1000;

interface HubRegistry {
  streams: Map<string, ActiveStream>;
}
const HUB_KEY = '__hermesdeck_stream_hub__';
function getRegistry(): HubRegistry {
  const g = globalThis as unknown as Record<string, HubRegistry>;
  if (!g[HUB_KEY]) g[HUB_KEY] = { streams: new Map() };
  return g[HUB_KEY];
}

export function createActiveStream(sessionId: string): ActiveStream {
  const reg = getRegistry();
  // Replace any existing stream for the same session — the new send() call
  // wins (the user's previous turn for this session is implicitly cancelled).
  const prev = reg.streams.get(sessionId);
  if (prev) {
    try { prev.abort.abort('superseded'); } catch {}
    if (prev.evictTimer) clearTimeout(prev.evictTimer);
    reg.streams.delete(sessionId);
    // Notify subscribers so they can detach cleanly.
    for (const s of prev.subscribers) {
      try {
        s({ seq: prev.nextSeq, event: 'error', data: JSON.stringify({ error: 'superseded' }), ts: Date.now() });
      } catch {}
    }
    prev.subscribers.clear();
  }
  const stream: ActiveStream = {
    sessionId,
    startedAt: Date.now(),
    buffer: [],
    nextSeq: 1,
    done: false,
    abort: new AbortController(),
    subscribers: new Set(),
  };
  reg.streams.set(sessionId, stream);
  return stream;
}

export function getActiveStream(sessionId: string): ActiveStream | undefined {
  return getRegistry().streams.get(sessionId);
}

export function emitToHub(stream: ActiveStream, event: string, payload: unknown): HubEvent {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const ev: HubEvent = { seq: stream.nextSeq++, event, data, ts: Date.now() };
  stream.buffer.push(ev);
  if (stream.buffer.length > MAX_BUFFER) {
    // Drop the oldest events. Subscribers replaying from `since` past the
    // oldest retained seq will get a "gap" indicator from the resume route.
    stream.buffer.splice(0, stream.buffer.length - MAX_BUFFER);
  }
  for (const s of stream.subscribers) {
    try { s(ev); } catch {}
  }
  return ev;
}

export function markStreamDone(stream: ActiveStream): void {
  if (stream.done) return;
  stream.done = true;
  // Subscribers close their own SSE body when they see the terminal 'done' /
  // 'error' event — the caller emits that via emitToHub *before* calling this.
  // Here we only flip the flag (so a late resume subscriber ends its replay
  // and closes immediately) and schedule buffer eviction.
  stream.evictTimer = setTimeout(() => {
    const reg = getRegistry();
    if (reg.streams.get(stream.sessionId) === stream) {
      reg.streams.delete(stream.sessionId);
    }
  }, RETAIN_AFTER_DONE_MS);
}

/** Snapshot the buffer from `since` onward. Caller usually subscribes for live
 *  events after consuming this snapshot. */
export function eventsSince(stream: ActiveStream, since: number): HubEvent[] {
  if (since <= 0) return stream.buffer.slice();
  // buffer may have been trimmed; lower bound is buffer[0].seq.
  const oldest = stream.buffer[0]?.seq ?? 1;
  if (since < oldest - 1) {
    // Caller asked for events older than what we retain. Return everything we
    // have so they at least get the suffix; the resume route can flag the gap.
    return stream.buffer.slice();
  }
  let lo = 0;
  let hi = stream.buffer.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (stream.buffer[mid].seq <= since) lo = mid + 1;
    else hi = mid;
  }
  return stream.buffer.slice(lo);
}

/** True when the resume request should be told the buffer no longer covers
 *  the requested baseline (some events were lost). */
export function hasGap(stream: ActiveStream, since: number): boolean {
  if (since <= 0) return false;
  const oldest = stream.buffer[0]?.seq ?? 1;
  return since < oldest - 1;
}
