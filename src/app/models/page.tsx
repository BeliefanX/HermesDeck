'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Bot, Braces, CalendarClock, Cpu } from 'lucide-react';
import { Card, Kicker, Page, SectionHead, Tag } from '@/components/Brand';
import { deckApi } from '@/lib/api';
import type { DeckModelConfig } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { useActiveProfile } from '@/lib/profile-context';

const dash = '—';
const value = (input?: string | number) => input === undefined || input === '' ? dash : String(input);

export default function ModelsPage() {
  const t = useT({
    zh: {
      intro: '只读显示 Hermes Dashboard 为当前 Agent 解析的模型配置；不会发送 Dashboard cookie、token 或通用配置到浏览器。',
      unavailable: 'Dashboard 不可用', partial: '部分可用', loading: '加载模型配置…', main: '主模型', delegation: '委派', auxiliary: '辅助任务', cron: '定时任务覆盖',
      model: '模型', provider: 'Provider', context: '上下文', effective: '生效', configured: '配置', auto: '自动', capabilities: '能力', none: '未配置', task: '任务', snapshot: '快照',
    },
    en: {
      intro: 'Read-only resolved model configuration from the Hermes Dashboard for the active Agent. Dashboard cookies, tokens, and general config never reach the browser.',
      unavailable: 'Dashboard unavailable', partial: 'Partial', loading: 'Loading model configuration…', main: 'Main model', delegation: 'Delegation', auxiliary: 'Auxiliary tasks', cron: 'Cron overrides',
      model: 'Model', provider: 'Provider', context: 'Context', effective: 'effective', configured: 'configured', auto: 'auto', capabilities: 'Capabilities', none: 'Not configured', task: 'Task', snapshot: 'Snapshot',
    },
  });
  const { activeProfile, hydrated } = useActiveProfile();
  const [data, setData] = useState<DeckModelConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hydrated) return;
    const ac = new AbortController();
    setLoading(true);
    setData(null);
    deckApi.modelConfig(activeProfile, ac.signal)
      .then((result) => { if (!ac.signal.aborted) setData(result); })
      .catch(() => { if (!ac.signal.aborted) setData({ profileId: activeProfile, available: false, main: { capabilities: {} }, auxiliary: [], cron: [], errors: { info: t.unavailable } }); })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [activeProfile, hydrated, t.unavailable]);

  const errors = Object.values(data?.errors || {});
  return <Page intro={t.intro}>
    {loading && <Card>{t.loading}</Card>}
    {errors.length > 0 && <Card style={{ borderColor: 'var(--status-red-border)', color: 'var(--red)' }}><AlertCircle size={15} /> {errors.join(' · ')}</Card>}
    <Card>
      <SectionHead kicker={activeProfile} title={<><Bot size={16} /> {t.main}</>} right={errors.length ? <Tag variant="yellow">{t.partial}</Tag> : data?.available ? <Tag variant="green">Dashboard</Tag> : <Tag variant="red">{t.unavailable}</Tag>} />
      <Grid>
        <Meta label={t.model} content={value(data?.main.model)} />
        <Meta label={t.provider} content={value(data?.main.provider)} />
        <Meta label={`${t.context} · ${t.effective}`} content={value(data?.main.effectiveContextLength)} />
        <Meta label={`${t.context} · ${t.configured} / ${t.auto}`} content={`${value(data?.main.configContextLength)} / ${value(data?.main.autoContextLength)}`} />
      </Grid>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
        {Object.entries(data?.main.capabilities || {}).filter(([, capability]) => capability !== undefined).map(([name, capability]) => <Tag key={name} variant={capability === false ? 'default' : 'accent'}>{name.replace(/([A-Z])/g, ' $1')}: {String(capability)}</Tag>)}
      </div>
    </Card>
    <ConfigCard icon={<Braces size={16} />} title={t.delegation} data={data?.delegation} empty={t.none} labels={t} />
    <Card>
      <SectionHead kicker="Dashboard" title={<><Cpu size={16} /> {t.auxiliary}</>} />
      {data?.auxiliary.length ? data.auxiliary.map((task, index) => <Row key={task.task} first={index === 0} title={task.task} values={[task.provider, task.model, task.baseUrl]} />) : <Empty>{t.none}</Empty>}
    </Card>
    <Card>
      <SectionHead kicker="Dashboard" title={<><CalendarClock size={16} /> {t.cron}</>} />
      {data?.cron.length ? data.cron.map((job, index) => <Row key={job.id} first={index === 0} title={job.name || job.id} subtitle={job.name ? job.id : undefined} values={[job.provider, job.model, job.baseUrl, [job.providerSnapshot, job.modelSnapshot].filter(Boolean).join(' / ') || undefined]} />) : <Empty>{t.none}</Empty>}
    </Card>
  </Page>;
}

function Grid({ children }: { children: React.ReactNode }) { return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>{children}</div>; }
function Meta({ label, content }: { label: string; content: string }) { return <div><Kicker>{label}</Kicker><div style={{ marginTop: 5, fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--value-text)', overflowWrap: 'anywhere' }}>{content}</div></div>; }
function Empty({ children }: { children: React.ReactNode }) { return <div style={{ color: 'var(--muted)', fontSize: 12.5 }}>{children}</div>; }
function ConfigCard({ icon, title, data, empty, labels }: { icon: React.ReactNode; title: string; data?: DeckModelConfig['delegation']; empty: string; labels: Record<string, string> }) {
  return <Card><SectionHead kicker="Dashboard /api/config" title={<>{icon} {title}</>} />{data ? <Grid><Meta label={labels.provider} content={value(data.provider)} /><Meta label={labels.model} content={value(data.model)} /><Meta label="Base URL" content={value(data.baseUrl)} /><Meta label="Reasoning" content={value(data.reasoningEffort)} /></Grid> : <Empty>{empty}</Empty>}</Card>;
}
function Row({ first, title, subtitle, values }: { first: boolean; title: string; subtitle?: string; values: Array<string | undefined> }) {
  return <div style={{ padding: '12px 0', borderTop: first ? 'none' : '1px solid var(--hairline)' }}><strong style={{ fontSize: 13 }}>{title}</strong>{subtitle && <span style={{ marginLeft: 8, color: 'var(--muted-2)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{subtitle}</span>}<div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>{values.filter(Boolean).map((item) => <Tag key={item}>{item}</Tag>)}</div></div>;
}
