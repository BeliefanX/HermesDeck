'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CalendarClock, Clock, PlayCircle, Search, Send, Wrench } from 'lucide-react';
import { deckApi } from '@/lib/api';
import type { DeckCronJob, DeckNotificationPreferences } from '@/lib/types';
import { Page, Card, Chip, Kicker, Tag, type Tone } from '@/components/Brand';
import { relTime, shortTitle, useNowTick } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useActiveProfile } from '@/lib/profile-context';
import { cronCompletionBaseline, detectCronCompletionNotifications, notificationAllowed, showPageNotification, type CronJobBaseline } from '@/lib/notification-events';

const CRON_POLL_MS = 30_000;

function statusTone(status: DeckCronJob['status']): Tone {
  if (status === 'enabled') return 'green';
  if (status === 'paused') return 'yellow';
  if (status === 'disabled') return 'red';
  return 'accent';
}

function statusLabel(status: DeckCronJob['status'], zh: boolean): string {
  const labels = zh
    ? { enabled: '已启用', paused: '已暂停', disabled: '已禁用', running: '运行中' }
    : { enabled: 'enabled', paused: 'paused', disabled: 'disabled', running: 'running' };
  return labels[status];
}

function compact(value?: string, max = 160): string {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '—';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export default function ScheduledTasksPage() {
  const t = useT({
    zh: {
      intro: '查看 Hermes Agent API 暴露的定时任务。这里只做只读展示；创建、暂停、编辑等操作仍通过 Hermes cron 工具完成。',
      title: '定时任务', all: '全部', enabled: '启用', paused: '暂停', disabled: '禁用', running: '运行中',
      search: '搜索名称、ID、schedule、prompt、技能、工具集…', loadFailed: '加载失败：',
      empty: '暂无定时任务', emptyHint: '上游 /api/jobs 返回空列表。可在对话里使用 cronjob 工具创建任务。',
      noMatch: '没有匹配的定时任务', adjust: '调整搜索或状态筛选。',
      statsAll: '任务总数', statsNext: '即将运行', statsErr: '最近错误', statsDeliver: '投递目标',
      schedule: 'Schedule', next: '下次', last: '上次', target: '目标', prompt: 'Prompt / 脚本摘要', skills: '技能', toolsets: '工具集',
      noSkills: '未指定技能', noToolsets: '默认工具集', model: '模型', workdir: '工作目录', lastStatus: '上次状态',
    },
    en: {
      intro: 'Read-only view of scheduled tasks exposed by Hermes Agent API. Create, pause and edit still happen through Hermes cron tooling.',
      title: 'Scheduled Tasks', all: 'All', enabled: 'Enabled', paused: 'Paused', disabled: 'Disabled', running: 'Running',
      search: 'Search name, ID, schedule, prompt, skills, toolsets…', loadFailed: 'Load failed:',
      empty: 'No scheduled tasks', emptyHint: 'Upstream /api/jobs returned an empty list. Create one with the cronjob tool in chat.',
      noMatch: 'No matching scheduled tasks', adjust: 'Adjust search or status filters.',
      statsAll: 'Total jobs', statsNext: 'Next due', statsErr: 'Recent errors', statsDeliver: 'Delivery targets',
      schedule: 'Schedule', next: 'Next', last: 'Last', target: 'Target', prompt: 'Prompt / script summary', skills: 'Skills', toolsets: 'Toolsets',
      noSkills: 'No skills pinned', noToolsets: 'Default toolsets', model: 'Model', workdir: 'Workdir', lastStatus: 'Last status',
    },
  });
  const zh = t.title === '定时任务';
  const { activeProfile, hydrated } = useActiveProfile();
  const [jobs, setJobs] = useState<DeckCronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | DeckCronJob['status']>('all');
  const baselineRef = useRef<CronJobBaseline | null>(null);
  const notificationPreferencesRef = useRef<DeckNotificationPreferences | null>(null);
  useNowTick();

  useEffect(() => {
    let cancelled = false;
    deckApi.notificationConfig()
      .then((state) => { if (!cancelled) notificationPreferencesRef.current = state.preferences; })
      .catch(() => { if (!cancelled) notificationPreferencesRef.current = null; });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    baselineRef.current = null;
  }, [activeProfile]);

  const loadJobs = useCallback((signal?: AbortSignal, showLoading = false) => {
    if (showLoading) setLoading(true);
    setErr('');
    return deckApi.cronJobs(activeProfile, signal)
      .then((res) => {
        const nextJobs = res.jobs || [];
        if (signal?.aborted) return;
        const previous = baselineRef.current;
        if (previous && notificationAllowed(notificationPreferencesRef.current, 'cronJobCompleted')) {
          detectCronCompletionNotifications(previous, nextJobs, activeProfile).forEach(showPageNotification);
        }
        baselineRef.current = cronCompletionBaseline(nextJobs);
        setJobs(nextJobs);
      })
      .catch((e) => {
        if (signal?.aborted) return;
        if (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) return;
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (!signal?.aborted && showLoading) setLoading(false); });
  }, [activeProfile]);

  useEffect(() => {
    if (!hydrated) return;
    const ac = new AbortController();
    void loadJobs(ac.signal, true);
    return () => ac.abort();
  }, [hydrated, loadJobs]);

  useEffect(() => {
    if (!hydrated) return;
    const timer = setInterval(() => {
      const ac = new AbortController();
      void loadJobs(ac.signal, false);
    }, CRON_POLL_MS);
    return () => clearInterval(timer);
  }, [hydrated, loadJobs]);

  const counts = useMemo(() => ({
    total: jobs.length,
    enabled: jobs.filter((j) => j.status === 'enabled').length,
    paused: jobs.filter((j) => j.status === 'paused').length,
    disabled: jobs.filter((j) => j.status === 'disabled').length,
    errors: jobs.filter((j) => j.lastError || j.lastDeliveryError || j.lastStatus === 'failed').length,
    targets: new Set(jobs.map((j) => j.deliver || 'local')).size,
  }), [jobs]);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return jobs.filter((j) => {
      if (filter !== 'all' && j.status !== filter) return false;
      if (!needle) return true;
      return `${j.id} ${j.name || ''} ${j.schedule} ${j.promptPreview || ''} ${j.deliver || ''} ${j.skills.join(' ')} ${j.toolsets.join(' ')}`.toLowerCase().includes(needle);
    });
  }, [jobs, q, filter]);

  return (
    <Page intro={t.intro}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
        <Stat kicker={t.statsAll} value={loading ? '—' : counts.total} sub={`${counts.enabled} ${t.enabled} · ${counts.paused} ${t.paused}`} />
        <Stat kicker={t.statsNext} value={loading ? '—' : (jobs.find((j) => j.nextRunAt)?.nextRunAt ? relTime(jobs.find((j) => j.nextRunAt)?.nextRunAt) || '—' : '—')} sub={jobs.find((j) => j.nextRunAt)?.name || jobs.find((j) => j.nextRunAt)?.id || '—'} />
        <Stat kicker={t.statsErr} value={loading ? '—' : counts.errors} sub={counts.errors ? t.lastStatus : '—'} />
        <Stat kicker={t.statsDeliver} value={loading ? '—' : counts.targets} sub={[...new Set(jobs.map((j) => j.deliver || 'local'))].slice(0, 3).join(' · ') || '—'} />
      </div>

      {err && <Card style={{ borderColor: 'var(--status-red-border)', color: 'var(--red)' }}><AlertCircle size={15} /> {t.loadFailed} {err}</Card>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px', background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 8 }}>
        <Search size={14} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} aria-label={t.search} style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 13 }} />
        <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>{filtered.length} / {counts.total}</span>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Chip active={filter === 'all'} onClick={() => setFilter('all')} icon={<CalendarClock size={11} />}>{t.all}</Chip>
        <Chip active={filter === 'enabled'} onClick={() => setFilter('enabled')} icon={<PlayCircle size={11} />}>{t.enabled}</Chip>
        <Chip active={filter === 'paused'} onClick={() => setFilter('paused')} icon={<Clock size={11} />}>{t.paused}</Chip>
        <Chip active={filter === 'disabled'} onClick={() => setFilter('disabled')} icon={<AlertCircle size={11} />}>{t.disabled}</Chip>
      </div>

      {loading ? (
        <Card padding={6}>{Array.from({ length: 5 }).map((_, i) => <div key={i} style={{ padding: 14, borderTop: i ? '1px solid var(--hairline)' : 'none' }}><div className="skel" style={{ width: '68%', height: 14 }} /><div style={{ height: 8 }} /><div className="skel" style={{ width: '42%', height: 11 }} /></div>)}</Card>
      ) : filtered.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: 32 }}>
          <CalendarClock size={22} style={{ color: 'var(--muted)' }} />
          <div style={{ fontSize: 13, marginTop: 8 }}>{jobs.length === 0 ? t.empty : t.noMatch}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 2 }}>{jobs.length === 0 ? t.emptyHint : t.adjust}</div>
        </Card>
      ) : (
        <Card padding={0}>{filtered.map((job, i) => <JobRow key={job.id} job={job} first={i === 0} zh={zh} labels={t} />)}</Card>
      )}
    </Page>
  );
}

function Stat({ kicker, value, sub }: { kicker: string; value: string | number; sub: string }) {
  return <Card><Kicker>{kicker}</Kicker><div style={{ fontSize: 24, marginTop: 8, color: 'var(--value-text)', fontFamily: 'var(--font-mono)' }}>{value}</div><div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 4 }}>{sub}</div></Card>;
}

function JobRow({ job, first, zh, labels }: { job: DeckCronJob; first: boolean; zh: boolean; labels: Record<string, string> }) {
  const skills = job.skills.length ? job.skills : job.skill ? [job.skill] : [];
  const target = job.deliver || (job.noAgent ? 'local' : 'origin/local');
  const summary = job.noAgent ? job.script : job.promptPreview || job.script;
  return (
    <div style={{ padding: '16px', borderTop: first ? 'none' : '1px solid var(--hairline)', display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>{shortTitle(job.name || job.id, 64)}</strong>
            <Tag variant={statusTone(job.status)}>{statusLabel(job.status, zh)}</Tag>
            {job.lastStatus ? <Tag variant={job.lastStatus === 'failed' ? 'red' : 'default'}>{labels.lastStatus}: {job.lastStatus}</Tag> : null}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted-2)', marginTop: 4 }}>{job.id}</div>
        </div>
        <Tag variant="cyan" icon={<Send size={11} />}>{target}</Tag>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        <Meta label={labels.schedule} value={job.schedule} />
        <Meta label={labels.next} value={job.nextRunAt ? `${job.nextRunAt} · ${relTime(job.nextRunAt)}` : '—'} />
        <Meta label={labels.last} value={job.lastRunAt ? `${job.lastRunAt} · ${relTime(job.lastRunAt)}` : '—'} />
        <Meta label={labels.target} value={target} />
      </div>

      <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.55 }}><Kicker>{labels.prompt}</Kicker>{compact(summary)}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Tag variant="accent">{labels.skills}: {skills.length ? skills.join(', ') : labels.noSkills}</Tag>
        <Tag variant="default" icon={<Wrench size={11} />}>{labels.toolsets}: {job.toolsets.length ? job.toolsets.join(', ') : labels.noToolsets}</Tag>
        {(job.provider || job.model) ? <Tag variant="default">{labels.model}: {[job.provider, job.model].filter(Boolean).join('/')}</Tag> : null}
        {job.workdir ? <Tag variant="default">{labels.workdir}: {job.workdir}</Tag> : null}
      </div>
      {(job.lastError || job.lastDeliveryError) ? <div style={{ color: 'var(--red)', fontSize: 12 }}>{compact(job.lastError || job.lastDeliveryError, 220)}</div> : null}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div style={{ minWidth: 0 }}><Kicker>{label}</Kicker><div style={{ marginTop: 4, fontSize: 12.5, color: 'var(--value-text)', overflowWrap: 'anywhere' }}>{value}</div></div>;
}
