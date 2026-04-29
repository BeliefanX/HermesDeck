// Convert raw Hermes / OpenAI-style stream events into a low-noise UI timeline.
// We collapse repeated `*delta*` events, surface tool calls, and translate phase
// names into Chinese labels so the panel reads as "what happened", not as a
// JSON dump.

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
  'connecting':    '正在连接 Hermes API',
  'streaming':     '开始流式响应',
  'fallback-cli':  '回落到 hermes CLI',
};

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

/**
 * Interpret one raw stream event into a timeline item, or `null` when the
 * event should be silently merged into the previous delta aggregate.
 */
export function interpret(
  raw: { type: string; payload?: any; ts: number; runId?: string },
): { item: TimelineItem | null; mergeDelta: boolean } {
  const type = String(raw.type || 'event');
  const ts = raw.ts ?? Date.now();
  const id = `${ts}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = raw.payload ?? {};

  // status.* — phase markers from BFF
  if (type.startsWith('status.')) {
    const phase = type.slice(7);
    return {
      mergeDelta: false,
      item: {
        id, ts, kind: 'status', raw: type,
        title: PHASE_LABEL[phase] || `状态：${phase}`,
        summary: typeof payload?.backend === 'string' ? `backend · ${payload.backend}` : undefined,
      },
    };
  }

  // run.completed (sent by BFF on done)
  if (type === 'run.completed') {
    const content = typeof payload?.content === 'string' ? payload.content : '';
    return {
      mergeDelta: false,
      item: {
        id, ts, kind: 'done', raw: type,
        title: '生成完成',
        summary: content ? `${content.length} 字符` : undefined,
      },
    };
  }

  if (type === 'error' || type.endsWith('.error') || type === 'response.failed') {
    const msg = payload?.error || payload?.message || payload?.detail || JSON.stringify(payload).slice(0, 120);
    return {
      mergeDelta: false,
      item: { id, ts, kind: 'error', raw: type, title: '出错了', summary: shorten(String(msg), 160) },
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
    payload?.tool_name || payload?.tool_call?.name || payload?.function?.name
  ) {
    const name =
      payload?.tool_name ||
      payload?.tool_call?.name ||
      payload?.function?.name ||
      payload?.name ||
      'tool';
    let phase: string = 'tool';
    if (type.endsWith('.added') || type.endsWith('.created') || type.endsWith('.started')) phase = '调用';
    else if (type.endsWith('.completed') || type.endsWith('.done')) phase = '完成';
    else if (type.endsWith('.failed')) phase = '失败';
    else if (type.endsWith('.delta') || type.includes('arguments')) phase = '参数';
    else if (type.includes('output')) phase = '结果';
    const args = payload?.arguments || payload?.args || payload?.input;
    const result = payload?.output || payload?.result;
    const summary = result
      ? `结果 · ${summarizeArgs(result)}`
      : args
      ? `参数 · ${summarizeArgs(args)}`
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
    return { mergeDelta: false, item: { id, ts, kind: 'event', raw: type, title: '响应已创建', summary: payload?.response?.id } };
  }
  if (type === 'response.output_item.added') {
    const itype = payload?.item?.type || 'item';
    return { mergeDelta: false, item: { id, ts, kind: 'event', raw: type, title: `输出片段 · ${itype}` } };
  }
  if (type === 'response.completed' || type === 'response.done') {
    return { mergeDelta: false, item: { id, ts, kind: 'done', raw: type, title: '模型响应完成' } };
  }
  if (type === 'response.output_text.done') {
    return { mergeDelta: false, item: { id, ts, kind: 'event', raw: type, title: '文本输出完成' } };
  }

  // Generic fallback — keep but render compactly
  return {
    mergeDelta: false,
    item: { id, ts, kind: 'event', raw: type, title: type },
  };
}
