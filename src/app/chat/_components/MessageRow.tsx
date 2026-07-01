'use client';
import { memo, useState } from 'react';
import { Bot, CheckCircle2, ChevronDown, Network, ShieldAlert, Wrench } from 'lucide-react';
import type { DeckMessage } from '@/lib/types';
import { deckApi } from '@/lib/api';
import { MessageContent } from '@/components/MessageContent';
import { MessageActions } from '@/components/MessageActions';
import { AttachmentChip } from '@/components/AttachmentChip';
import { type AttachmentItem } from '@/lib/attachments';
import { safeAttachmentImageUrl } from '@/lib/safe-links';
import { isSubagentTool } from '../_lib/subagent';
import { isProjectedDraftMessage } from '../_hooks/useVisibleMessages';

// Memoized chat row: the streaming assistant message updates content rapidly
// during a response. Without memo, every prior message re-runs MessageContent's
// markdown pipeline on each chunk. With memo + stable props, only the actively
// streaming row re-renders.
export const ChatMessageRow = memo(function ChatMessageRow({
  m,
  isLast,
  busy,
  profile,
  sessionId,
  hasUserMessage,
  resolvedToolName,
  attachmentsAria,
  onRegenerate,
  onPreviewImage,
}: {
  m: DeckMessage;
  isLast: boolean;
  busy: boolean;
  profile: string;
  sessionId: string;
  hasUserMessage: boolean;
  resolvedToolName?: string;
  attachmentsAria: string;
  onRegenerate?: () => void;
  onPreviewImage?: (src: string, name?: string) => void;
}) {
  const isLastAssistant = isLast && m.role === 'assistant';
  const showRegenerate = isLastAssistant && !busy && !!m.content && hasUserMessage;
  const showTyping = m.role === 'assistant' && !m.content && !m.toolCalls?.length && (busy || isProjectedDraftMessage(m));
  const isTool = m.role === 'tool';
  const isApproval = m.role === 'assistant' && m.metadata?.projectionKind === 'approval';
  const isToolCall = m.role === 'assistant' && (m.toolCalls?.length || 0) > 0 && !m.content;
  const isSubagentRow =
    (isToolCall && (m.toolCalls || []).some((c) => isSubagentTool(c.name)))
    || (isTool && isSubagentTool(resolvedToolName));
  return (
    <div
      className={`msg-row ${m.role}${isLastAssistant && !busy && m.content ? ' show-actions' : ''}${isTool || isToolCall ? ' is-tool' : ''}${isSubagentRow ? ' is-subagent' : ''}`}
    >
      <div className={`msg ${m.role}${isTool || isToolCall ? ' tool' : ''}${isSubagentRow ? ' subagent' : ''}`}>
        {m.attachments && m.attachments.length > 0 && (
          <div className="msg-attachments" role="list" aria-label={attachmentsAria}>
            {m.attachments.map((a) => {
              const previewSrc = a.kind === 'image' ? (safeAttachmentImageUrl(a.dataUrl) || safeAttachmentImageUrl(a.url) || '') : '';
              return (
                <AttachmentChip
                  key={a.id}
                  item={{ ...a, status: 'ready' } as AttachmentItem}
                  readOnly
                  onPreview={previewSrc && onPreviewImage ? () => onPreviewImage(previewSrc, a.name) : undefined}
                />
              );
            })}
          </div>
        )}
        {isApproval ? (
          <ApprovalBlock message={m} profile={profile} sessionId={sessionId} />
        ) : isToolCall ? (
          <ToolCallSummary calls={m.toolCalls || []} />
        ) : isTool ? (
          <ToolResultSummary toolName={resolvedToolName} content={m.content} />
        ) : m.content ? (
          <MessageContent content={m.content} streaming={isLastAssistant && busy} />
        ) : showTyping ? (
          <span className="msg-typing"><span /><span /><span /></span>
        ) : null}
      </div>
      {m.content && !showTyping && !isTool && !isToolCall && !isApproval && (
        <MessageActions
          content={m.content}
          canRegenerate={showRegenerate}
          onRegenerate={onRegenerate}
          busy={busy}
        />
      )}
    </div>
  );
});

// Parse-once helper: returns the parsed value, the pretty-printed text, and a
// flag indicating whether the input was structured JSON.
function parseToolPayload(raw: string): { value: unknown; formatted: string; isJson: boolean } {
  if (!raw) return { value: null, formatted: '', isJson: false };
  const trimmed = raw.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return { value: null, formatted: raw, isJson: false };
  try {
    const value = JSON.parse(trimmed);
    return { value, formatted: JSON.stringify(value, null, 2), isJson: true };
  } catch {
    return { value: null, formatted: raw, isJson: false };
  }
}

const ApprovalBlock = memo(function ApprovalBlock({ message, profile, sessionId }: { message: DeckMessage; profile: string; sessionId: string }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const runId = typeof message.metadata?.runId === 'string' ? message.metadata.runId : '';
  const pending = message.metadata?.approvalStatus === 'pending' && !done;
  const choices = Array.isArray(message.metadata?.choices)
    ? message.metadata.choices.filter((x): x is 'once' | 'session' | 'always' | 'deny' => x === 'once' || x === 'session' || x === 'always' || x === 'deny')
    : ['once', 'session', 'always', 'deny'] as const;
  const labels = { once: 'Approve once', session: 'Session', always: 'Always', deny: 'Deny' } as const;
  const actionUnavailable = message.metadata?.actionUnavailable === true || choices.length === 0;
  const choose = async (choice: 'once' | 'session' | 'always' | 'deny') => {
    if (!runId || !sessionId || busy) return;
    setBusy(choice); setError('');
    try { await deckApi.chatApproval({ profileId: profile, sessionId, runId, choice }); setDone(true); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(''); }
  };
  return (
    <div className="tool-block approval-block">
      <div className="tool-block-head">
        <ShieldAlert size={12} />
        <span className="tool-block-title">{pending ? 'Approval required' : 'Approval resolved'}</span>
        {!pending && <span className="muted">resolved</span>}
      </div>
      {pending && <pre className="tool-call-args">{message.content}</pre>}
      {pending && !actionUnavailable && <div className="approval-actions">
        {choices.map((choice) => <button key={choice} type="button" className={`approval-choice ${choice === 'deny' ? 'deny' : 'approve'}`} disabled={!!busy} onClick={() => choose(choice)}>{busy === choice ? 'Submitting…' : labels[choice]}</button>)}
      </div>}
      {pending && actionUnavailable && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        This approval was returned by a nested tool run and cannot be resolved from this Deck card. Start a fresh turn after approving in the original channel, or rerun with a safer command path.
      </div>}
      {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>{error}</div>}
    </div>
  );
});

const ToolCallSummary = memo(function ToolCallSummary({ calls }: { calls: Array<{ id?: string; name?: string; arguments?: string }> }) {
  const [open, setOpen] = useState(false);
  const subagent = calls.some((c) => isSubagentTool(c.name));
  const Icon = subagent ? Network : Wrench;
  const title = subagent ? 'Delegate to subagent' : 'Tool call';
  return (
    <div className={`tool-block${subagent ? ' subagent' : ''}`}>
      <div className="tool-block-head" onClick={() => setOpen((v) => !v)} role="button" aria-expanded={open}>
        <Icon size={12} />
        <span className="tool-block-title">
          {title} {calls.length > 1 && <span className="muted">×{calls.length}</span>}
        </span>
        <span className="tool-block-names">
          {calls.map((c) => c.name).filter(Boolean).join(' · ') || 'tool'}
        </span>
        <ChevronDown size={12} className={`tool-block-chev ${open ? 'open' : ''}`} />
      </div>
      {open && (
        <div className="tool-block-body">
          {calls.map((c, i) => {
            const parsed = parseToolPayload(c.arguments || '');
            return (
              <div key={c.id || i} className="tool-call-entry">
                <div className="tool-call-name">
                  {isSubagentTool(c.name) && <Bot size={11} style={{ marginRight: 4, verticalAlign: -1 }} />}
                  {c.name || 'tool'}
                </div>
                <pre className="tool-call-args">{parsed.formatted || '(no args)'}</pre>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

// Try to extract the most useful preview line for a delegate_task result.
// The shape is `{results:[{task_index, status, summary, ...}, ...]}` — the
// summary is the subagent's actual answer, much more useful than raw JSON keys.
function extractSubagentPreview(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results) || !results.length) return null;
  const first = results[0] as Record<string, unknown>;
  const summary = typeof first?.summary === 'string' ? first.summary : '';
  const status = typeof first?.status === 'string' ? `[${first.status}] ` : '';
  const head = (status + summary).replace(/\s+/g, ' ').trim();
  if (!head) return null;
  return head.length > 160 ? head.slice(0, 160) + '…' : head;
}

const ToolResultSummary = memo(function ToolResultSummary({ toolName, content }: { toolName?: string; content: string }) {
  const [open, setOpen] = useState(false);
  const subagent = isSubagentTool(toolName);
  const parsed = parseToolPayload(content);
  // Subagent results carry a human-readable summary buried in JSON — surface
  // that instead of generic key:value preview.
  let preview = '';
  if (subagent) {
    preview = extractSubagentPreview(parsed.value) ?? '';
  } else if (parsed.isJson && parsed.value && typeof parsed.value === 'object') {
    const entries = Object.entries(parsed.value as Record<string, unknown>).slice(0, 2);
    preview = entries.map(([k, v]) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}: ${s.length > 60 ? s.slice(0, 60) + '…' : s}`;
    }).join(' · ');
  } else if (!parsed.isJson) {
    preview = content.length > 140 ? content.slice(0, 140) + '…' : content;
  }
  const Icon = subagent ? Bot : CheckCircle2;
  const title = subagent ? 'Subagent result' : 'Tool result';
  return (
    <div className={`tool-block result${subagent ? ' subagent' : ''}`}>
      <div className="tool-block-head" onClick={() => setOpen((v) => !v)} role="button" aria-expanded={open}>
        <Icon size={12} />
        <span className="tool-block-title">{title}</span>
        {toolName && <span className="tool-block-names">{toolName}</span>}
        <ChevronDown size={12} className={`tool-block-chev ${open ? 'open' : ''}`} />
      </div>
      {!open && preview && <div className="tool-block-preview">{preview}</div>}
      {open && (
        <pre className="tool-call-args">{parsed.formatted || content}</pre>
      )}
    </div>
  );
});
