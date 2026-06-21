'use client';
import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { deckApi } from '@/lib/api';
import type { DeckRun } from '@/lib/types';
import {
  Activity, AlertCircle, CheckCircle2, ChevronRight, Clock, Search, Wrench, Bot, Filter, Hash, Globe,
} from 'lucide-react';
import { Page, Card, Kbd, Kicker, SectionHead, Tag, Chip, type Tone } from '@/components/Brand';
import { useActiveProfile } from '@/lib/profile-context';
import { sourceMeta, sourceTone, shortTitle, relTime, useNowTick } from '@/lib/format';
import { useT } from '@/lib/i18n';

function fmtDuration(ms?: number): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3600_000)}h ${Math.floor((ms % 3600_000) / 60_000)}m`;
}

function statusTone(status: DeckRun['status']): Tone {
  if (status === 'success') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'running') return 'accent';
  return 'default';
}

export default function RunsPage() {
  return (
    <Suspense fallback={null}>
      <RunsPageInner />
    </Suspense>
  );
}

function RunsPageInner() {
  const t = useT({
    zh: {
      introA: '每一次「用户提问 → 助手回复」都会记录为一次运行，数据来自 Hermes 的 ',
      introB: '：状态、耗时、工具调用与错误摘要全部直接读自消息日志。点击行可查看完整时间线。',
      kickerRuns: '运行 · 最近 80 条',
      kickerSuccess: '成功',
      kickerFailed: '失败',
      kickerRunning: '进行中',
      subAcross: '跨所有 Agent',
      subClickInspect: '点击行可查看详情',
      subNoneInWindow: '当前窗口无失败',
      subRunningHint: '尚未收到回复的用户消息',
      loadFailed: '加载失败：',
      searchPlaceholder: '搜索提问、回复、工具名…',
      ariaSearch: '搜索运行',
      ariaScope: '运行范围',
      chipAll: '全部',
      chipSuccess: '成功',
      chipFailed: '失败',
      chipRunning: '进行中',
      scopeActive: '当前 Agent',
      scopeAll: '全部 Agent',
      subForProfile: (id: string) => `仅当前 Agent · ${id}`,
      noMatch: '未匹配到任何运行',
      noRunsYet: '还没有任何 agent 轮次记录。发送一条聊天消息即可创建第一次运行。',
      adjustFilters: '调整筛选条件或清空搜索。',
      untitled: '未命名运行',
      tools: '个工具',
    },
    en: {
      introA: 'Every user prompt → assistant reply is one run. Derived from Hermes’ ',
      introB: ': status, duration, tool calls and error summary all read straight from the message log. Click a row for the full timeline.',
      kickerRuns: 'RUNS · RECENT 80',
      kickerSuccess: 'SUCCESS',
      kickerFailed: 'FAILED',
      kickerRunning: 'RUNNING',
      subAcross: 'across every Agent',
      subClickInspect: 'click row to inspect',
      subNoneInWindow: 'none in window',
      subRunningHint: 'user message with no reply yet',
      loadFailed: 'Load failed:',
      searchPlaceholder: 'Search prompt, reply, tool name…',
      ariaSearch: 'Search runs',
      ariaScope: 'Run scope',
      chipAll: 'All',
      chipSuccess: 'Success',
      chipFailed: 'Failed',
      chipRunning: 'Running',
      scopeActive: 'Active Agent',
      scopeAll: 'All Agents',
      subForProfile: (id: string) => `active Agent only · ${id}`,
      noMatch: 'No runs match',
      noRunsYet: 'No agent turns recorded yet. Send a chat message to create your first run.',
      adjustFilters: 'Adjust filters or clear the search.',
      untitled: 'untitled run',
      tools: 'tool(s)',
    },
  });

  const { activeProfile, hydrated } = useActiveProfile();
  const searchParams = useSearchParams();
  const [runs, setRuns] = useState<DeckRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DeckRun['status']>('all');
  // Keep "5m ago" labels live — this page fetches once and has no other ticker.
  useNowTick();
  // Honour ?status=… so the command palette's "Filter failed runs" action and
  // any bookmarked filter link actually take effect (applies on soft-nav too).
  useEffect(() => {
    const s = searchParams.get('status');
    if (s === 'success' || s === 'failed' || s === 'running' || s === 'cancelled') {
      setStatusFilter(s);
    }
  }, [searchParams]);
  /** 'active' = scope to the active profile (server-side filter via ?profile=);
   *  'all' = global view across every profile. We push the toggle through the
   *  API so getRuns runs per-profile sqlite reads instead of fanning out. */
  const [scope, setScope] = useState<'active' | 'all'>('active');

  useEffect(() => {
    if (!hydrated) return;
    const ac = new AbortController();
    setLoading(true);
    setErr('');
    deckApi.runs(scope === 'active' ? activeProfile : undefined, ac.signal)
      .then((r) => { if (!ac.signal.aborted) setRuns(r.runs || []); })
      .catch((e) => {
        if (ac.signal.aborted) return;
        if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) return;
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => { ac.abort(); };
  }, [hydrated, scope, activeProfile]);

  const counts = useMemo(() => {
    const total = runs.length;
    const success = runs.filter((r) => r.status === 'success').length;
    const failed = runs.filter((r) => r.status === 'failed').length;
    const running = runs.filter((r) => r.status === 'running').length;
    return { total, success, failed, running };
  }, [runs]);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return runs.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!needle) return true;
      const hay = `${r.sessionTitle || ''} ${r.promptPreview || ''} ${r.replyPreview || ''} ${r.toolNames.join(' ')}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [runs, q, statusFilter]);

  return (
    <Page intro={
      <>
        {t.introA}<Kbd>state.db</Kbd>{t.introB}
      </>
    }>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
        <Stat
          kicker={t.kickerRuns}
          value={loading ? '—' : counts.total}
          sub={scope === 'all' ? t.subAcross : t.subForProfile(activeProfile)}
        />
        <Stat kicker={t.kickerSuccess} value={loading ? '—' : counts.success} sub={counts.total ? `${Math.round((counts.success / counts.total) * 100)}%` : '—'} />
        <Stat kicker={t.kickerFailed} value={loading ? '—' : counts.failed} sub={counts.failed ? t.subClickInspect : t.subNoneInWindow} />
        <Stat kicker={t.kickerRunning} value={loading ? '—' : counts.running} sub={t.subRunningHint} />
      </div>

      {err && (
        <Card style={{ borderColor: 'var(--status-red-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--red)' }}>
            <AlertCircle size={15} /> {t.loadFailed} {err}
          </div>
        </Card>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 36,
          padding: '0 12px',
          background: 'var(--bg-soft)',
          border: '1px solid var(--line)',
          borderRadius: 8,
        }}
      >
        <Search size={14} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.searchPlaceholder}
          aria-label={t.ariaSearch}
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 13 }}
        />
        <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>{filtered.length} / {counts.total}</span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Chip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} icon={<Filter size={11} />}>{t.chipAll}</Chip>
        <Chip active={statusFilter === 'success'} onClick={() => setStatusFilter('success')} icon={<CheckCircle2 size={11} />}>{t.chipSuccess}</Chip>
        <Chip active={statusFilter === 'failed'} onClick={() => setStatusFilter('failed')} icon={<AlertCircle size={11} />}>{t.chipFailed}</Chip>
        <Chip active={statusFilter === 'running'} onClick={() => setStatusFilter('running')} icon={<Activity size={11} />}>{t.chipRunning}</Chip>
        <span style={{ flex: 1 }} />
        <span role="group" aria-label={t.ariaScope} style={{ display: 'inline-flex', gap: 6 }}>
          <Chip active={scope === 'active'} onClick={() => setScope('active')} icon={<Bot size={11} />}>{t.scopeActive}</Chip>
          <Chip active={scope === 'all'} onClick={() => setScope('all')} icon={<Globe size={11} />}>{t.scopeAll}</Chip>
        </span>
      </div>

      {loading ? (
        <Card padding={6}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 14px', borderTop: i === 0 ? 'none' : '1px solid var(--hairline)' }}>
              <div className="skel" style={{ width: 64, height: 18 }} />
              <div style={{ flex: 1 }}>
                <div className="skel" style={{ width: '70%', height: 14 }} />
                <div style={{ height: 6 }} />
                <div className="skel" style={{ width: '40%', height: 11 }} />
              </div>
            </div>
          ))}
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: 32 }}>
          <Activity size={20} style={{ color: 'var(--muted)' }} />
          <div style={{ fontSize: 13, marginTop: 8 }}>{t.noMatch}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 2 }}>
            {runs.length === 0 ? t.noRunsYet : t.adjustFilters}
          </div>
        </Card>
      ) : (
        <Card padding={0}>
          {filtered.map((r, i) => <RunRow key={r.id} run={r} first={i === 0} />)}
        </Card>
      )}
    </Page>
  );
}

function RunRow({ run, first }: { run: DeckRun; first?: boolean }) {
  const t = useT({
    zh: { untitled: '未命名运行', tools: '次工具调用' },
    en: { untitled: 'untitled run', tools: 'tool(s)' },
  });
  const meta = sourceMeta(run.source);
  return (
    <Link
      href={`/runs/${encodeURIComponent(run.id)}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr auto',
        gap: 16,
        alignItems: 'center',
        padding: '14px 16px',
        borderTop: first ? 'none' : '1px solid var(--hairline)',
        textDecoration: 'none',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <Tag variant={statusTone(run.status)}>{run.status}</Tag>
        <span style={{ fontSize: 10.5, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)' }}>
          {fmtDuration(run.durationMs)}
        </span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 550, color: 'var(--strong-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {run.promptPreview || shortTitle(run.sessionTitle, 60) || t.untitled}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <Tag variant={sourceTone(meta.tone)}>{meta.short}</Tag>
          <span style={{ fontFamily: 'var(--font-mono)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Bot size={10} /> {run.profileId}
          </span>
          {run.model && (
            <span style={{ fontFamily: 'var(--font-mono)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Hash size={10} /> {run.model}
            </span>
          )}
          {run.toolCallCount > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Wrench size={10} /> {run.toolCallCount} {t.tools}
            </span>
          )}
          {run.toolNames.length > 0 && (
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, maxWidth: 320 }}>
              {run.toolNames.slice(0, 4).join(' · ')}
              {run.toolNames.length > 4 && ` · +${run.toolNames.length - 4}`}
            </span>
          )}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Clock size={10} /> {relTime(run.startedAt)}
          </span>
        </div>
        {run.errorSummary && (
          <div style={{ marginTop: 6, padding: '6px 8px', background: 'var(--status-red-bg)', border: '1px solid var(--status-red-border)', borderRadius: 6, fontSize: 11.5, color: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={11} /> {run.errorSummary}
          </div>
        )}
      </div>
      <ChevronRight size={14} style={{ color: 'var(--muted-2)' }} />
    </Link>
  );
}

function Stat({ kicker, value, sub }: { kicker: string; value: React.ReactNode; sub?: string }) {
  return (
    <Card padding={14}>
      <Kicker>{kicker}</Kicker>
      <div style={{ fontSize: 22, fontWeight: 650, color: 'var(--strong-text)', fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{sub}</div>}
    </Card>
  );
}
