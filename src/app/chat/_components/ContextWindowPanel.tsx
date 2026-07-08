'use client';
import { useMemo } from 'react';
import type { DeckMessage } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { Kicker } from '@/components/Brand';
import {
  buildContextBreakdown,
  type ContextBlockKey,
  type TurnUsage,
} from '../_lib/context-window';

const BLOCK_COLOR: Record<ContextBlockKey, string> = {
  system: 'var(--context-system)',
  user: 'var(--accent)',
  assistant: 'var(--green)',
  tool: 'var(--context-tool)',
  subagent: 'var(--context-subagent)',
  attachments: 'var(--context-attachment)',
};

function pctLabel(n: number, total: number): string {
  if (total <= 0 || n <= 0) return '0%';
  const p = (n / total) * 100;
  if (p < 1) return '<1%';
  return `${Math.round(p)}%`;
}

/**
 * Live breakdown of the chat session's context window — total tokens plus a
 * per-section split (system + tools, user, assistant, tool I/O, attachments).
 * Shares the chat side panel with the compact run-event timeline.
 */
export function ContextWindowPanel({
  messages,
  usage,
}: {
  messages: DeckMessage[];
  usage: TurnUsage | null;
}) {
  const t = useT({
    zh: {
      kicker: '上下文窗口',
      empty: '尚无上下文',
      emptyHint: '发送一条消息后，这里会显示上下文窗口的构成。',
      measured: '实测',
      estimated: '估算',
      subMeasured: 'AI 最新回复时的输入上下文',
      subEstimated: '本地估算 · 下次回复后显示实测值',
      cachePrefix: '缓存命中',
      noteMeasured: '分块为本地估算；「系统提示 + 工具」为实测总量减去可见对话的差值。',
      noteEstimated: '所有数值为本地启发式估算，可能与实际 token 数存在偏差。',
      block: {
        system: '系统提示 + 工具',
        user: '用户消息',
        assistant: '助手回复',
        tool: '工具调用 + 结果',
        subagent: '子代理',
        attachments: '附件',
      } as Record<ContextBlockKey, string>,
    },
    en: {
      kicker: 'CONTEXT WINDOW',
      empty: 'No context yet',
      emptyHint: 'Send a message and this panel will show how the context window breaks down.',
      measured: 'measured',
      estimated: 'estimated',
      subMeasured: 'Input context at the latest reply',
      subEstimated: 'Local estimate · measured after the next reply',
      cachePrefix: 'Cache hit',
      noteMeasured: 'Blocks are local estimates; "System prompt + tools" is the measured total minus the visible conversation.',
      noteEstimated: 'All values are local heuristic estimates and may differ from the real token count.',
      block: {
        system: 'System prompt + tools',
        user: 'User messages',
        assistant: 'Assistant replies',
        tool: 'Tool calls + results',
        subagent: 'Subagents',
        attachments: 'Attachments',
      } as Record<ContextBlockKey, string>,
    },
  });

  const bd = useMemo(() => buildContextBreakdown(messages, usage), [messages, usage]);
  const sorted = useMemo(
    () => [...bd.blocks].sort((a, b) => b.tokens - a.tokens),
    [bd.blocks],
  );

  const containerStyle: React.CSSProperties = {
    padding: 12,
    marginBottom: 14,
    background: 'var(--surface-bg)',
    border: '1px solid var(--hairline)',
    borderRadius: 8,
  };

  if (bd.total <= 0) {
    return (
      <div style={containerStyle}>
        <Kicker style={{ marginBottom: 8 }}>{t.kicker}</Kicker>
        <div style={{ padding: '12px 6px', textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{t.empty}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
            {t.emptyHint}
          </div>
        </div>
      </div>
    );
  }

  const cacheShown = bd.measured && bd.usage != null && bd.usage.cachedTokens > 0;

  return (
    <div style={containerStyle}>
      <Kicker style={{ marginBottom: 8 }}>{t.kicker}</Kicker>

      {/* Headline — total tokens + measured/estimated provenance */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
          <span
            style={{
              fontSize: 25,
              fontWeight: 680,
              letterSpacing: '-.02em',
              lineHeight: 1,
              color: 'var(--strong-text)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {bd.total.toLocaleString()}
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>tokens</span>
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 7px',
            borderRadius: 999,
            border: '1px solid',
            whiteSpace: 'nowrap',
            ...(bd.measured
              ? { color: 'var(--green)', borderColor: 'var(--status-green-border)', background: 'var(--status-green-bg)' }
              : { color: 'var(--muted)', borderColor: 'var(--hairline)', background: 'var(--panel-2)' }),
          }}
        >
          {bd.measured ? t.measured : t.estimated}
        </span>
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--muted-2)', marginTop: 3 }}>
        {bd.measured ? t.subMeasured : t.subEstimated}
      </div>

      {/* Stacked bar */}
      <div
        style={{
          display: 'flex',
          height: 8,
          marginTop: 11,
          borderRadius: 4,
          overflow: 'hidden',
          background: 'var(--panel-2)',
        }}
      >
        {sorted.map((b) => (
          <div
            key={b.key}
            style={{
              width: `${(b.tokens / bd.total) * 100}%`,
              background: BLOCK_COLOR[b.key],
            }}
          />
        ))}
      </div>

      {/* Per-block list */}
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {sorted.map((b) => (
          <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 2,
                background: BLOCK_COLOR[b.key],
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 5 }}>
              <span
                style={{
                  minWidth: 0,
                  fontSize: 11.5,
                  color: 'var(--text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {t.block[b.key]}
              </span>
              {b.count != null && b.count > 0 && (
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 10,
                    color: 'var(--muted-2)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  ·{b.count}
                </span>
              )}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11.5,
                color: 'var(--value-text)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {b.tokens.toLocaleString()}
            </span>
            <span
              style={{
                width: 40,
                textAlign: 'right',
                fontSize: 10.5,
                color: 'var(--muted-2)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {pctLabel(b.tokens, bd.total)}
            </span>
          </div>
        ))}
      </div>

      {/* Cache hit + estimation note */}
      <div style={{ marginTop: 10, paddingTop: 9, borderTop: '1px solid var(--hairline)' }}>
        {cacheShown && bd.usage && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
            {t.cachePrefix}{' '}
            <b style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
              {bd.usage.cachedTokens.toLocaleString()}
            </b>{' '}
            · {pctLabel(bd.usage.cachedTokens, bd.usage.inputTokens)}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--muted-2)', lineHeight: 1.5 }}>
          {bd.measured ? t.noteMeasured : t.noteEstimated}
        </div>
      </div>
    </div>
  );
}
