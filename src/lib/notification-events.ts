import type { DeckCronJob, DeckNotificationPreferences } from './types';

export type PageNotification = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function compact(value: string | undefined, max = 96): string | undefined {
  const clean = value?.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function normalizedStatus(value: unknown): string | undefined {
  return text(value)?.toLowerCase().replace(/[\s_-]+/g, '_');
}

function isDoneStatus(value: unknown): boolean {
  const status = normalizedStatus(value);
  return Boolean(status && ['done', 'completed', 'complete', 'success', 'succeeded', 'ok'].includes(status));
}

export function notificationAllowed(preferences: DeckNotificationPreferences | null | undefined, key: keyof DeckNotificationPreferences): boolean {
  return Boolean(preferences && preferences[key] !== false);
}

function cronStatusKey(job: DeckCronJob): string {
  return [job.lastStatus, job.state, job.status]
    .map((value) => normalizedStatus(value))
    .find(Boolean) || '';
}

function cronRunKey(job: DeckCronJob): string {
  return [job.lastRunAt, job.lastStatus, job.state, job.status]
    .map((value) => text(value) || '')
    .join('|');
}

export type CronJobBaseline = Map<string, string>;

export function cronCompletionBaseline(jobs: readonly DeckCronJob[]): CronJobBaseline {
  return new Map(jobs.map((job) => [job.id, cronRunKey(job)]));
}

export function detectCronCompletionNotifications(previous: CronJobBaseline, jobs: readonly DeckCronJob[], profileId = 'default'): PageNotification[] {
  const out: PageNotification[] = [];
  for (const job of jobs) {
    const priorKey = previous.get(job.id);
    if (!priorKey) continue;
    const currentKey = cronRunKey(job);
    if (currentKey === priorKey) continue;
    if (!isDoneStatus(cronStatusKey(job))) continue;
    const name = compact(job.name || job.id, 96) || job.id;
    const params = new URLSearchParams({ profile: profileId, job: job.id });
    out.push({
      title: 'Scheduled job complete',
      body: `${name} finished successfully.`,
      url: `/cron?${params.toString()}`,
      tag: `cron:${profileId}:${job.id}:${job.lastRunAt || currentKey}`,
    });
  }
  return out;
}

export function showPageNotification(notification: PageNotification): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification(notification.title, {
      body: notification.body,
      tag: notification.tag,
      data: { url: notification.url },
    });
    n.onclick = () => {
      window.focus();
      window.location.assign(notification.url);
      n.close();
    };
  } catch {}
}
