import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = pathToFileURL(resolve('src/lib/server/notifications.ts')).href;
let nonce = 0;

async function loadNotifications() {
  const home = mkdtempSync(join(tmpdir(), 'hermesdeck-notifications-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
  return import(`${moduleUrl}?case=${Date.now()}-${nonce++}`);
}

const keys = {
  p256dh: 'B'.repeat(88),
  auth: 'A'.repeat(22),
};

function input(endpoint) {
  return { endpoint, keys };
}

test('push endpoint validation only allows known browser push services', async () => {
  const notifications = await loadNotifications();

  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/token',
    'https://fcmregistrations.googleapis.com/v1/projects/example/registrations/token',
    'https://updates.push.services.mozilla.com/wpush/v2/token',
    'https://push.services.mozilla.com/wpush/v2/token',
    'https://web.push.apple.com/Q/token',
    'https://wns2.notify.windows.com/w/?token=abc',
  ]) {
    assert.equal(notifications.isSupportedPushEndpoint(endpoint), true, endpoint);
  }

  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/token',
    'https://example.com/push/token',
    'https://localhost/push/token',
    'https://127.0.0.1/push/token',
    'https://10.0.0.5/push/token',
    'https://169.254.1.5/push/token',
    'https://service.internal/push/token',
    'https://printer.local/push/token',
  ]) {
    assert.equal(notifications.isSupportedPushEndpoint(endpoint), false, endpoint);
  }
});

test('saving push subscriptions rejects arbitrary HTTPS endpoints and returns non-reversible public ids', async () => {
  const notifications = await loadNotifications();
  const endpoint = 'https://fcm.googleapis.com/fcm/send/really-secret-endpoint-token';

  const rejected = notifications.savePushSubscription('user_1', input('https://example.com/push/really-secret-token'), 'Test UA');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'invalid_subscription');

  const saved = notifications.savePushSubscription('user_1', input(endpoint), 'Test UA');
  assert.equal(saved.ok, true);
  assert.equal(saved.subscriptionCount, 1);
  assert.match(saved.subscription.id, /^sub_[A-Za-z0-9_-]{32}$/);
  assert.equal(saved.subscription.id.includes('really-secret-endpoint-token'), false);
  assert.equal(saved.subscription.endpoint, undefined);
  assert.equal(saved.subscription.keys, undefined);

  const cfg = notifications.getNotificationConfigForUser('user_1');
  assert.equal(cfg.subscriptions.length, 1);
  assert.equal(cfg.subscriptions[0].id, saved.subscription.id);
  assert.equal(cfg.subscriptions[0].id.includes('really-secret-endpoint-token'), false);
  assert.equal(cfg.subscriptions[0].endpoint, undefined);
  assert.equal(cfg.subscriptions[0].keys, undefined);
});

test('notification store mutations use a lock and atomic rename', () => {
  const source = readFileSync(resolve('src/lib/server/notifications.ts'), 'utf8');
  assert.match(source, /const LOCK_PATH = `\$\{STORE_PATH\}\.lock`/);
  assert.match(source, /function mutateStore/);
  assert.match(source, /openSync\(LOCK_PATH, 'wx'/);
  assert.match(source, /renameSync\(tmp, STORE_PATH\)/);
  assert.match(source, /notification store lock waited/);
});

test('notification store lock preserves concurrent child-process mutations', async () => {
  const notifications = await loadNotifications();
  const authDir = process.env.HERMESDECK_AUTH_DIR;
  assert.ok(authDir);

  const child = (idx) => new Promise((resolveChild, rejectChild) => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/concurrent-${idx}`;
    const code = `
      import { savePushSubscription, saveUserNotificationPreferences } from './src/lib/server/notifications.ts';
      savePushSubscription('user_1', { endpoint: ${JSON.stringify(endpoint)}, keys: { p256dh: 'B'.repeat(88), auth: 'A'.repeat(22) } }, 'child-${idx}');
      saveUserNotificationPreferences('user_1', { chatFailed: ${idx % 2 === 0 ? 'false' : 'true'} });
    `;
    const proc = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HERMESDECK_AUTH_DIR: authDir,
        HOME: process.env.HOME || '',
        USERPROFILE: process.env.USERPROFILE || '',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', rejectChild);
    proc.on('close', (code) => (code === 0 ? resolveChild() : rejectChild(new Error(stderr || `child exited ${code}`))));
  });

  await Promise.all([0, 1, 2, 3].map(child));
  const cfg = notifications.getNotificationConfigForUser('user_1');
  assert.equal(cfg.subscriptionCount, 4);
});
