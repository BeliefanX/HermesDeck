import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { register as registerLoader } from 'node:module';
import { NextRequest } from 'next/server.js';

registerLoader('./route-loader.mjs', import.meta.url);

let mode = 'ok';
const seen = [];
const dashboard = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  seen.push(url.searchParams.get('profile'));
  if (mode === 'all401' || mode === 'all500' || (mode === 'partial' && url.pathname !== '/api/model/info')) {
    res.writeHead(mode === 'all500' ? 500 : 401, { 'content-type': 'application/json' });
    res.end('{}');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(url.pathname === '/api/model/info' ? JSON.stringify({ model: 'test' }) : '{}');
});
await new Promise((done) => dashboard.listen(0, '127.0.0.1', done));
test.after(() => new Promise((done) => dashboard.close(done)));

const authModuleUrl = pathToFileURL(resolve('src/lib/server/auth.ts')).href;
const routeModuleUrl = pathToFileURL(resolve('src/app/api/deck/model-config/route.ts')).href;
let nonce = 0;

function configureHome(home) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
  process.env.HERMESDECK_DATA_DIR = join(home, '.hermesdeck');
  process.env.HERMESDECK_PUBLIC_ORIGIN = 'https://deck.example.test';
  process.env.HERMES_DASHBOARD_BASE = `http://127.0.0.1:${dashboard.address().port}`;
}

function request(profile, token) {
  const headers = token ? { cookie: `hermesdeck_session=${encodeURIComponent(token)}` } : undefined;
  return new NextRequest(`https://deck.example.test/api/deck/model-config?profile=${encodeURIComponent(profile)}`, { headers });
}

test('model-config route enforces RBAC, normalizes profiles, and reports all Dashboard failures', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hermesdeck-model-config-'));
  configureHome(home);
  const auth = await import(`${authModuleUrl}?case=${nonce++}`);
  const store = await auth.ensureAuthInitialized();
  const superAdmin = Object.values(store.users)[0];
  const now = new Date().toISOString();
  const user = {
    id: 'ordinary-user', username: 'ordinary-user', role: 'user', status: 'active',
    ...auth.createPasswordRecord('ordinary-password-123'), assignedProfileIds: ['default'], preferences: { profiles: {} },
    createdAt: now, updatedAt: now, approvedAt: now, approvedBy: superAdmin.id,
  };
  mkdirSync(join(home, '.hermesdeck'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.hermesdeck', 'auth.json'), JSON.stringify({ ...store, users: { ...store.users, [user.id]: user } }), { mode: 0o600 });
  const token = auth.issueSessionToken(user.id);
  const route = await import(`${routeModuleUrl}?case=${nonce++}`);

  assert.equal((await route.GET(request('default'))).status, 401);
  assert.equal((await route.GET(request('other', token))).status, 403);
  assert.equal((await route.GET(request('../other', token))).status, 400);

  seen.length = 0;
  mode = 'ok';
  assert.equal((await route.GET(request(' default ', token))).status, 200);
  assert.deepEqual(seen, ['default', 'default', 'default', 'default']);

  mode = 'partial';
  const partial = await route.GET(request('default', token));
  assert.equal(partial.status, 200);
  assert.match((await partial.json()).errors.auxiliary, /HTTP 401/);

  mode = 'all401';
  assert.equal((await route.GET(request('default', token))).status, 502);
  mode = 'all500';
  assert.equal((await route.GET(request('default', token))).status, 502);
});
