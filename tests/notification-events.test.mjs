import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cronCompletionBaseline,
  detectCronCompletionNotifications,
  notificationAllowed,
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
  assert.equal(notificationAllowed({ chatCompleted: true, chatFailed: true, cronJobCompleted: false }, 'cronJobCompleted'), false);
  assert.equal(notificationAllowed({ chatCompleted: true, chatFailed: true, cronJobCompleted: true }, 'cronJobCompleted'), true);
});
