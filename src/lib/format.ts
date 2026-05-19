// Format helpers shared by chat / sessions / runs UIs.
import { useEffect, useState } from 'react';
import { getLang } from './i18n';
import type { Tone } from '@/components/Brand';

// Loose tone keyed off the source kind. We deliberately stay near `Tone`
// (the Brand primitive's color palette) so callers can pass the result
// straight to `<Tag variant={...}>`.
export type SourceTone = Tone | 'web' | 'amber' | 'gray';

export type SourceMeta = {
  key: string;
  label: string;
  short: string;
  tone: SourceTone;
};

type SourceLabels = { label: string; short: string };
const SOURCE_TONE: Record<string, SourceTone> = {
  hermesdeck: 'web', webui: 'web',
  chat: 'gray',
  api_server: 'cyan', api: 'cyan', telegram: 'cyan', discord: 'cyan',
  whatsapp: 'green', imessage: 'green',
  slack: 'amber',
  cron: 'amber', schedule: 'amber', scheduled: 'amber', job: 'amber',
  hermes: 'gray',
};

/** Map a source's loose tone onto a `Tone` Brand primitives can render. */
export function sourceTone(tone: SourceTone): Tone {
  switch (tone) {
    case 'web': return 'accent';
    case 'amber': return 'yellow';
    case 'gray': return 'default';
    case 'green': return 'green';
    case 'cyan': return 'cyan';
    case 'accent': return 'accent';
    case 'red': return 'red';
    case 'yellow': return 'yellow';
    case 'default': return 'default';
    default: return 'default';
  }
}
const SOURCE_LABELS_EN: Record<string, SourceLabels> = {
  hermesdeck: { label: 'HermesDeck Web',  short: 'Web' },
  webui:      { label: 'WebUI',           short: 'WebUI' },
  chat:       { label: 'CLI Chat',        short: 'CLI' },
  api_server: { label: 'API Server',      short: 'API' },
  api:        { label: 'API',             short: 'API' },
  telegram:   { label: 'Telegram',        short: 'TG' },
  discord:    { label: 'Discord',         short: 'DC' },
  whatsapp:   { label: 'WhatsApp',        short: 'WA' },
  imessage:   { label: 'iMessage',        short: 'iMsg' },
  slack:      { label: 'Slack',           short: 'Slack' },
  cron:       { label: 'Scheduled task',  short: 'Cron' },
  schedule:   { label: 'Scheduled task',  short: 'Sched' },
  scheduled:  { label: 'Scheduled task',  short: 'Sched' },
  job:        { label: 'Background job',  short: 'Job' },
  hermes:     { label: 'Hermes',          short: 'Hermes' },
};
const SOURCE_LABELS_ZH: Record<string, SourceLabels> = {
  hermesdeck: { label: 'HermesDeck 网页', short: '网页' },
  webui:      { label: '网页界面',         short: '网页' },
  chat:       { label: '命令行对话',       short: 'CLI' },
  api_server: { label: 'API 服务器',       short: 'API' },
  api:        { label: 'API',             short: 'API' },
  telegram:   { label: 'Telegram',        short: 'TG' },
  discord:    { label: 'Discord',         short: 'DC' },
  whatsapp:   { label: 'WhatsApp',        short: 'WA' },
  imessage:   { label: 'iMessage',        short: 'iMsg' },
  slack:      { label: 'Slack',           short: 'Slack' },
  cron:       { label: '定时任务',         short: '定时' },
  schedule:   { label: '定时任务',         short: '定时' },
  scheduled:  { label: '定时任务',         short: '定时' },
  job:        { label: '后台任务',         short: '任务' },
  hermes:     { label: 'Hermes',          short: 'Hermes' },
};

export function sourceMeta(source?: string): SourceMeta {
  const key = (source || 'hermes').toLowerCase();
  const labels = (getLang() === 'zh' ? SOURCE_LABELS_ZH : SOURCE_LABELS_EN)[key];
  const tone = SOURCE_TONE[key] || 'gray';
  if (labels) return { key, label: labels.label, short: labels.short, tone };
  return { key, label: source || 'Hermes', short: source?.slice(0, 6) || 'Hermes', tone };
}

export function shortTitle(title?: string, max = 36): string {
  const t = (title || '').replace(/\s+/g, ' ').trim();
  if (!t) return getLang() === 'zh' ? '新会话' : 'New chat';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/**
 * Force the calling component to re-render every `intervalMs` so `relTime()`
 * labels don't freeze at their first-paint value on pages that otherwise never
 * re-render (Runs, Profiles, Tools — single fetch, no polling).
 */
export function useNowTick(intervalMs = 60_000): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => (n + 1) % 1_000_000), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

export function relTime(value?: string | number): string {
  if (!value) return '';
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  const diff = Date.now() - ms;
  const zh = getLang() === 'zh';
  if (diff < 0) return zh ? '刚刚' : 'just now';
  const min = Math.floor(diff / 60000);
  if (min < 1) return zh ? '刚刚' : 'just now';
  if (min < 60) return zh ? `${min} 分钟前` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return zh ? `${hr} 小时前` : `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return zh ? `${day} 天前` : `${day}d ago`;
  const d = new Date(ms);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
