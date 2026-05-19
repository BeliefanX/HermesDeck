'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type MetaStore, type SessionGoal, type SessionMeta, getMeta } from '@/lib/session-meta';

// Deck-side approximation of Hermes's `/goal` and `/queue` slash commands.
//
// Hermes itself implements both inside gateway/run.py (the gateway's
// _handle_command). Neither runs along the api_server `/v1/responses` path
// HermesDeck talks to — they're gateway primitives. We re-create the *shape*
// of the UX deck-side:
//
//   /goal: a per-session "standing target" stored in localStorage that gets
//          [GOAL] ...-prefixed onto every outgoing user message. Pause keeps
//          the goal in storage but stops prepending; clear removes it.
//
//   /queue: a per-session FIFO of pending prompts kept in memory (lost on
//          reload, like Hermes's own gateway queue). When the assistant
//          finishes the current turn (busy goes false), the next item is
//          dispatched automatically.
//
// `/steer` is intentionally NOT implemented: it requires injecting a
// follow-up between tool calls inside a running agent loop, which the
// api_server doesn't expose. The user must `/stop` and `/queue` to approximate.

export interface QueuedPrompt {
  id: string;
  text: string;
  /** Captured at enqueue time so a goal change between enqueue and dispatch
   *  doesn't rewrite the user's intent retroactively. */
  goalSnapshot?: { text: string } | null;
  enqueuedAt: number;
}

interface UseGoalAndQueueArgs {
  active: string;
  busy: boolean;
  metaStore: MetaStore;
  updateMeta: (sessionId: string, patch: Partial<SessionMeta>) => void;
  input: string;
  setInput: (v: string) => void;
  send: (override?: string) => void | Promise<void>;
}

export interface UseGoalAndQueueResult {
  goal: SessionGoal | undefined;
  goalActive: boolean;
  setGoal: (text: string) => void;
  pauseGoal: () => void;
  resumeGoal: () => void;
  clearGoal: () => void;
  queue: QueuedPrompt[];
  enqueue: () => void;
  removeQueued: (id: string) => void;
  clearQueue: () => void;
  /** Drop-in replacement for `send` that prepends the active goal to the
   *  outgoing prompt and clears the textarea. Returns the same Promise. */
  sendWithGoal: (override?: string) => void | Promise<void>;
}

export function useGoalAndQueue({
  active, busy, metaStore, updateMeta, input, setInput, send,
}: UseGoalAndQueueArgs): UseGoalAndQueueResult {
  const meta = active ? getMeta(metaStore, active) : null;
  const goal = meta?.goal;
  const goalActive = !!(goal && !goal.pausedAt && goal.text.trim());

  const setGoal = useCallback((text: string) => {
    if (!active) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    updateMeta(active, { goal: { text: trimmed.slice(0, 480), setAt: new Date().toISOString() } });
  }, [active, updateMeta]);

  const pauseGoal = useCallback(() => {
    if (!active || !goal) return;
    updateMeta(active, { goal: { ...goal, pausedAt: new Date().toISOString() } });
  }, [active, goal, updateMeta]);

  const resumeGoal = useCallback(() => {
    if (!active || !goal) return;
    const { pausedAt, ...rest } = goal;
    void pausedAt;
    updateMeta(active, { goal: rest });
  }, [active, goal, updateMeta]);

  const clearGoal = useCallback(() => {
    if (!active) return;
    updateMeta(active, { goal: undefined });
  }, [active, updateMeta]);

  // Queue lives in a ref so we don't pay a re-render per character of typing
  // (only on enqueue/dispatch). The mirror state `queue` triggers the
  // dispatch effect and the chip-row UI.
  const queueByIdRef = useRef<Record<string, QueuedPrompt[]>>({});
  const [queue, setQueueState] = useState<QueuedPrompt[]>([]);

  const refreshQueue = useCallback(() => {
    setQueueState(queueByIdRef.current[active] ? [...queueByIdRef.current[active]] : []);
  }, [active]);

  // Reset visible queue when active session switches.
  useEffect(() => { refreshQueue(); }, [active, refreshQueue]);

  const formatPrompt = useCallback((text: string, snapshot?: { text: string } | null) => {
    // The snapshot wins so a queue item dispatched after a goal change still
    // reflects what the user agreed to when queuing. Falls back to the live
    // goal for direct sendWithGoal calls (no snapshot supplied).
    const effective = snapshot ?? (goalActive ? { text: goal!.text } : null);
    if (!effective) return text;
    return `[GOAL] ${effective.text}\n\n${text}`;
  }, [goal, goalActive]);

  const sendWithGoal = useCallback((override?: string) => {
    const raw = (override ?? input).trim();
    if (!raw) return;
    const final = formatPrompt(raw);
    // useChatStream's send only clears `input` when called with no textArg.
    // We always pass an override (the prefixed text), so clear it ourselves.
    if (override === undefined) setInput('');
    return send(final);
  }, [input, formatPrompt, send, setInput]);

  const enqueue = useCallback(() => {
    const raw = input.trim();
    if (!raw || !active) return;
    const id = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const item: QueuedPrompt = {
      id,
      text: raw,
      goalSnapshot: goalActive ? { text: goal!.text } : null,
      enqueuedAt: Date.now(),
    };
    const list = queueByIdRef.current[active] || [];
    queueByIdRef.current[active] = [...list, item];
    setInput('');
    refreshQueue();
  }, [active, input, goal, goalActive, setInput, refreshQueue]);

  const removeQueued = useCallback((id: string) => {
    if (!active) return;
    const list = queueByIdRef.current[active] || [];
    queueByIdRef.current[active] = list.filter((q) => q.id !== id);
    refreshQueue();
  }, [active, refreshQueue]);

  const clearQueue = useCallback(() => {
    if (!active) return;
    queueByIdRef.current[active] = [];
    refreshQueue();
  }, [active, refreshQueue]);

  // Auto-dispatch: when the chat goes idle and there's a queued message for
  // the active session, pop and send. The effect re-runs whenever `queue`
  // changes (via refreshQueue) so a fresh enqueue while idle dispatches
  // immediately. The busy guard handles the case where send() flips busy=true
  // synchronously — the next render bails.
  useEffect(() => {
    if (busy || !active) return;
    const list = queueByIdRef.current[active] || [];
    if (list.length === 0) return;
    const next = list[0];
    queueByIdRef.current[active] = list.slice(1);
    // Update the visible queue first; refreshQueue's setState is fine even if
    // we're already inside an effect — React will batch with `send`'s setBusy.
    refreshQueue();
    const final = formatPrompt(next.text, next.goalSnapshot);
    void send(final);
  }, [busy, active, queue.length, formatPrompt, send, refreshQueue]);

  return {
    goal,
    goalActive,
    setGoal,
    pauseGoal,
    resumeGoal,
    clearGoal,
    queue,
    enqueue,
    removeQueued,
    clearQueue,
    sendWithGoal,
  };
}
