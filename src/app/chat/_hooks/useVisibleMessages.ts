'use client';
import { useMemo } from 'react';
import type { DeckMessage } from '@/lib/types';
import { normalizeAsyncDelegationCompletionMessage } from '../../../lib/async-delegation.ts';

export function isProjectedDraftMessage(m: DeckMessage): boolean {
  return m.role === 'assistant' && m.metadata?.projectionStatus === 'draft';
}

export function isPendingApprovalMessage(m: DeckMessage): boolean {
  return m.role === 'assistant' && m.metadata?.projectionKind === 'approval' && m.metadata?.approvalStatus === 'pending';
}

function hasText(m: DeckMessage): boolean {
  return !!(m.content && m.content.trim());
}

function hasToolCalls(m: DeckMessage): boolean {
  return (m.toolCalls?.length || 0) > 0;
}

function hasAttachments(m: DeckMessage): boolean {
  return (m.attachments?.length || 0) > 0;
}

function isEmptyAssistantTextTarget(m: DeckMessage): boolean {
  if (isPendingApprovalMessage(m)) return false;
  return m.role === 'assistant' && !hasText(m) && !hasToolCalls(m) && !hasAttachments(m);
}

function hiddenByToolDetails(m: DeckMessage): boolean {
  if (m.role === 'tool' || m.role === 'system' || m.role === 'session_meta') return true;
  if (m.role === 'assistant' && !hasText(m) && hasToolCalls(m)) return true;
  return m.role === 'assistant' && !!m.content && m.content.startsWith('[CONTEXT COMPACTION');
}

function latestTypingTargetIndex(activeMessages: DeckMessage[], busy: boolean): number {
  for (let idx = activeMessages.length - 1; idx >= 0; idx -= 1) {
    const m = activeMessages[idx];
    if (!isEmptyAssistantTextTarget(m)) continue;
    if (busy || isProjectedDraftMessage(m)) return idx;
  }
  return -1;
}

export function selectVisibleMessages(activeMessages: DeckMessage[], showToolDetails: boolean, busy: boolean): DeckMessage[] {
  const messages = activeMessages.map(normalizeAsyncDelegationCompletionMessage);
  const typingTargetIdx = latestTypingTargetIndex(messages, busy);
  const visible = messages.filter((m, idx) => {
    const emptyNonToolRow = !hasText(m) && !hasToolCalls(m) && !hasAttachments(m) && m.role !== 'tool';

    if (!showToolDetails && hiddenByToolDetails(m)) return false;

    // Empty assistant drafts all render as the same typing bubble. Keep only
    // the current target; otherwise a projected draft left behind before a
    // visible tool-call row creates a second loading animation.
    if (emptyNonToolRow) return idx === typingTargetIdx;

    return true;
  });
  const typingVisibleIdx = visible.findIndex((m) => isEmptyAssistantTextTarget(m) && (busy || isProjectedDraftMessage(m)));
  if (typingVisibleIdx <= 0) return visible;
  const pendingAfterTyping = visible.slice(typingVisibleIdx + 1).filter(isPendingApprovalMessage);
  if (!pendingAfterTyping.length) return visible;
  return [
    ...visible.slice(0, typingVisibleIdx),
    ...pendingAfterTyping,
    ...visible.slice(typingVisibleIdx).filter((m) => !pendingAfterTyping.includes(m)),
  ];
}

/**
 * Two-stage filter for the chat thread:
 *   1) Default-noise rules — hide tool / system / session_meta / compaction
 *      handoff rows unless the user opts into tool-detail mode.
 *   2) Render-emptiness check — drop any row that would render to literally
 *      nothing.
 *
 * Special case: keep exactly one empty assistant during `busy` or server
 * projection polling — that's the live typing target. Pending approval cards
 * stay visible and are placed before that loading bubble.
 *
 * Also returns a call_id → tool_name index built from assistant tool_call rows
 * so role='tool' result rows can surface their originating tool name.
 */
export function useVisibleMessages(activeMessages: DeckMessage[], showToolDetails: boolean, busy: boolean) {
  const toolNameByCallId = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of activeMessages) {
      if (!m.toolCalls?.length) continue;
      for (const c of m.toolCalls) {
        if (c.id && c.name) map.set(c.id, c.name);
      }
    }
    return map;
  }, [activeMessages]);

  const visibleMessages = useMemo(() => {
    return selectVisibleMessages(activeMessages, showToolDetails, busy);
  }, [activeMessages, showToolDetails, busy]);

  const hiddenToolCount = useMemo(() => {
    if (showToolDetails) return 0;
    return activeMessages.map(normalizeAsyncDelegationCompletionMessage).reduce((count, m) => count + (hiddenByToolDetails(m) ? 1 : 0), 0);
  }, [activeMessages, showToolDetails]);

  return { toolNameByCallId, visibleMessages, hiddenToolCount };
}
