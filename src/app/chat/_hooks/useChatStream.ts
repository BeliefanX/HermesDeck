'use client';
import { useCallback, useEffect, useRef } from 'react';
import { deckApi, ApiError } from '@/lib/api';
import { resumeChatStreamClient, streamChat, type StreamCallbacks } from '@/lib/client-sse';
import { CHAT_STREAM_DEFAULT_TIMEOUT_MS } from '@/lib/chat-timeouts';
import {
  attachmentToPayload,
  type AttachmentItem,
} from '@/lib/attachments';
import { interpret, type TimelineItem } from '@/lib/timeline';
import type { DeckAttachment, DeckMessage } from '@/lib/types';
import type { ChatT } from '../_lib/i18n';
import { type LocalSession, genSessionId } from '../_lib/storage';
import { extractUsage, type TurnUsage } from '../_lib/context-window';

function apiErrorDetail(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body;
    const detail = body && typeof body === 'object' && 'detail' in body && typeof (body as { detail?: unknown }).detail === 'string'
      ? `: ${(body as { detail: string }).detail}`
      : '';
    return `${err.status} ${err.message}${detail}`;
  }
  return err instanceof Error ? err.message : String(err);
}

interface UseChatStreamParams {
  // Core state
  profile: string;
  active: string;
  messages: Record<string, DeckMessage[]>;
  responseIds: Record<string, string>;
  busy: boolean;
  input: string;
  attachments: AttachmentItem[];
  selectedModel: string;
  reasoningEffort: string;
  defaultReasoning: string;
  hydrated: boolean;
  // Setters
  setSessions: React.Dispatch<React.SetStateAction<LocalSession[]>>;
  setMessages: React.Dispatch<React.SetStateAction<Record<string, DeckMessage[]>>>;
  setResponseIds: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setActive: React.Dispatch<React.SetStateAction<string>>;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentItem[]>>;
  setTimeline: React.Dispatch<React.SetStateAction<TimelineItem[]>>;
  /** Stores the token usage observed from each session's latest completed turn. */
  setUsage: React.Dispatch<React.SetStateAction<Record<string, TurnUsage>>>;
  // Refs the parent owns
  abortRef: React.MutableRefObject<AbortController | null>;
  taRef: React.RefObject<HTMLTextAreaElement | null>;
  stickToBottomRef: React.MutableRefObject<boolean>;
  // i18n strings
  t: ChatT;
}

// Persisted across page reloads so we can resume an in-flight stream after a
// refresh. The shape is intentionally tiny: messages are persisted separately
// (STORAGE_KEY); we just need the cursor + the assistant ids the live handlers
// will write into so deltas/events keep landing in the right rows.
//
// hubKey vs sessionId: the hub keys its in-memory stream by the EXACT id the
// client first POSTed. Hermes may then return its own canonical session id via
// the status event, in which case reconcileSid renames our local messages map
// from hubKey → canonical. We need both:
//   - hubKey to call /api/deck/chat/resume?sessionId=<hubKey> on refresh
//   - sessionId to write streamed deltas into messages[sessionId]
const INFLIGHT_KEY = 'hermesdeck.chat.inflight.v1';
const INFLIGHT_MAX_AGE_MS = 30 * 60 * 1000; // hub keeps streams ~10 min after done; 30 min covers slow page loads

interface ToolCallSlot {
  assistantId: string;
  name: string;
  args: string;
  /** Responses item id (fc_*). Argument deltas often refer to this id. */
  itemId?: string;
  /** Stable tool call id (call_*). Tool outputs refer to this id. */
  callId?: string;
}

type StoredToolCall = { id: string; assistantId: string; name: string; args: string; itemId?: string; callId?: string };

type InflightStorage = {
  /** Server-side hub identifier — never changes for a given run. */
  hubKey: string;
  /** Current messages-map key. May differ from hubKey after reconcile. */
  sessionId: string;
  lastSeq: number;
  profile: string;
  textAssistantId: string;
  startedAt: number;
  /**
   * In-flight tool call slots. Persisted so a refresh during a tool call's
   * argument streaming can resume into the same map — without this, args
   * deltas for an item we don't have on disk would silently spawn a new
   * placeholder row instead of continuing into the original one, producing
   * duplicate or empty tool-call bubbles after the refresh.
   */
  toolCalls?: StoredToolCall[];
};

function readInflight(): InflightStorage | null {
  try {
    const raw = localStorage.getItem(INFLIGHT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<InflightStorage>;
    if (!v || typeof v !== 'object') return null;
    if (!v.sessionId || typeof v.sessionId !== 'string') return null;
    if (Date.now() - (v.startedAt || 0) > INFLIGHT_MAX_AGE_MS) return null;
    const tcRaw = Array.isArray(v.toolCalls) ? v.toolCalls : [];
    const toolCalls = tcRaw
      .filter((x): x is StoredToolCall => !!x && typeof x === 'object'
        && typeof x.id === 'string' && typeof x.assistantId === 'string'
        && typeof x.name === 'string' && typeof x.args === 'string')
      .map((x) => ({
        ...x,
        itemId: typeof x.itemId === 'string' ? x.itemId : undefined,
        callId: typeof x.callId === 'string' ? x.callId : undefined,
      }));
    return {
      hubKey: typeof v.hubKey === 'string' && v.hubKey ? v.hubKey : v.sessionId,
      sessionId: v.sessionId,
      lastSeq: typeof v.lastSeq === 'number' ? v.lastSeq : 0,
      profile: typeof v.profile === 'string' ? v.profile : 'default',
      textAssistantId: typeof v.textAssistantId === 'string' ? v.textAssistantId : '',
      startedAt: typeof v.startedAt === 'number' ? v.startedAt : Date.now(),
      toolCalls,
    };
  } catch { return null; }
}
function writeInflight(v: InflightStorage): void {
  try { localStorage.setItem(INFLIGHT_KEY, JSON.stringify(v)); } catch {}
}
function clearInflight(): void {
  try { localStorage.removeItem(INFLIGHT_KEY); } catch {}
}

function serializeToolCalls(map: Map<string, ToolCallSlot>): StoredToolCall[] {
  const out: StoredToolCall[] = [];
  const seenAssistantIds = new Set<string>();
  for (const [id, slot] of map) {
    // The live map may contain aliases (fc_* item id and call_* call id) that
    // point at the same slot. Persist one canonical row, preferably the call id
    // because function_call_output events use it to link results to calls.
    if (seenAssistantIds.has(slot.assistantId)) continue;
    seenAssistantIds.add(slot.assistantId);
    out.push({
      id: slot.callId || id,
      assistantId: slot.assistantId,
      name: slot.name,
      args: slot.args,
      itemId: slot.itemId,
      callId: slot.callId,
    });
  }
  return out;
}

function toolCallIds(item: Record<string, unknown>, fallback = ''): { primary: string; itemId: string; callId: string } {
  const itemId = String((item.id as string) || fallback || '');
  const callId = String((item.call_id as string) || (item.tool_call_id as string) || '');
  return { primary: callId || itemId, itemId, callId };
}

function getToolSlot(map: Map<string, ToolCallSlot>, id: string): ToolCallSlot | undefined {
  if (!id) return undefined;
  const direct = map.get(id);
  if (direct) return direct;
  for (const slot of map.values()) {
    if (slot.itemId === id || slot.callId === id) return slot;
  }
  return undefined;
}

function rememberToolSlot(map: Map<string, ToolCallSlot>, primary: string, slot: ToolCallSlot): void {
  if (primary) map.set(primary, slot);
  if (slot.itemId) map.set(slot.itemId, slot);
  if (slot.callId) map.set(slot.callId, slot);
}

function visibleToolCallId(slot: ToolCallSlot, fallback: string): string {
  return slot.callId || fallback;
}

function normalizeToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    const parts = output.map((part) => {
      if (!part || typeof part !== 'object') return '';
      const rec = part as Record<string, unknown>;
      return typeof rec.text === 'string' ? rec.text : '';
    }).filter(Boolean);
    if (parts.length) return parts.join('\n');
  }
  return JSON.stringify(output);
}

// Heuristic — does this raw event type correspond to a tool args delta?
function isToolArgsDelta(type: string): boolean {
  return /(?:function_call|tool_call)[._-]arguments\.delta$/i.test(type)
    || /\bfunction_call\.arguments\.delta$/i.test(type);
}
function isToolArgsDone(type: string): boolean {
  return /(?:function_call|tool_call)[._-]arguments\.done$/i.test(type)
    || /\bfunction_call\.arguments\.done$/i.test(type);
}
function isToolResultEvent(type: string): boolean {
  return type === 'tool.result'
    || type === 'tool.completed'
    || type === 'tool.output'
    || type === 'response.tool_call.output'
    || type === 'response.tool_call.completed'
    || type === 'response.function_call.output'
    || type === 'response.tool_result';
}
function isFunctionCallItemType(t: unknown): boolean {
  if (typeof t !== 'string') return false;
  return t === 'function_call' || t === 'tool_call' || t === 'mcp_call' || t === 'tool_use';
}

interface InflightLive {
  /** Pinned for the lifetime of this run; matches the hub stream key. */
  hubKey: string;
  /** Current messages-map key — may rename via reconcileSid. */
  sessionId: string;
  textAssistantId: string;
  toolCalls: Map<string, ToolCallSlot>;
  lastSeq: number;
  /**
   * Monotonic stream id. Bumped at the start of every send/resume so callbacks
   * captured by an old stream can self-cancel if a newer stream takes over the
   * inflight ref before they drain.
   */
  streamId: number;
}

let nextStreamId = 1;

function rebuildToolCallsMap(list: DeckMessage[]): Map<string, ToolCallSlot> {
  const m = new Map<string, ToolCallSlot>();
  for (const msg of list) {
    if (msg.role !== 'assistant' || !msg.toolCalls?.length) continue;
    for (const tc of msg.toolCalls) {
      if (!tc.id) continue;
      const slot = {
        assistantId: msg.id,
        name: tc.name || 'tool',
        args: tc.arguments || '',
        callId: tc.id,
      };
      rememberToolSlot(m, tc.id, slot);
    }
  }
  return m;
}

export function useChatStream(params: UseChatStreamParams) {
  const {
    profile, active, messages, responseIds, busy, input, attachments,
    selectedModel, reasoningEffort, defaultReasoning, hydrated,
    setSessions, setMessages, setResponseIds, setActive,
    setBusy, setError, setInput, setAttachments, setTimeline,
    setUsage,
    abortRef, taRef, stickToBottomRef, t,
  } = params;

  const deltaRef = useRef<{ item: TimelineItem; lastTs: number } | null>(null);
  const openSessionSeqRef = useRef(0);
  const openSessionAbortRef = useRef<AbortController | null>(null);
  // Monotonic counter for timeline item ids — pairs with Date.now() and a
  // random tail to avoid collisions when two events fire in the same ms.
  const timelineSeqRef = useRef(0);
  const regenerateRef = useRef<() => void>(() => {});
  // Per-stream live state. Owned by start*Stream — handlers read it in-flight.
  const inflightRef = useRef<InflightLive | null>(null);
  const profileRef = useRef(profile);
  // Resume already attempted? Avoid running twice in StrictMode dev.
  const resumeAttemptedRef = useRef(false);

  const pushTimeline = useCallback((item: TimelineItem) => {
    setTimeline((prev) => [item, ...prev].slice(0, 80));
  }, [setTimeline]);

  const clearTimeline = useCallback(() => {
    setTimeline([]);
    deltaRef.current = null;
  }, [setTimeline]);

  useEffect(() => {
    if (profileRef.current === profile) return;
    profileRef.current = profile;
    abortRef.current?.abort();
    openSessionAbortRef.current?.abort();
    inflightRef.current = null;
    deltaRef.current = null;
    clearInflight();
    setBusy(false);
    clearTimeline();
  }, [abortRef, clearTimeline, profile, setBusy]);

  const handleEvent = useCallback((eventType: string, payload: unknown) => {
    if (eventType !== 'run-event') return;
    const obj = payload as { type?: string; payload?: unknown; ts?: number };
    const innerType = obj?.type || 'event';
    const result = interpret({ type: innerType, payload: obj?.payload ?? obj, ts: obj?.ts ?? Date.now() });

    if (result.mergeDelta) {
      const cur = deltaRef.current;
      if (cur && Date.now() - cur.lastTs < 60_000) {
        cur.item.count = (cur.item.count || 1) + 1;
        cur.item.summary = `${cur.item.count} text chunks`;
        cur.lastTs = Date.now();
        setTimeline((prev) => prev.map((x) => (x.id === cur.item.id ? { ...cur.item } : x)));
      } else {
        // Use the seq counter (bumped per-call) plus a longer random tail for
        // the id — `Date.now()` alone collides for rapid back-to-back deltas
        // emitted within the same millisecond, which made the timeline animate
        // weirdly when two items shared a key.
        const newItem: TimelineItem = {
          id: `delta-${Date.now()}-${++timelineSeqRef.current}-${Math.random().toString(36).slice(2, 8)}`,
          kind: 'message',
          title: 'Streaming…',
          summary: '1 text chunk',
          ts: Date.now(),
          count: 1,
          raw: innerType,
        };
        deltaRef.current = { item: newItem, lastTs: Date.now() };
        pushTimeline(newItem);
      }
      return;
    }

    if (result.item) {
      deltaRef.current = null;
      pushTimeline(result.item);
    }
  }, [pushTimeline, setTimeline]);

  // Apply OpenAI-Responses-style + Hermes-style tool/skill/subagent events to
  // the visible message list so the user sees calls + results in real-time.
  // Idempotent per item-id so resume replays don't double-insert rows.
  const applyToolEventToMessages = useCallback((sid: string, innerType: string, p: Record<string, unknown>) => {
    const inf = inflightRef.current;
    if (!inf || inf.sessionId !== sid) return;
    const item = (p.item && typeof p.item === 'object') ? (p.item as Record<string, unknown>) : {};

    // Tool call started
    if (innerType === 'response.output_item.added' && isFunctionCallItemType(item.type)) {
      const ids = toolCallIds(item, `tc_${Date.now()}`);
      const itemId = ids.primary;
      if (getToolSlot(inf.toolCalls, itemId)) return;
      const fn = (item.function && typeof item.function === 'object') ? item.function as Record<string, unknown> : null;
      const name = String((item.name as string) || (fn?.name as string) || 'tool');
      const initArgs = typeof item.arguments === 'string' ? item.arguments : '';
      const newAssistantId = `tc_${itemId}_${Math.random().toString(36).slice(2, 6)}`;
      const newTextId = `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      rememberToolSlot(inf.toolCalls, itemId, {
        assistantId: newAssistantId,
        name,
        args: initArgs,
        itemId: ids.itemId || undefined,
        callId: ids.callId || undefined,
      });
      const prevTextId = inf.textAssistantId;
      inf.textAssistantId = newTextId;
      // Persist the new text bubble so a refresh-mid-stream targets the right row.
      writeInflight({
        hubKey: inf.hubKey,
        sessionId: inf.sessionId,
        lastSeq: inf.lastSeq,
        profile,
        textAssistantId: newTextId,
        startedAt: Date.now(),
        toolCalls: serializeToolCalls(inf.toolCalls),
      });

      setMessages((m) => {
        const list = m[sid] || [];
        // Drop the trailing empty text placeholder so the new tool-call row
        // attaches directly after the user's prompt / prior content.
        let next = list;
        if (list.length) {
          const last = list[list.length - 1];
          if (last.id === prevTextId && last.role === 'assistant'
              && !last.content && !(last.toolCalls?.length) && !(last.attachments?.length)) {
            next = list.slice(0, -1);
          }
        }
        return {
          ...m,
          [sid]: [
            ...next,
            {
              id: newAssistantId,
              role: 'assistant',
              content: '',
              createdAt: new Date().toISOString(),
              toolCalls: [{ id: itemId, name, arguments: initArgs }],
            },
            { id: newTextId, role: 'assistant', content: '', createdAt: new Date().toISOString() },
          ],
        };
      });
      return;
    }

    // Tool call args streaming
    if (isToolArgsDelta(innerType)) {
      const itemId = String((p.item_id as string) || (item.id as string) || '');
      const delta = typeof p.delta === 'string' ? p.delta : '';
      if (!itemId || !delta) return;
      let tc = getToolSlot(inf.toolCalls, itemId);
      // Resume race: hub buffer may have dropped the upstream output_item.added
      // before we reconnected, but the args.delta still arrives. Without a
      // placeholder slot we'd silently drop the chunk and leave the tool call
      // with empty args. Create one and let isToolArgsDone / output_item.done
      // fix the name later.
      if (!tc) {
        const newAssistantId = `tc_${itemId}_${Math.random().toString(36).slice(2, 6)}`;
        tc = { assistantId: newAssistantId, name: 'tool', args: '', itemId };
        rememberToolSlot(inf.toolCalls, itemId, tc);
        setMessages((m) => ({
          ...m,
          [sid]: [
            ...(m[sid] || []),
            {
              id: newAssistantId,
              role: 'assistant',
              content: '',
              createdAt: new Date().toISOString(),
              toolCalls: [{ id: itemId, name: 'tool', arguments: '' }],
            },
          ],
        }));
      }
      tc.args += delta;
      const slot = tc;
      setMessages((m) => ({
        ...m,
        [sid]: (m[sid] || []).map((x) => x.id === slot.assistantId
          ? { ...x, toolCalls: [{ id: visibleToolCallId(slot, itemId), name: slot.name, arguments: slot.args }] }
          : x),
      }));
      return;
    }

    // Tool call args finalized
    if (isToolArgsDone(innerType)) {
      const itemId = String((p.item_id as string) || (item.id as string) || '');
      const args = typeof p.arguments === 'string'
        ? (p.arguments as string)
        : (typeof item.arguments === 'string' ? (item.arguments as string) : null);
      if (!itemId || args == null) return;
      const tc = getToolSlot(inf.toolCalls, itemId);
      if (!tc) return;
      tc.args = args;
      // Promote the tool name if the placeholder created in the delta path
      // is still showing 'tool' and the done payload carries a real name.
      if (tc.name === 'tool') {
        const promoted = String((p.name as string) || (item.name as string) || '');
        if (promoted) tc.name = promoted;
      }
      setMessages((m) => ({
        ...m,
        [sid]: (m[sid] || []).map((x) => x.id === tc.assistantId
          ? { ...x, toolCalls: [{ id: visibleToolCallId(tc, itemId), name: tc.name, arguments: tc.args }] }
          : x),
      }));
      return;
    }

    // output_item.done — final reconcile of the args (server gives us the
    // fully-resolved string) and a chance to detect tool-output items.
    if (innerType === 'response.output_item.done') {
      if (isFunctionCallItemType(item.type) && typeof item.arguments === 'string') {
        const ids = toolCallIds(item);
        const itemId = ids.primary;
        const tc = getToolSlot(inf.toolCalls, itemId);
        if (tc) {
          tc.itemId = tc.itemId || ids.itemId || undefined;
          tc.callId = tc.callId || ids.callId || undefined;
          rememberToolSlot(inf.toolCalls, itemId, tc);
          tc.args = item.arguments as string;
          setMessages((m) => ({
            ...m,
            [sid]: (m[sid] || []).map((x) => x.id === tc.assistantId
              ? { ...x, toolCalls: [{ id: visibleToolCallId(tc, itemId), name: tc.name, arguments: tc.args }] }
              : x),
          }));
        }
      }
      // Some Hermes builds emit the tool result as an output_item.done with
      // type=tool_result / function_call_output. Fall through to result-handling.
      const itype = String(item.type || '');
      if (itype !== 'tool_result' && itype !== 'function_call_output' && itype !== 'tool_output') return;
      const itemId = String((item.call_id as string) || (item.tool_call_id as string) || (item.id as string) || '');
      const tc = getToolSlot(inf.toolCalls, itemId);
      const toolName = tc?.name || String((item.name as string) || 'tool');
      const output = item.output ?? item.content;
      if (output == null) return;
      const text = normalizeToolOutput(output);
      setMessages((m) => {
        const list = m[sid] || [];
        if (list.some((x) => x.role === 'tool' && x.toolCallId === itemId)) return m;
        // Insertion target order: live toolCalls map → an existing assistant
        // row that already carries this call id (resume path) → end of list.
        // Without the second fallback a result for a call we resumed but
        // didn't populate into `inf.toolCalls` would land at the bottom of
        // the conversation, jumping past unrelated messages.
        let insertAt = list.length;
        const tcIdx = tc
          ? list.findIndex((x) => x.id === tc.assistantId)
          : list.findIndex((x) => x.role === 'assistant'
              && (x.toolCalls || []).some((tcc) => tcc.id === itemId));
        if (tcIdx !== -1) insertAt = tcIdx + 1;
        const newRow: DeckMessage = {
          id: `tr_${itemId || Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          role: 'tool',
          content: text,
          toolName,
          toolCallId: itemId,
          createdAt: new Date().toISOString(),
        };
        return { ...m, [sid]: [...list.slice(0, insertAt), newRow, ...list.slice(insertAt)] };
      });
      return;
    }

    // Hermes-shape tool result events
    if (isToolResultEvent(innerType)) {
      const itemId = String(
        (p.item_id as string)
        || (p.tool_call_id as string)
        || (p.call_id as string)
        || (item.id as string)
        || ''
      );
      const tc = getToolSlot(inf.toolCalls, itemId);
      const toolName = tc?.name || String((p.tool_name as string) || (item.name as string) || 'tool');
      const output = p.output ?? p.result ?? p.content;
      if (output == null) return;
      const text = normalizeToolOutput(output);
      setMessages((m) => {
        const list = m[sid] || [];
        if (list.some((x) => x.role === 'tool' && x.toolCallId === itemId)) return m;
        let insertAt = list.length;
        const tcIdx = tc
          ? list.findIndex((x) => x.id === tc.assistantId)
          : list.findIndex((x) => x.role === 'assistant'
              && (x.toolCalls || []).some((tcc) => tcc.id === itemId));
        if (tcIdx !== -1) insertAt = tcIdx + 1;
        const newRow: DeckMessage = {
          id: `tr_${itemId || Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          role: 'tool',
          content: text,
          toolName,
          toolCallId: itemId,
          createdAt: new Date().toISOString(),
        };
        return { ...m, [sid]: [...list.slice(0, insertAt), newRow, ...list.slice(insertAt)] };
      });
      return;
    }
  }, [profile, setMessages]);

  const openSession = useCallback(async (s: LocalSession) => {
    const requestProfile = profile;
    openSessionAbortRef.current?.abort();
    if (active && active !== s.id) abortRef.current?.abort();
    const seq = ++openSessionSeqRef.current;
    const ac = new AbortController();
    openSessionAbortRef.current = ac;
    setActive(s.id);
    setError('');
    // The run timeline is global, not per-session. When actually switching
    // threads, drop the previous session's events so they don't bleed into the
    // one we're opening (newChat already does this; openSession used not to).
    if (s.id !== active) clearTimeline();
    const cached = messages[s.id];
    if (!cached || (s.messageCount || 0) > cached.length) {
      try {
        const r = await deckApi.messages(s.id, profile, ac.signal);
        if (seq !== openSessionSeqRef.current || ac.signal.aborted || profileRef.current !== requestProfile) return;
        if (r.messages.length) setMessages((m) => ({ ...m, [s.id]: r.messages }));
      } catch (err) {
        if (ac.signal.aborted || seq !== openSessionSeqRef.current) return;
        setError(`Messages failed to load: ${apiErrorDetail(err)}`);
      }
    }
  }, [abortRef, active, clearTimeline, messages, profile, setActive, setError, setMessages]);

  // Build the SSE callbacks shared by streamChat and resumeChatStreamClient.
  // Captures `sid` + the IDs the run uses for live state mutation.
  //
  // streamId guards against a stale stream's callbacks racing a newer one. If
  // the user fires send() while an earlier stream is still draining (network
  // delay, slow tool result), the inflight ref now belongs to the new stream;
  // the old callbacks must not write into it.
  const buildCallbacks = useCallback((init: {
    sid: string;
    initialAssistantId: string;
    streamId: number;
    profile: string;
    onSidReconcile: (incoming: string) => void;
    isAbortedRef: React.MutableRefObject<boolean>;
  }): StreamCallbacks => {
    let sid = init.sid;
    // Per-stream textAssistantId — owned locally so the old stream's deltas
    // can never land in the new stream's bubble after a tool-call rotation
    // updates inflightRef.textAssistantId for someone else.
    let myTextAssistantId = init.initialAssistantId;
    const isMine = () => {
      const inf = inflightRef.current;
      return !!inf && inf.streamId === init.streamId && profileRef.current === init.profile;
    };
    return {
      onHub(info) {
        // The hub envelope's `sessionId` is the HUB KEY — the original id we
        // POSTed. It is NOT a canonical-id reconcile signal; that comes via
        // the status event. We use it only to lock in the inflight stash so
        // a refresh can call /resume?sessionId=<hubKey>.
        if (!isMine()) return;
        const inf = inflightRef.current!;
        if (info.sessionId) inf.hubKey = info.sessionId;
        if (info.gap) {
          setError('Stream replay gap: buffered events were lost; refresh the session history before continuing.');
          return;
        }
        writeInflight({
          hubKey: inf.hubKey,
          sessionId: inf.sessionId,
          lastSeq: inf.lastSeq,
          profile,
          textAssistantId: inf.textAssistantId,
          startedAt: info.startedAt || Date.now(),
          toolCalls: serializeToolCalls(inf.toolCalls),
        });
      },
      onSeq(seq) {
        if (!isMine()) return;
        const inf = inflightRef.current!;
        inf.lastSeq = Math.max(inf.lastSeq, seq);
        // Throttled disk writes happen in the periodic flush effect below.
      },
      onStatus(phase, data) {
        if (!isMine()) return;
        const obj = (typeof data === 'object' && data) ? (data as Record<string, unknown>) : {};
        const incoming = obj.sessionId ? String(obj.sessionId) : '';
        if (incoming && incoming !== sid) {
          init.onSidReconcile(incoming);
          sid = incoming;
        }
        const item = interpret({ type: `status.${phase}`, ts: Date.now() }).item;
        if (item) { deltaRef.current = null; pushTimeline(item); }
      },
      onDelta(delta) {
        if (init.isAbortedRef.current) return;
        if (!isMine()) return;
        // Pull the live target from inflight (a tool-call rotation may have
        // moved it to a fresh bubble), but never accept a target the other
        // stream owns — keep our local mirror in sync with this stream's view.
        const inf = inflightRef.current!;
        myTextAssistantId = inf.textAssistantId || myTextAssistantId;
        const targetId = myTextAssistantId;
        setMessages((m) => ({
          ...m,
          [sid]: (m[sid] || []).map((x) => x.id === targetId
            ? { ...x, content: x.content + delta }
            : x),
        }));
      },
      onEvent(type, payload) {
        if (init.isAbortedRef.current) return;
        if (!isMine()) return;
        const inf = inflightRef.current!;
        myTextAssistantId = inf.textAssistantId || myTextAssistantId;
        if (type === 'attachment' && payload && typeof payload === 'object') {
          const att = payload as DeckAttachment;
          if (att.id && (att.dataUrl || att.url)) {
            const targetId = myTextAssistantId;
            setMessages((m) => ({
              ...m,
              [sid]: (m[sid] || []).map((x) => {
                if (x.id !== targetId) return x;
                const existing = x.attachments || [];
                if (existing.some((e) => e.id === att.id)) return x;
                return { ...x, attachments: [...existing, att] };
              }),
            }));
          }
        }
        if (type === 'run-event' && payload && typeof payload === 'object') {
          const ev = payload as { type?: string; payload?: unknown };
          const innerType = ev?.type || '';
          const innerPayload = (ev?.payload && typeof ev.payload === 'object')
            ? (ev.payload as Record<string, unknown>)
            : {};
          applyToolEventToMessages(sid, innerType, innerPayload);
          // Pluck token usage off the final response event so the context
          // window panel can show the measured input size for this turn.
          const turnUsage = extractUsage(innerPayload);
          if (turnUsage) setUsage((u) => ({ ...u, [sid]: turnUsage }));
        }
        handleEvent(type, payload);
      },
      onDone(data) {
        if (init.isAbortedRef.current) return;
        if (!isMine()) return;
        const obj = (typeof data === 'object' && data) ? (data as Record<string, unknown>) : {};
        const responseId = obj.responseId ? String(obj.responseId) : '';
        const confirmedSid = obj.sessionId ? String(obj.sessionId) : '';
        const finalAtts = Array.isArray(obj.attachments) ? (obj.attachments as DeckAttachment[]) : null;
        if (confirmedSid) {
          init.onSidReconcile(confirmedSid);
          sid = confirmedSid;
        }
        if (responseId) setResponseIds((r) => ({ ...r, [sid]: responseId }));
        const observedModel = typeof obj.model === 'string' && obj.model.trim() ? obj.model.trim() : '';
        const observedReasoning = typeof obj.reasoningEffort === 'string' && obj.reasoningEffort.trim()
          ? obj.reasoningEffort.trim().toLowerCase()
          : '';
        if (observedModel || observedReasoning) {
          setSessions((list) => list.map((x) => x.id === sid ? {
            ...x,
            ...(observedModel ? { model: observedModel } : {}),
            ...(observedReasoning ? { reasoningEffort: observedReasoning } : {}),
          } : x));
        }
        if (finalAtts && finalAtts.length) {
          const inf = inflightRef.current;
          const targetId = (inf && inf.streamId === init.streamId)
            ? (inf.textAssistantId || myTextAssistantId)
            : myTextAssistantId;
          setMessages((m) => ({
            ...m,
            [sid]: (m[sid] || []).map((x) => {
              if (x.id !== targetId) return x;
              const merged = [...(x.attachments || [])];
              for (const att of finalAtts) {
                if (!merged.some((e) => e.id === att.id || (att.dataUrl && e.dataUrl === att.dataUrl))) {
                  merged.push(att);
                }
              }
              return { ...x, attachments: merged };
            }),
          }));
        }
        const item = interpret({ type: 'run.completed', payload: data, ts: Date.now() }).item;
        if (item) { deltaRef.current = null; pushTimeline(item); }
        clearInflight();
      },
      onError(message) {
        if (init.isAbortedRef.current) return;
        if (!isMine()) return;
        setError(message);
        const targetId = myTextAssistantId;
        setMessages((m) => ({
          ...m,
          [sid]: (m[sid] || []).map((x) => x.id === targetId
            ? { ...x, content: x.content + (x.content ? '\n\n' : '') + `${t.errorPrefix} ${message}` }
            : x),
        }));
        const item = interpret({ type: 'error', payload: { error: message }, ts: Date.now() }).item;
        if (item) { deltaRef.current = null; pushTimeline(item); }
        clearInflight();
      },
    };
  }, [applyToolEventToMessages, handleEvent, profile, pushTimeline, setError, setMessages, setResponseIds, setSessions, setUsage, t]);

  const send = useCallback(async (
    textArg?: string,
    opts?: {
      skipUserMessage?: boolean;
      previousResponseIdOverride?: string | null;
      attachmentsOverride?: DeckAttachment[];
    },
  ) => {
    const text = (textArg ?? input).trim();
    if (!text || busy) return;
    if (!profile) {
      setError(t.profileUnavailable);
      return;
    }
    const liveAtts = opts?.attachmentsOverride
      ?? attachments.filter((a) => a.status === 'ready').map(attachmentToPayload);
    setError('');
    if (!textArg) setInput('');
    let sid = active;
    if (!sid) {
      sid = genSessionId();
      const title = text.split('\n')[0].slice(0, 64) || t.newChat;
      const created: LocalSession = {
        id: sid, profileId: profile, title, source: 'hermesdeck', model: selectedModel || undefined, reasoningEffort: reasoningEffort || undefined,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messageCount: 0,
      };
      setSessions((s) => [created, ...s.filter((x) => x.id !== sid)]);
      setMessages((m) => ({ ...m, [sid]: [] }));
      setActive(sid);
    }
    const currentResponseId = opts?.previousResponseIdOverride === null
      ? undefined
      : (opts?.previousResponseIdOverride ?? responseIds[sid]);
    const skipUser = opts?.skipUserMessage === true;
    const assistantId = `a_${Date.now()}`;
    const newMessages: DeckMessage[] = skipUser
      ? [{ id: assistantId, role: 'assistant', content: '', createdAt: new Date().toISOString() }]
      : [
          {
            id: `u_${Date.now()}`,
            role: 'user',
            content: text,
            createdAt: new Date().toISOString(),
            ...(liveAtts.length ? { attachments: liveAtts } : {}),
          },
          { id: assistantId, role: 'assistant', content: '', createdAt: new Date().toISOString() },
        ];
    setMessages((m) => ({ ...m, [sid]: [...(m[sid] || []), ...newMessages] }));
    setSessions((s) => s.map((x) => x.id === sid ? {
      ...x,
      model: selectedModel || x.model,
      reasoningEffort: reasoningEffort || x.reasoningEffort,
      updatedAt: new Date().toISOString(),
      messageCount: (x.messageCount || 0) + newMessages.length,
    } : x));
    // Snapshot the attachments we just sent so we can restore them if the
    // request fails before the server acknowledges (network drop, 5xx). The
    // user's "I uploaded these" mental model shouldn't break on transient
    // failure — they should be able to hit Send again without reattaching.
    const sentAttachments = !skipUser && !opts?.attachmentsOverride
      ? attachments.filter((a) => a.status !== 'error')
      : [];
    if (sentAttachments.length) setAttachments([]);
    setBusy(true);
    clearTimeline();
    // The user just hit Send — they want to see the response, so re-arm
    // sticky-bottom even if they had scrolled up to read history earlier.
    stickToBottomRef.current = true;
    const streamId = nextStreamId++;
    inflightRef.current = {
      hubKey: sid,
      sessionId: sid,
      textAssistantId: assistantId,
      toolCalls: new Map(),
      lastSeq: 0,
      streamId,
    };
    writeInflight({
      hubKey: sid,
      sessionId: sid,
      lastSeq: 0,
      profile,
      textAssistantId: assistantId,
      startedAt: Date.now(),
      toolCalls: [],
    });

    const ac = new AbortController();
    abortRef.current = ac;
    const isAbortedRef = { current: false };
    // Only clear inflight on USER-initiated aborts (Stop button, switching
    // session, /stop, newChat). Page-unload cancellation does NOT abort our
    // controller — it just closes the underlying fetch — so the stash stays
    // on disk and the next page load can resume the still-live hub stream.
    ac.signal.addEventListener('abort', () => {
      isAbortedRef.current = true;
      // Only clear inflight if it still belongs to THIS stream — otherwise
      // we'd wipe a newer stream's stash because an old controller fired.
      const inf = inflightRef.current;
      if (inf && inf.streamId === streamId) clearInflight();
    });

    const reconcileSid = (incoming: string) => {
      if (!incoming || incoming === sid) return;
      const old = sid;
      sid = incoming;
      setSessions((list) => {
        const has = list.some((x) => x.id === incoming);
        if (has) return list.filter((x) => x.id !== old);
        return list.map((x) => x.id === old ? { ...x, id: incoming } : x);
      });
      setMessages((m) => {
        if (!m[old]) return m;
        const { [old]: moved, ...rest } = m;
        const existing = rest[incoming];
        const winner = existing && existing.length > (moved?.length || 0) ? existing : moved;
        return { ...rest, [incoming]: winner };
      });
      setResponseIds((r) => {
        if (!r[old]) return r;
        const { [old]: moved, ...rest } = r;
        return { ...rest, [incoming]: moved };
      });
      setActive((cur) => cur === old ? incoming : cur);
      if (inflightRef.current && inflightRef.current.sessionId === old) {
        inflightRef.current.sessionId = incoming;
      }
    };

    try {
      await streamChat(
        {
          message: text,
          profileId: profile,
          sessionId: sid,
          previousResponseId: currentResponseId,
          attachments: liveAtts,
          // Match Hermes Agent's subagent timeout plus a 5-minute completion margin.
          timeoutMs: CHAT_STREAM_DEFAULT_TIMEOUT_MS,
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(reasoningEffort !== defaultReasoning ? { reasoningEffort } : {}),
        },
        buildCallbacks({
          sid, initialAssistantId: assistantId, streamId, profile, onSidReconcile: reconcileSid, isAbortedRef,
        }),
        ac.signal,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!ac.signal.aborted) {
        setError(msg);
        // Restore the composer attachments so the user can retry without
        // re-uploading. Aborts (user pressed Stop) are intentional and we
        // leave the cleared composer alone in that case.
        if (sentAttachments.length) {
          setAttachments((cur) => {
            const haveIds = new Set(cur.map((x) => x.id));
            const restored = sentAttachments.filter((a) => !haveIds.has(a.id));
            return restored.length ? [...cur, ...restored] : cur;
          });
        }
      }
      // Do NOT clearInflight here. The fetch can be cancelled by the browser
      // on page unload (refresh, tab close) — exactly the case where we WANT
      // the stash on disk so the next page load can resume the hub stream.
      // Inflight is cleared by:
      //   - onDone / onError callbacks (server-confirmed termination)
      //   - the abort listener above (user-initiated stop)
      //   - the resume path's 404 fallback (run no longer in hub)
    } finally {
      setBusy(false);
      abortRef.current = null;
      // Only clear our slot if no newer stream has taken over.
      if (inflightRef.current && inflightRef.current.streamId === streamId) {
        inflightRef.current = null;
      }
    }
  }, [
    abortRef, active, attachments, buildCallbacks, busy, clearTimeline, defaultReasoning, input,
    profile, reasoningEffort, responseIds, selectedModel, stickToBottomRef, t,
    setActive, setAttachments, setBusy, setError, setInput, setMessages, setResponseIds, setSessions,
  ]);

  // Resume a still-running stream after a page reload. Fires once per mount,
  // after hydration so we have access to the persisted message list.
  useEffect(() => {
    if (!hydrated || resumeAttemptedRef.current) return;
    resumeAttemptedRef.current = true;
    const stash = readInflight();
    if (!stash || stash.profile !== profile) return;
    const { hubKey, sessionId, lastSeq, textAssistantId } = stash;
    // Bind to the stored session so deltas land in the right thread even if
    // the user hasn't selected it yet. We use sessionId (the messages-map key)
    // for the UI selection — hubKey is internal to the resume call.
    setActive((cur) => cur || sessionId);
    setBusy(true);
    // Wipe any stale timeline carried over from the previous page lifetime so
    // the resumed run renders into a clean side panel instead of stacking on
    // top of unrelated old events.
    clearTimeline();

    let liveSid = sessionId;
    const list = (messages[sessionId] || []);
    const streamId = nextStreamId++;
    // Prefer the persisted in-flight tool-call map — it captures partially
    // streamed args that haven't landed in the messages list yet. Fall back to
    // rebuilding from the persisted message list if the stash didn't carry it
    // (older format, or a fresh run that never persisted any).
    const stashedToolCalls = stash.toolCalls && stash.toolCalls.length
      ? new Map(stash.toolCalls.map((x) => [x.id, {
        assistantId: x.assistantId,
        name: x.name,
        args: x.args,
        itemId: x.itemId,
        callId: x.callId,
      } as ToolCallSlot]))
      : rebuildToolCallsMap(list);
    inflightRef.current = {
      hubKey,
      sessionId,
      textAssistantId,
      toolCalls: stashedToolCalls,
      lastSeq,
      streamId,
    };

    const ac = new AbortController();
    abortRef.current = ac;
    const isAbortedRef = { current: false };
    // Same rule as `send`: user-initiated abort clears the stash; browser-
    // initiated cancel (page unload) leaves it for the next reload.
    ac.signal.addEventListener('abort', () => {
      isAbortedRef.current = true;
      const inf = inflightRef.current;
      if (inf && inf.streamId === streamId) clearInflight();
    });

    const reconcileSid = (incoming: string) => {
      if (!incoming || incoming === liveSid) return;
      const old = liveSid;
      liveSid = incoming;
      setSessions((sl) => sl.map((x) => x.id === old ? { ...x, id: incoming } : x));
      setMessages((m) => {
        if (!m[old]) return m;
        const { [old]: moved, ...rest } = m;
        const existing = rest[incoming];
        const winner = existing && existing.length > (moved?.length || 0) ? existing : moved;
        return { ...rest, [incoming]: winner };
      });
      setResponseIds((r) => {
        if (!r[old]) return r;
        const { [old]: moved, ...rest } = r;
        return { ...rest, [incoming]: moved };
      });
      setActive((cur) => cur === old ? incoming : cur);
      if (inflightRef.current && inflightRef.current.sessionId === old) {
        inflightRef.current.sessionId = incoming;
      }
    };

    (async () => {
      try {
        const ok = await resumeChatStreamClient(
          // CRITICAL: GET /resume is keyed by the hub id, not the canonical
          // session id. They may differ when Hermes assigned its own session id
          // mid-run and we already reconciled the messages-map key.
          hubKey,
          profile,
          lastSeq,
          buildCallbacks({
            sid: sessionId, initialAssistantId: textAssistantId, streamId, profile, onSidReconcile: reconcileSid, isAbortedRef,
          }),
          ac.signal,
        );
        if (!ok) {
          // Run already finished and was evicted — final messages already in
          // state.db. Pull a fresh list so the UI matches what was saved.
          clearInflight();
          try {
            const r = await deckApi.messages(liveSid, profile);
            if (!isAbortedRef.current && r.messages.length) {
              setMessages((m) => ({ ...m, [liveSid]: r.messages }));
            }
          } catch {}
        }
      } catch (e) {
        if (!isAbortedRef.current) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
        }
        // Do NOT clearInflight here for the same reason as `send`'s catch:
        // browser cancellation during page unload would otherwise wipe the
        // stash we need for the next reload. Inflight is cleared explicitly
        // when the run ends (onDone/onError) or the user aborts.
      } finally {
        setBusy(false);
        abortRef.current = null;
        if (inflightRef.current && inflightRef.current.streamId === streamId) {
          inflightRef.current = null;
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Periodically flush lastSeq + toolCalls → localStorage. The streaming
  // callbacks bump inflightRef.current.lastSeq synchronously; this just
  // persists the latest value at most twice per second so a refresh doesn't
  // re-replay too much, and a tool call mid-args-streaming gets restored.
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => {
      const inf = inflightRef.current;
      if (!inf) return;
      writeInflight({
        hubKey: inf.hubKey,
        sessionId: inf.sessionId,
        lastSeq: inf.lastSeq,
        profile,
        textAssistantId: inf.textAssistantId,
        startedAt: Date.now(),
        toolCalls: serializeToolCalls(inf.toolCalls),
      });
    }, 500);
    return () => clearInterval(id);
  }, [busy, profile]);

  // Synchronous flush on page unload. Without this, lastSeq on disk lags up to
  // 500ms behind the messages snapshot (which is flushed by useChatHydration's
  // pagehide handler) — refresh would then replay events seq>stale_lastSeq,
  // re-applying deltas already baked into the persisted assistant content and
  // doubling the visible text. Reading inflightRef directly (no closure) keeps
  // this safe regardless of when the user-visible state last committed.
  useEffect(() => {
    const flush = () => {
      const inf = inflightRef.current;
      if (!inf) return;
      writeInflight({
        hubKey: inf.hubKey,
        sessionId: inf.sessionId,
        lastSeq: inf.lastSeq,
        profile,
        textAssistantId: inf.textAssistantId,
        startedAt: Date.now(),
        toolCalls: serializeToolCalls(inf.toolCalls),
      });
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, [profile]);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    openSessionAbortRef.current?.abort();
    setActive('');
    setError('');
    clearTimeline();
    setTimeout(() => taRef.current?.focus(), 60);
  }, [abortRef, clearTimeline, setActive, setError, taRef]);

  const regenerate = useCallback(async () => {
    if (busy) return;
    const sid = active;
    const list = messages[sid] || [];
    let lastUserIdx = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;
    const lastUser = list[lastUserIdx];
    const userText = lastUser.content;
    if (!userText.trim()) return;
    setMessages((m) => ({ ...m, [sid]: (m[sid] || []).slice(0, lastUserIdx + 1) }));
    setResponseIds((r) => { const next = { ...r }; delete next[sid]; return next; });
    setError('');
    await send(userText, {
      skipUserMessage: true,
      previousResponseIdOverride: null,
      attachmentsOverride: lastUser.attachments || [],
    });
  }, [active, busy, messages, send, setError, setMessages, setResponseIds]);

  regenerateRef.current = regenerate;
  const regenerateStable = useCallback(() => regenerateRef.current(), []);

  return {
    pushTimeline, clearTimeline, handleEvent,
    openSession, send, newChat, regenerate, regenerateStable,
  };
}
