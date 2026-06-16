'use client';
import { useMemo } from 'react';
import type { DeckMessage } from '@/lib/types';

export function isProjectedDraftMessage(m: DeckMessage): boolean {
  return m.role === 'assistant' && m.metadata?.projectionStatus === 'draft';
}

/**
 * Two-stage filter for the chat thread:
 *   1) Default-noise rules — hide tool / system / session_meta / compaction
 *      handoff rows unless the user opts into tool-detail mode.
 *   2) Render-emptiness check — drop any row that would render to literally
 *      nothing.
 *
 * Special case: keep the trailing empty assistant during `busy` — that's
 * the live streaming target so the typing dots can animate into it.
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
    return activeMessages.filter((m, idx) => {
      const hasText = !!(m.content && m.content.trim());
      const hasToolCalls = (m.toolCalls?.length || 0) > 0;
      const hasAttachments = (m.attachments?.length || 0) > 0;
      const isStreamingTarget =
        (busy && idx === activeMessages.length - 1 && m.role === 'assistant' && !hasToolCalls)
        || (isProjectedDraftMessage(m) && !hasToolCalls);

      if (!showToolDetails) {
        if (m.role === 'tool' || m.role === 'system' || m.role === 'session_meta') return false;
        if (m.role === 'assistant' && !hasText && hasToolCalls) return false;
        if (m.role === 'assistant' && m.content && m.content.startsWith('[CONTEXT COMPACTION')) return false;
      }

      // Renders nothing in any mode (tool-result rows still render a header
      // even with empty content, so they're exempt).
      if (!hasText && !hasToolCalls && !hasAttachments && m.role !== 'tool') {
        return isStreamingTarget;
      }
      return true;
    });
  }, [activeMessages, showToolDetails, busy]);

  const hiddenToolCount = activeMessages.length - visibleMessages.length;

  return { toolNameByCallId, visibleMessages, hiddenToolCount };
}
