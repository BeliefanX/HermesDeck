import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const authModuleUrl = pathToFileURL(resolve('src/lib/server/auth.ts')).href;
const csrfModuleUrl = pathToFileURL(resolve('src/lib/server/csrf.ts')).href;
let nonce = 0;
const sharedHome = mkdtempSync(join(tmpdir(), 'hermesdeck-csrf-auth-'));

function makeHome() {
  return sharedHome;
}

async function loadAuth(home) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
  const tag = `${Date.now()}-${nonce++}`;
  return import(`${authModuleUrl}?case=${tag}`);
}

async function loadCsrf(home) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
  const tag = `${Date.now()}-${nonce++}`;
  return import(`${csrfModuleUrl}?case=${tag}`);
}

function authFile(home) {
  return join(home, '.hermesdeck', 'auth.json');
}

function writeStore(home, store) {
  mkdirSync(join(home, '.hermesdeck'), { recursive: true, mode: 0o700 });
  writeFileSync(authFile(home), JSON.stringify(store, null, 2), { mode: 0o600 });
}

async function makeRequest({ home, userStatus = 'active', origin = 'https://deck.example.test', body = '{}', contentType = 'application/json', contentLength } = {}) {
  const activeHome = home || makeHome();
  const auth = await loadAuth(activeHome);
  const store = auth.readAuth();
  const superAdmin = Object.values(store.users)[0];
  const now = new Date().toISOString();
  const user = {
    id: 'csrf_user',
    username: 'csrf-user',
    role: 'user',
    status: 'active',
    ...auth.createPasswordRecord('csrf-password-123'),
    assignedProfileIds: ['default'],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: superAdmin.id,
  };
  writeStore(activeHome, { ...store, users: { ...store.users, [user.id]: user } });
  const token = auth.issueSessionToken(user.id);
  if (userStatus !== 'active') {
    const issuedStore = auth.readAuth();
    writeStore(activeHome, { ...issuedStore, users: { ...issuedStore.users, [user.id]: { ...user, status: userStatus } } });
  }
  const csrf = await loadCsrf(activeHome);
  const headers = new Headers({
    cookie: `hermesdeck_session=${encodeURIComponent(token)}`,
    'content-type': contentType,
  });
  if (origin !== undefined && origin !== null) headers.set('origin', origin);
  if (contentLength !== undefined) headers.set('content-length', String(contentLength));
  const req = new Request('https://deck.example.test/api/deck/test', { method: 'POST', headers, body });
  return { req, csrf, auth, token };
}

async function responseJson(response) {
  return response.json();
}

test('guardMutating rejects missing and cross-origin mutating requests before body parsing', async () => {
  const home = makeHome();
  process.env.HERMESDECK_PUBLIC_ORIGIN = 'https://deck.example.test';
  const missing = await makeRequest({ home, origin: null });
  const missingGuard = missing.csrf.guardMutating(missing.req);
  assert.equal(missingGuard.ok, false);
  assert.equal(missingGuard.response.status, 403);
  assert.equal((await responseJson(missingGuard.response)).error, 'Cross-origin request rejected.');

  const cross = await makeRequest({ home, origin: 'https://evil.example.test' });
  const crossGuard = cross.csrf.guardMutating(cross.req);
  assert.equal(crossGuard.ok, false);
  assert.equal(crossGuard.response.status, 403);
});

test('guardMutating allows configured public origin for authenticated active users', async () => {
  const home = makeHome();
  process.env.HERMESDECK_PUBLIC_ORIGIN = 'https://deck.example.test,https://mobile.example.test';
  const { req, csrf } = await makeRequest({ home, origin: 'https://mobile.example.test' });
  const guard = csrf.guardMutating(req);
  assert.deepEqual(guard, { ok: true });
});

test('production CSRF allows private IPv4 literal origins but rejects arbitrary and invalid origins', async (t) => {
  const home = makeHome();
  const oldNodeEnv = process.env.NODE_ENV;
  const oldPublicOrigin = process.env.HERMESDECK_PUBLIC_ORIGIN;
  t.after(() => {
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
    if (oldPublicOrigin === undefined) delete process.env.HERMESDECK_PUBLIC_ORIGIN;
    else process.env.HERMESDECK_PUBLIC_ORIGIN = oldPublicOrigin;
  });

  process.env.NODE_ENV = 'production';
  delete process.env.HERMESDECK_PUBLIC_ORIGIN;

  for (const origin of [
    'http://10.10.10.253:6117',
    'http://10.10.10.253:6118',
    'http://192.168.1.20:6117',
    'http://172.16.0.5:6117',
    'http://172.31.255.254:6117',
    'http://169.254.12.34:6117',
  ]) {
    const { req, csrf } = await makeRequest({ home, origin });
    assert.deepEqual(csrf.guardMutating(req), { ok: true }, origin);
  }

  for (const origin of [
    'http://evil.example.test',
    'http://8.8.8.8:6117',
    'http://172.32.0.1:6117',
    'http://192.169.1.20:6117',
    'http://10.10.10.999:6117',
    'http://10.10.10.253.evil.example:6117',
  ]) {
    const { req, csrf } = await makeRequest({ home, origin });
    const guard = csrf.guardMutating(req);
    assert.equal(guard.ok, false, origin);
    assert.equal(guard.response.status, 403, origin);
    assert.equal((await responseJson(guard.response)).error, 'Cross-origin request rejected.', origin);
  }
});

test('auth boundary distinguishes unauthenticated and inactive sessions', async () => {
  const home = makeHome();
  process.env.HERMESDECK_PUBLIC_ORIGIN = 'https://deck.example.test';
  const csrf = await loadCsrf(home);
  const unauth = csrf.guardMutating(new Request('https://deck.example.test/api/deck/test', {
    method: 'POST',
    headers: { origin: 'https://deck.example.test', 'content-type': 'application/json' },
    body: '{}',
  }));
  assert.equal(unauth.ok, false);
  assert.equal(unauth.response.status, 401);
  assert.equal((await responseJson(unauth.response)).error, 'Not authenticated.');

  const inactive = await makeRequest({ home, userStatus: 'disabled', origin: 'https://deck.example.test' });
  const inactiveGuard = inactive.csrf.guardMutating(inactive.req);
  assert.equal(inactiveGuard.ok, false);
  assert.equal(inactiveGuard.response.status, 403);
  assert.equal((await responseJson(inactiveGuard.response)).error, 'inactive_user');
});

test('request-body helpers reject oversized, malformed, and non-object JSON bodies', async () => {
  const home = makeHome();
  const oversized = await makeRequest({ home, body: '{}', contentLength: 17 });
  const bodyGuard = oversized.csrf.guardRequestBody(oversized.req, { contentTypes: ['application/json'], maxBytes: 16 });
  assert.equal(bodyGuard.ok, false);
  assert.equal(bodyGuard.response.status, 413);

  const malformed = await makeRequest({ home, body: '{not-json}' });
  const parsed = await malformed.csrf.readLimitedJsonObject(malformed.req, 16_000);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.status, 400);
  assert.equal((await responseJson(parsed.response)).error, 'Invalid JSON.');

  const arrayBody = await makeRequest({ home, body: '[]' });
  const objectOnly = await arrayBody.csrf.readLimitedJsonObject(arrayBody.req, 16_000);
  assert.equal(objectOnly.ok, false);
  assert.equal(objectOnly.response.status, 400);
  assert.equal((await responseJson(objectOnly.response)).error, 'JSON body must be an object.');
});
