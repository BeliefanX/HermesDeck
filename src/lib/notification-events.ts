import type { DeckCronJob, DeckNotificationPreferences } from './types';

export type PageNotification = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

const DONE_STATUSES = new Set(['done', 'completed', 'complete', 'success', 'succeeded', 'ok']);

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const found = text(value);
    if (found) return found;
  }
  return undefined;
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
  return Boolean(status && DONE_STATUSES.has(status));
}

function isExplicitKanbanCompleteKind(kind: string | undefined): boolean {
  if (!kind) return false;
  return [
    'task_completed',
    'task.complete',
    'task.completed',
    'kanban_task_completed',
    'complete',
    'completed',
  ].includes(kind.toLowerCase());
}

export function notificationAllowed(preferences: DeckNotificationPreferences | null | undefined, key: keyof DeckNotificationPreferences): boolean {
  return Boolean(preferences && preferences[key] !== false);
}

export function parseKanbanCompletionNotification(eventPayload: unknown, board = 'default'): PageNotification | null {
  const envelope = obj(eventPayload);
  const row = envelope.type === 'event' ? envelope : obj(envelope.event || envelope.payload || envelope);
  const payload = obj(row.payload);
  const kind = firstText(row.kind, payload.kind, payload.type, row.type);
  const previousStatus = firstText(row.previous_status, row.previousStatus, row.from_status, row.fromStatus, payload.previous_status, payload.previousStatus, payload.from, payload.oldStatus);
  const nextStatus = firstText(row.status, row.new_status, row.newStatus, row.to_status, row.toStatus, payload.status, payload.new_status, payload.newStatus, payload.to, payload.newStatus);
  const explicitCompletion = isExplicitKanbanCompleteKind(kind);
  const statusTransitionToDone = isDoneStatus(nextStatus) && !isDoneStatus(previousStatus);
  if (!explicitCompletion && !statusTransitionToDone) return null;

  const taskId = firstText(row.task_id, row.taskId, row.id, payload.task_id, payload.taskId, payload.id);
  if (!taskId) return null;
  const taskTitle = compact(firstText(row.title, row.task_title, row.taskTitle, payload.title, payload.task_title, payload.taskTitle));
  const params = new URLSearchParams({ board, task: taskId });
  return {
    title: 'Kanban task complete',
    body: taskTitle ? `Task ${taskTitle} is done.` : `Task ${taskId} is done.`,
    url: `/kanban?${params.toString()}`,
    tag: `kanban:${board}:${taskId}:complete`,
  };
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
