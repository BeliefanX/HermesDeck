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
  cron:        { key: 'cron',        label: '定时任务',         short: '定时',     tone: 'amber' },
  schedule:    { key: 'schedule',    label: '计划任务',         short: '计划',     tone: 'amber' },
  scheduled:   { key: 'scheduled',   label: '计划任务',         short: '计划',     tone: 'amber' },
  job:         { key: 'job',         label: '后台任务',         short: 'Job',      tone: 'amber' },
  hermes:      { key: 'hermes',      label: 'Hermes',          short: 'Hermes',   tone: 'gray' },
};

export function sourceMeta(source?: string): SourceMeta {
  const key = (source || 'hermes').toLowerCase();
  return SOURCE_TABLE[key] || { key, label: source || 'Hermes', short: source?.slice(0, 6) || 'Hermes', tone: 'gray' };
}

export function shortTitle(title?: string, max = 36): string {
  const t = (title || '').replace(/\s+/g, ' ').trim();
  if (!t) return '新对话';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export function relTime(value?: string | number): string {
  if (!value) return '';
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return '刚刚';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day} 天前`;
  const d = new Date(ms);
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
