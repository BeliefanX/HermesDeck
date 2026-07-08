import type { DeckMessage } from '@/lib/types';

export const ASYNC_DELEGATION_RESULT_KIND = 'async-delegation-result';
export const ASYNC_DELEGATION_TOOL_NAME = 'delegate_task';

const ASYNC_DELEGATION_COMPLETE_RE = /^\[ASYNC DELEGATION(?: BATCH)? COMPLETE — deleg_[0-9a-f]{8}\]/i;

export function isAsyncDelegationCompletionContent(content: string): boolean {
  return ASYNC_DELEGATION_COMPLETE_RE.test(content.trimStart());
}

export function normalizeAsyncDelegationCompletionMessage(message: DeckMessage): DeckMessage {
  if (message.role !== 'user' || !isAsyncDelegationCompletionContent(message.content)) return message;
  return {
    ...message,
    role: 'assistant',
    toolName: ASYNC_DELEGATION_TOOL_NAME,
    metadata: {
      ...message.metadata,
      projectionKind: ASYNC_DELEGATION_RESULT_KIND,
    },
  };
}

export function isAsyncDelegationResultMessage(message: DeckMessage): boolean {
  return message.role === 'assistant' && message.metadata?.projectionKind === ASYNC_DELEGATION_RESULT_KIND;
}
