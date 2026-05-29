// Convert raw Hermes / OpenAI-style stream events into a low-noise UI timeline.
// We collapse repeated `*delta*` events, surface tool calls, and translate phase
// names into short English labels so the panel reads as "what happened", not as
// a JSON dump.

export type TimelineKind = 'status' | 'tool' | 'message' | 'done' | 'error' | 'event';

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  title: string;
  summary?: string;
  ts: number;
  count?: number;          // when aggregated (e.g. delta chunks)
  raw?: string;            // original event type
}

const PHASE_LABEL: Record<string, string> = {
  'connecting':    'Connecting to Hermes API',
  'streaming':     'Streaming response',
  'fallback-cli':  'Falling back to hermes CLI',
};

type JsonObject = Record<string, unknown>;

function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function prop(record: JsonObject | null, key: string): unknown {
  return record?.[key];
}

function stringProp(record: JsonObject | null, key: string): string | undefined {
  const value = prop(record, key);
  return typeof value === 'string' ? value : undefined;
}

export function isDeltaType(t?: string): boolean {
  if (!t) return false;
  return /\.delta$/.test(t) || t === 'message.delta';
}

function shorten(s: string, n = 80): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function summarizeArgs(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return shorten(value, 90);
  try {
    const s = JSON.stringify(value);
    return shorten(s, 90);
  } catch {
    return '';
  }
}

// Monotonic counter for timeline item ids. Two events arriving in the same
// millisecond would otherwise rely on a random suffix to avoid a duplicate
// React key — a counter makes the id collision-free by construction.
let interpretSeq = 0;

/**
 * Interpret one raw stream event into a timeline item, or `null` when the
 * event should be silently merged into the previous delta aggregate.
 */
export function interpret(
  raw: { type: string; payload?: unknown; ts: number; runId?: string },
): { item: TimelineItem | null; mergeDelta: boolean } {
  const type = String(raw.type || 'event');
  const ts = raw.ts ?? Date.now();
  const id = `${ts}-${(interpretSeq++).toString(36)}`;
  const payloadValue = raw.payload ?? {};
  const payload = asRecord(payloadValue);

  // status.* — phase markers from BFF
  if (type.startsWith('status.')) {
    const phase = type.slice(7);
    return {
      mergeDelta: false,
      item: {
        id, ts, kind: 'status', raw: type,
        title: PHASE_LABEL[phase] || `Status: ${phase}`,
        summary: stringProp(payload, 'backend') ? `backend · ${stringProp(payload, 'backend')}` : undefined,
      },
    };
  }

  // run.completed (sent by BFF on done)
  if (type === 'run.completed') {
    const content = stringProp(payload, 'content') || '';
    return {
      mergeDelta: false,
      item: {
        id, ts, kind: 'done', raw: type,
        title: 'Generation complete',
        summary: content ? `${content.length} chars` : undefined,
      },
    };
  }

  if (type === 'error' || type.endsWith('.error') || type === 'response.failed') {
    const msg = stringProp(payload, 'error')
      || stringProp(payload, 'message')
      || stringProp(payload, 'detail')
      || JSON.stringify(payloadValue).slice(0, 120);
    return {
      mergeDelta: false,
      item: { id, ts, kind: 'error', raw: type, title: 'Error', summary: shorten(String(msg), 160) },
    };
  }

  // Hide pure text deltas — they aggregate into a "streaming" entry.
  if (isDeltaType(type)) {
    return { mergeDelta: true, item: null };
  }

  // Tool / function call events
  if (
    type.startsWith('tool.') ||
    type.startsWith('response.tool_call') ||
    type.startsWith('response.function_call') ||
    /tool/i.test(type) ||
    stringProp(payload, 'tool_name') ||
    stringProp(asRecord(prop(payload, 'tool_call')), 'name') ||
    stringProp(asRecord(prop(payload, 'function')), 'name')
  ) {
    const name =
      stringProp(payload, 'tool_name') ||
      stringProp(asRecord(prop(payload, 'tool_call')), 'name') ||
      stringProp(asRecord(prop(payload, 'function')), 'name') ||
      stringProp(payload, 'name') ||
      'tool';
    let phase: string = 'tool';
    if (type.endsWith('.added') || type.endsWith('.created') || type.endsWith('.started')) phase = 'call';
    else if (type.endsWith('.completed') || type.endsWith('.done')) phase = 'done';
    else if (type.endsWith('.failed')) phase = 'failed';
    else if (type.endsWith('.delta') || type.includes('arguments')) phase = 'args';
    else if (type.includes('output')) phase = 'result';
    const args = prop(payload, 'arguments') || prop(payload, 'args') || prop(payload, 'input');
    const result = prop(payload, 'output') || prop(payload, 'result');
    const summary = result
      ? `result · ${summarizeArgs(result)}`
      : args
      ? `args · ${summarizeArgs(args)}`
      : undefined;
    return {
      mergeDelta: false,
      item: {
        id, ts,
        kind: 'tool',
        raw: type,
        title: `${phase} · ${name}`,
        summary,
      },
    };
  }

  // Response lifecycle
  if (type === 'response.created') {
    const response = asRecord(prop(payload, 'response'));
    return { mergeDelta: false, item: { id, ts, kind: 'event', raw: type, title: 'Response created', summary: stringProp(response, 'id') } };
  }
  if (type === 'response.output_item.added') {
    const item = asRecord(prop(payload, 'item'));
    const itype = stringProp(item, 'type') || 'item';
    return { mergeDelta: false, item: { id, ts, kind: 'event', raw: type, title: `Output item · ${itype}` } };
  }
  if (type === 'response.completed' || type === 'response.done') {
    return { mergeDelta: false, item: { id, ts, kind: 'done', raw: type, title: 'Response complete' } };
  }
  if (type === 'response.output_text.done') {
    return { mergeDelta: false, item: { id, ts, kind: 'event', raw: type, title: 'Text output done' } };
  }

  // Generic fallback — keep but render compactly
  return {
    mergeDelta: false,
    item: { id, ts, kind: 'event', raw: type, title: type },
  };
}
