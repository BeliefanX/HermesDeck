import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cronCompletionBaseline,
  detectCronCompletionNotifications,
  notificationAllowed,
  parseKanbanCompletionNotification,
} from '../src/lib/notification-events.ts';

function job(overrides) {
  return {
    id: 'job_a',
    status: 'enabled',
    enabled: true,
    schedule: '* * * * *',
    skills: [],
    toolsets: [],
    ...overrides,
  };
}

test('kanban parser ignores events without explicit completion/status transition', () => {
  assert.equal(parseKanbanCompletionNotification({ type: 'event', kind: 'comment', payload: { taskId: 't_1', title: 'Secret detail' } }), null);
  assert.equal(parseKanbanCompletionNotification({ type: 'event', kind: 'status_change', payload: { taskId: 't_1', from: 'todo', to: 'running' } }), null);
});

test('kanban parser accepts explicit completion and only exposes concise task title/id', () => {
  const notification = parseKanbanCompletionNotification({
    type: 'event',
    id: 4,
    kind: 'task_completed',
    payload: { taskId: 't_123', title: 'Ship notifications', body: 'Do not leak this body' },
  }, 'ops');
  assert.deepEqual(notification, {
    title: 'Kanban task complete',
    body: 'Task Ship notifications is done.',
    url: '/kanban?board=ops&task=t_123',
    tag: 'kanban:ops:t_123:complete',
  });
});

test('kanban parser accepts conservative status transition to done', () => {
  const notification = parseKanbanCompletionNotification({
    type: 'event',
    kind: 'status_change',
    payload: { task_id: 't_done', from: 'running', to: 'done' },
  });
  assert.equal(notification?.tag, 'kanban:default:t_done:complete');
});

test('cron diff captures baseline without first-load notifications', () => {
  const baseline = cronCompletionBaseline([job({ lastStatus: 'succeeded', lastRunAt: '2026-06-25T00:00:00Z' })]);
  assert.deepEqual(detectCronCompletionNotifications(baseline, [job({ lastStatus: 'succeeded', lastRunAt: '2026-06-25T00:00:00Z' })]), []);
});

test('cron diff notifies only after transition/run-key change into a successful terminal state', () => {
  const baseline = cronCompletionBaseline([job({ name: 'Nightly cleanup', lastStatus: 'running', lastRunAt: '2026-06-25T00:00:00Z' })]);
  const notifications = detectCronCompletionNotifications(baseline, [job({ name: 'Nightly cleanup', lastStatus: 'succeeded', lastRunAt: '2026-06-25T00:02:00Z' })], 'default');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, 'Scheduled job complete');
  assert.equal(notifications[0].body, 'Nightly cleanup finished successfully.');
  assert.equal(notifications[0].url, '/cron?profile=default&job=job_a');
});

test('notificationAllowed requires loaded preferences and honors disabled channels', () => {
  assert.equal(notificationAllowed(null, 'cronJobCompleted'), false);
  assert.equal(notificationAllowed({ chatCompleted: true, chatFailed: true, kanbanTaskCompleted: true, cronJobCompleted: false }, 'cronJobCompleted'), false);
  assert.equal(notificationAllowed({ chatCompleted: true, chatFailed: true, kanbanTaskCompleted: true, cronJobCompleted: true }, 'cronJobCompleted'), true);
});
