// Context-window analysis for the chat side panel.
//
// Hermes streams an OpenAI-style `usage` object on the final `response.completed`
// event. That gives the *authoritative* size of the input context the model saw
// for the latest reply, but not a per-section breakdown. So we pair the measured
// total with a local, heuristic estimate of each visible message and treat the
// gap between them as the system-prompt + tool-definition overhead the deck
// cannot see.

import type { DeckMessage } from '@/lib/types';
import { isSubagentTool } from './subagent';

/** Token usage observed from one completed Hermes turn. */
export interface TurnUsage {
  /** Total input tokens — the size of the context window at reply time. */
  inputTokens: number;
  /** Subset of inputTokens served from the prompt cache. */
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  /** Epoch ms when this usage was observed. */
  at: number;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

/**
 * Pull a `usage` object out of a raw Hermes run-event payload. Handles both the
 * Responses API shape (`response.usage`, `input_tokens`) and the older Chat
 * Completions shape (top-level `usage`, `prompt_tokens`). Returns null when the
 * event carries no usage.
 */
export function extractUsage(apiObj: unknown): TurnUsage | null {
  if (!apiObj || typeof apiObj !== 'object') return null;
  const obj = apiObj as Record<string, unknown>;
  const resp = obj.response && typeof obj.response === 'object'
    ? (obj.response as Record<string, unknown>)
    : null;
  const usageRaw =
    (resp && resp.usage && typeof resp.usage === 'object' ? resp.usage : null) ||
    (obj.usage && typeof obj.usage === 'object' ? obj.usage : null);
  if (!usageRaw) return null;
  const u = usageRaw as Record<string, unknown>;

  const inputTokens = num(u.input_tokens) || num(u.prompt_tokens);
  const outputTokens = num(u.output_tokens) || num(u.completion_tokens);
  const totalTokens = num(u.total_tokens) || inputTokens + outputTokens;
  if (!inputTokens && !outputTokens && !totalTokens) return null;

  const inDetails = (u.input_tokens_details || u.prompt_tokens_details) as
    | Record<string, unknown>
    | undefined;
  const outDetails = (u.output_tokens_details || u.completion_tokens_details) as
    | Record<string, unknown>
    | undefined;

  return {
    inputTokens,
    cachedTokens: num(inDetails?.cached_tokens),
    outputTokens,
    reasoningTokens: num(outDetails?.reasoning_tokens),
    totalTokens,
    at: Date.now(),
  };
}

// CJK punctuation, kana, ideographs, hangul and full-width forms. These
// tokenize far denser than Latin text, so they need their own divisor.
const CJK_RE = /[　-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/g;

/** Flat per-image cost — real cost depends on resolution; this is a rough mean. */
const IMAGE_TOKEN_ESTIMATE = 1000;

/**
 * Heuristic token count for mixed CJK / Latin text. Not exact — no tokenizer is
 * shipped to the browser — but good enough to show where a context window's
 * weight sits. CJK ~1.6 chars/token, other text ~4 chars/token.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(CJK_RE) || []).length;
  const other = Math.max(0, text.length - cjk);
  return Math.ceil(cjk / 1.6 + other / 4);
}

function estimateAttachments(msg: DeckMessage): number {
  let total = 0;
  for (const a of msg.attachments || []) {
    if (a.kind === 'image') total += IMAGE_TOKEN_ESTIMATE;
    else if (a.text) total += estimateTokens(a.text);
    else total += estimateTokens(a.name || '');
  }
  return total;
}

export type ContextBlockKey =
  | 'system'
  | 'user'
  | 'assistant'
  | 'tool'
  | 'subagent'
  | 'attachments';

export interface ContextBlock {
  key: ContextBlockKey;
  tokens: number;
  /** Count of contributing messages/items — omitted for the `system` residual. */
  count?: number;
}

export interface ContextBreakdown {
  /** Total tokens in the context window. */
  total: number;
  /** True when `total` came from a real API usage event, not an estimate. */
  measured: boolean;
  /** Non-zero blocks, unsorted. */
  blocks: ContextBlock[];
  usage: TurnUsage | null;
}

/**
 * Split a conversation into context-window blocks. The trailing assistant
 * message is excluded — it is the model's *output* for the latest turn, not
 * part of the input window that produced it.
 *
 * Subagent delegations (`delegate_task` calls and their returned results) are
 * pulled into their own `subagent` block, separate from regular tool I/O.
 *
 * When `usage` is present, `total` is the measured `inputTokens` and the
 * `system` block is the residual `inputTokens - estimated conversation`
 * (system prompt + tool schemas the deck never sees). When the estimate
 * overshoots the measured total, conversation blocks are scaled down to fit.
 * Without `usage`, everything is a local estimate and there is no `system`
 * block — the deck cannot know the hidden overhead.
 */
export function buildContextBreakdown(
  messages: DeckMessage[],
  usage: TurnUsage | null,
): ContextBreakdown {
  const last = messages[messages.length - 1];
  const inputMessages = last && last.role === 'assistant'
    ? messages.slice(0, -1)
    : messages;

  // First pass: map tool-call id -> tool name, so a `tool` result row can be
  // attributed to a subagent even when it carries no `toolName` of its own.
  const callName = new Map<string, string>();
  for (const m of inputMessages) {
    if (m.role !== 'assistant' || !m.toolCalls) continue;
    for (const tc of m.toolCalls) {
      if (tc.id && tc.name) callName.set(tc.id, tc.name);
    }
  }

  let user = 0;
  let assistant = 0;
  let tool = 0;
  let subagent = 0;
  let attachments = 0;
  let userCount = 0;
  let assistantCount = 0;
  let toolCount = 0;
  let subagentCount = 0;
  let attachmentCount = 0;

  for (const m of inputMessages) {
    const textTokens = estimateTokens(m.content || '');
    attachments += estimateAttachments(m);
    attachmentCount += (m.attachments || []).length;

    if (m.role === 'user') {
      user += textTokens;
      userCount += 1;
    } else if (m.role === 'tool') {
      const name = m.toolName || (m.toolCallId ? callName.get(m.toolCallId) : undefined);
      if (isSubagentTool(name)) {
        subagent += textTokens;
      } else {
        tool += textTokens;
        toolCount += 1;
      }
    } else if (m.role === 'assistant') {
      assistant += textTokens;
      if ((m.content || '').trim()) assistantCount += 1;
      for (const tc of m.toolCalls || []) {
        const tcTokens = estimateTokens(`${tc.name || ''}${tc.arguments || ''}`);
        if (isSubagentTool(tc.name)) {
          subagent += tcTokens;
          subagentCount += 1;
        } else {
          tool += tcTokens;
        }
      }
    } else {
      // system / session_meta / unknown historical roles — model-side context.
      assistant += textTokens;
    }
  }

  const estConversation = user + assistant + tool + subagent + attachments;
  let total: number;
  let measured: boolean;
  let system = 0;

  if (usage && usage.inputTokens > 0) {
    measured = true;
    total = usage.inputTokens;
    if (estConversation <= total) {
      system = total - estConversation;
    } else {
      // Estimate overshot the measured window — scale blocks down to fit so the
      // bar still sums to 100% rather than implying negative overhead.
      const scale = total / estConversation;
      user = Math.round(user * scale);
      assistant = Math.round(assistant * scale);
      tool = Math.round(tool * scale);
      subagent = Math.round(subagent * scale);
      attachments = Math.round(attachments * scale);
    }
  } else {
    measured = false;
    total = estConversation;
  }

  const allBlocks: ContextBlock[] = [
    { key: 'system', tokens: system },
    { key: 'user', tokens: user, count: userCount },
    { key: 'assistant', tokens: assistant, count: assistantCount },
    { key: 'tool', tokens: tool, count: toolCount },
    { key: 'subagent', tokens: subagent, count: subagentCount },
    { key: 'attachments', tokens: attachments, count: attachmentCount },
  ];

  return {
    total,
    measured,
    blocks: allBlocks.filter((b) => b.tokens > 0),
    usage: usage ?? null,
  };
}
