'use client';
import type { DeckMessage, DeckSession, ToolSummary } from '@/lib/types';
import type { TimelineItem } from '@/lib/timeline';
import { Kicker } from '@/components/Brand';
import { useT } from '@/lib/i18n';
import type { TurnUsage } from '../_lib/context-window';
import { ChatInspector } from './Inspector';
import { ContextWindowPanel } from './ContextWindowPanel';

export function TimelinePanel({
  profile, activeSession, activeMessages, tools, timeline, responseId, usage,
}: {
  profile: string;
  activeSession?: DeckSession;
  activeMessages: DeckMessage[];
  tools: ToolSummary[];
  timeline: TimelineItem[];
  responseId?: string;
  usage: TurnUsage | null;
}) {
  const t = useT({
    zh: { kicker: '观测', title: '上下文窗口', hint: 'AI 最新回复时的 token 构成', events: '运行事件', empty: '等待事件…' },
    en: { kicker: 'OBSERVABILITY', title: 'Context window', hint: "Token make-up at the AI's latest reply", events: 'Run events', empty: 'Waiting for events…' },
  });
  return (
    <aside
      className="chat-panel thread right-panel"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div
        className="panel-header"
        style={{
          padding: '14px 16px 12px',
          borderBottom: '1px solid var(--hairline)',
        }}
      >
        <Kicker style={{ marginBottom: 4 }}>{t.kicker}</Kicker>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 620, color: 'var(--strong-text)', letterSpacing: '-.012em' }}>{t.title}</h2>
        <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 2 }}>{t.hint}</div>
      </div>
      <div className="panel-body" style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: 14 }}>
        <ContextWindowPanel messages={activeMessages} usage={usage} />
        <div style={{ padding: 12, marginBottom: 14, background: 'var(--surface-bg)', border: '1px solid var(--hairline)', borderRadius: 8 }}>
          <Kicker style={{ marginBottom: 8 }}>{t.events}</Kicker>
          {timeline.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {timeline.slice(0, 20).map((item) => (
                <div key={item.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, background: item.kind === 'error' ? 'var(--red)' : item.kind === 'tool' ? 'var(--accent)' : 'var(--muted-2)', flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11.5, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
                    {item.summary && <div style={{ marginTop: 2, fontSize: 10.5, color: 'var(--muted-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.summary}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--muted-2)' }}>{t.empty}</div>
          )}
        </div>
        <ChatInspector
          profile={profile}
          session={activeSession}
          messageCount={activeMessages.length}
          tools={tools}
          responseId={responseId}
        />
      </div>
    </aside>
  );
}
