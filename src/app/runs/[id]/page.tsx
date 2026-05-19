'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { deckApi } from '@/lib/api';
import type { DeckRunDetail } from '@/lib/types';
import {
  ArrowLeft, Bot, ChevronRight, Clock, Hash, MessageSquare, Wrench, AlertCircle, Activity, CheckCircle2,
} from 'lucide-react';
import { Page, Card, Kbd, Kicker, SectionHead, Tag, type Tone } from '@/components/Brand';
import { sourceMeta, sourceTone, shortTitle, relTime } from '@/lib/format';
import { MessageContent } from '@/components/MessageContent';
import { useT } from '@/lib/i18n';

function fmtDuration(ms?: number): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function statusTone(status: DeckRunDetail['status']): Tone {
  if (status === 'success') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'running') return 'accent';
  return 'default';
}

export default function RunDetailPage() {
  const t = useT({
    zh: {
      breadcrumbRuns: '运行',
      kickerRun: '运行',
      untitledSession: '未命名会话',
      kickerNotFound: '未找到运行',
      cantLoad: '无法加载该运行',
      missingDesc: '该 run id 可能来自已删除的会话，或 state.db 文件已被移动。',
      backToRuns: '← 返回运行列表',
      openInChat: '在聊天中打开',
      tabSummary: '摘要',
      tabTimeline: '时间线',
      tabRaw: '原始数据',
    },
    en: {
      breadcrumbRuns: 'Runs',
      kickerRun: 'RUN',
      untitledSession: 'Untitled session',
      kickerNotFound: 'RUN NOT FOUND',
      cantLoad: 'We couldn’t load this run',
      missingDesc: 'The run id may be from a deleted session, or the state.db file moved.',
      backToRuns: '← Back to runs',
      openInChat: 'open in chat',
      tabSummary: 'Summary',
      tabTimeline: 'Timeline',
      tabRaw: 'Raw',
    },
  });

  const params = useParams<{ id: string }>();
  const id = params?.id ? decodeURIComponent(String(params.id)) : '';
  const [run, setRun] = useState<DeckRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'summary' | 'timeline' | 'raw'>('summary');

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    const ac = new AbortController();
    deckApi.runDetail(id, ac.signal)
      .then((r) => { if (alive) setRun(r); })
      .catch((e) => {
        if (!alive || ac.signal.aborted) return;
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; ac.abort(); };
  }, [id]);

  if (loading) {
    return (
      <Page>
        <Card>
          <div className="skel" style={{ width: 240, height: 22 }} />
          <div style={{ height: 10 }} />
          <div className="skel" style={{ width: '70%', height: 14 }} />
        </Card>
      </Page>
    );
  }

  if (err || !run) {
    return (
      <Page>
        <Card>
          <Kicker>{t.kickerNotFound}</Kicker>
          <h2 style={{ margin: '6px 0 8px', fontSize: 18, fontWeight: 620, color: 'var(--strong-text)' }}>
            {t.cantLoad}
          </h2>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
            {err || t.missingDesc}
          </div>
          <Link href="/runs" style={{ textDecoration: 'none', color: 'var(--accent)', fontSize: 12.5 }}>
            {t.backToRuns}
          </Link>
        </Card>
      </Page>
    );
  }

  const meta = sourceMeta(run.source);

  return (
    <Page>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Link href="/runs" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--muted)', textDecoration: 'none' }}>
          <ArrowLeft size={12} /> {t.breadcrumbRuns}
        </Link>
        <ChevronRight size={11} style={{ color: 'var(--muted-2)' }} />
        <span style={{ fontSize: 11.5, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>{run.id}</span>
      </div>

      <Card hero>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Kicker>{t.kickerRun}</Kicker>
            <h1 style={{ fontSize: 22, fontWeight: 650, letterSpacing: '-.02em', color: 'var(--strong-text)', margin: '4px 0 8px' }}>
              {shortTitle(run.sessionTitle, 80) || t.untitledSession}
            </h1>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Tag variant={statusTone(run.status)} icon={
                run.status === 'success' ? <CheckCircle2 size={11} />
                : run.status === 'failed' ? <AlertCircle size={11} />
                : <Activity size={11} />
              }>{run.status}</Tag>
              <Tag variant={sourceTone(meta.tone)}>{meta.short}</Tag>
              <span style={{ fontFamily: 'var(--font-mono)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Bot size={11} /> {run.profileId}
              </span>
              {run.model && (
                <span style={{ fontFamily: 'var(--font-mono)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Hash size={11} /> {run.model}
                </span>
              )}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Clock size={11} /> {relTime(run.startedAt)} · {fmtDuration(run.durationMs)}
              </span>
            </div>
          </div>
          <Link href={`/chat?session=${encodeURIComponent(run.sessionId)}`} style={{ textDecoration: 'none' }}>
            <Tag icon={<MessageSquare size={11} />}>{t.openInChat}</Tag>
          </Link>
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <TabBtn active={tab === 'summary'} onClick={() => setTab('summary')}>{t.tabSummary}</TabBtn>
        <TabBtn active={tab === 'timeline'} onClick={() => setTab('timeline')}>{t.tabTimeline} · {run.events.length}</TabBtn>
        <TabBtn active={tab === 'raw'} onClick={() => setTab('raw')}>{t.tabRaw}</TabBtn>
      </div>

      {tab === 'summary' && <SummaryView run={run} />}
      {tab === 'timeline' && <TimelineView run={run} />}
      {tab === 'raw' && <RawView run={run} />}
    </Page>
  );
}

function SummaryView({ run }: { run: DeckRunDetail }) {
  const t = useT({
    zh: {
      kickerError: '错误',
      kickerPrompt: '用户提问',
      titleAsked: '提了什么',
      kickerReply: '助手回复',
      titleResult: '结果',
      kickerTools: '使用的工具',
      uniqueLabel: '种 · ',
      callsLabel: '次调用',
    },
    en: {
      kickerError: 'ERROR',
      kickerPrompt: 'USER PROMPT',
      titleAsked: 'What was asked',
      kickerReply: 'ASSISTANT REPLY',
      titleResult: 'Result',
      kickerTools: 'TOOLS USED',
      uniqueLabel: ' unique · ',
      callsLabel: ' call(s)',
    },
  });
  return (
    <>
      {run.errorSummary && (
        <Card style={{ borderColor: 'rgba(239,68,68,.4)' }}>
          <Kicker>{t.kickerError}</Kicker>
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--red)', fontFamily: 'var(--font-mono)' }}>
            {run.errorSummary}
          </div>
        </Card>
      )}

      <Card>
        <SectionHead kicker={t.kickerPrompt} title={t.titleAsked} />
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {run.promptPreview || '—'}
        </div>
      </Card>

      <Card>
        <SectionHead kicker={t.kickerReply} title={t.titleResult} />
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {run.replyPreview || '—'}
        </div>
      </Card>

      {run.toolNames.length > 0 && (
        <Card>
          <SectionHead
            kicker={t.kickerTools}
            title={<><Wrench size={14} style={{ color: 'var(--accent)' }} /> {run.toolNames.length}{t.uniqueLabel}{run.toolCallCount}{t.callsLabel}</>}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {run.toolNames.map((n) => (
              <Tag key={n} icon={<Wrench size={10} />}>{n}</Tag>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function TimelineView({ run }: { run: DeckRunDetail }) {
  const t = useT({
    zh: { noEvents: '此次运行没有记录任何事件。' },
    en: { noEvents: 'No events recorded for this run.' },
  });
  return (
    <Card padding={0}>
      {run.events.map((ev, i) => (
        <div key={ev.id} style={{ padding: '14px 16px', borderTop: i === 0 ? 'none' : '1px solid var(--hairline)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 11.5 }}>
            <Tag variant={ev.role === 'user' ? 'accent' : ev.role === 'tool' ? 'cyan' : ev.role === 'assistant' ? 'green' : 'default'}>
              {ev.role}
            </Tag>
            {ev.toolName && <Tag icon={<Wrench size={10} />}>{ev.toolName}</Tag>}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>
              {relTime(ev.createdAt)}
            </span>
          </div>
          {ev.toolCalls && ev.toolCalls.length > 0 && (
            <div style={{ marginBottom: 8, padding: 10, background: 'var(--surface-bg)', border: '1px solid var(--hairline)', borderRadius: 8 }}>
              {ev.toolCalls.map((tc, j) => (
                <div key={j} style={{ marginBottom: j < ev.toolCalls!.length - 1 ? 6 : 0, fontSize: 11.5, fontFamily: 'var(--font-mono)' }}>
                  <span style={{ color: 'var(--accent)' }}>{tc.name || 'tool'}</span>
                  <span style={{ color: 'var(--muted-2)' }}>(</span>
                  <span style={{ color: 'var(--muted)', wordBreak: 'break-all' }}>
                    {String(tc.arguments || '').slice(0, 200)}
                  </span>
                  <span style={{ color: 'var(--muted-2)' }}>)</span>
                </div>
              ))}
            </div>
          )}
          {ev.content && (
            <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.55 }}>
              {ev.role === 'assistant' || ev.role === 'user' ? (
                <MessageContent content={String(ev.content).slice(0, 4000)} />
              ) : (
                <pre style={{ margin: 0, padding: 10, background: 'var(--surface-bg)', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 11.5, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {String(ev.content).slice(0, 2400)}
                </pre>
              )}
            </div>
          )}
        </div>
      ))}
      {run.events.length === 0 && (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>{t.noEvents}</div>
      )}
    </Card>
  );
}

function RawView({ run }: { run: DeckRunDetail }) {
  const t = useT({
    zh: { kickerRaw: '原始 JSON' },
    en: { kickerRaw: 'RAW JSON' },
  });
  return (
    <Card>
      <Kicker>{t.kickerRaw}</Kicker>
      <pre style={{ marginTop: 8, padding: 12, background: 'var(--surface-bg)', border: '1px solid var(--hairline)', borderRadius: 8, fontSize: 11, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 600, overflow: 'auto' }}>
        {JSON.stringify(run, null, 2)}
      </pre>
    </Card>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        height: 28,
        padding: '0 12px',
        borderRadius: 7,
        background: active ? 'var(--accent-soft)' : 'var(--bg-soft)',
        border: `1px solid ${active ? 'var(--accent-border)' : 'var(--line)'}`,
        color: active ? 'var(--accent)' : 'var(--text)',
        fontSize: 12,
        fontFamily: 'var(--font-sans)',
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
