// Format helpers shared by chat / sessions / runs UIs.

export type SourceMeta = {
  key: string;
  label: string;
  short: string;
  tone: 'web' | 'green' | 'amber' | 'cyan' | 'pink' | 'gray';
};

const SOURCE_TABLE: Record<string, SourceMeta> = {
  hermesdeck:  { key: 'hermesdeck',  label: 'HermesDeck Web',  short: 'Web',      tone: 'web' },
  webui:       { key: 'webui',       label: 'WebUI',           short: 'WebUI',    tone: 'web' },
  chat:        { key: 'chat',        label: 'CLI Chat',        short: 'CLI',      tone: 'gray' },
  api_server:  { key: 'api_server',  label: 'API Server',      short: 'API',      tone: 'cyan' },
  api:         { key: 'api',         label: 'API',             short: 'API',      tone: 'cyan' },
  telegram:    { key: 'telegram',    label: 'Telegram',        short: 'TG',       tone: 'cyan' },
  discord:     { key: 'discord',     label: 'Discord',         short: 'DC',       tone: 'cyan' },
  whatsapp:    { key: 'whatsapp',    label: 'WhatsApp',        short: 'WA',       tone: 'green' },
  imessage:    { key: 'imessage',    label: 'iMessage',        short: 'iMsg',     tone: 'green' },
  slack:       { key: 'slack',       label: 'Slack',           short: 'Slack',    tone: 'amber' },
  cron:        { key: 'cron',        label: 'Scheduled task',   short: 'Cron',     tone: 'amber' },
  schedule:    { key: 'schedule',    label: 'Scheduled task',   short: 'Sched',    tone: 'amber' },
  scheduled:   { key: 'scheduled',   label: 'Scheduled task',   short: 'Sched',    tone: 'amber' },
  job:         { key: 'job',         label: 'Background job',   short: 'Job',      tone: 'amber' },
  hermes:      { key: 'hermes',      label: 'Hermes',          short: 'Hermes',   tone: 'gray' },
};

export function sourceMeta(source?: string): SourceMeta {
  const key = (source || 'hermes').toLowerCase();
  return SOURCE_TABLE[key] || { key, label: source || 'Hermes', short: source?.slice(0, 6) || 'Hermes', tone: 'gray' };
}

export function shortTitle(title?: string, max = 36): string {
  const t = (title || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'New chat';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export function relTime(value?: string | number): string {
  if (!value) return '';
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const d = new Date(ms);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
