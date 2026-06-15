import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, scryptSync } from 'node:crypto';

const authModuleUrl = pathToFileURL(resolve('src/lib/server/auth.ts')).href;
const rbacModuleUrl = pathToFileURL(resolve('src/lib/server/rbac.ts')).href;
const sessionAuthModuleUrl = pathToFileURL(resolve('src/lib/server/session-auth.ts')).href;
const tokenRoutePath = resolve('src/app/api/deck/tokens/route.ts');
const statsRoutePath = resolve('src/app/api/deck/stats/route.ts');
const modelPreferencesRoutePath = resolve('src/app/api/deck/model-preferences/route.ts');
const chatStreamRoutePath = resolve('src/app/api/deck/chat/stream/route.ts');
const chatResumeRoutePath = resolve('src/app/api/deck/chat/resume/route.ts');
const chatStreamModulePath = resolve('src/lib/server/hermes/chat-stream.ts');
const streamHubModulePath = resolve('src/lib/server/hermes/stream-hub.ts');
const lcmRoutePath = resolve('src/app/api/deck/lcm/route.ts');
const cacheImageRoutePath = resolve('src/app/api/deck/cache-image/route.ts');
const serviceWorkerPath = resolve('public/sw.js');
const useChatModelsPath = resolve('src/app/chat/_hooks/useChatModels.ts');
const modelsModulePath = resolve('src/lib/server/hermes/models.ts');
const clientApiPath = resolve('src/lib/api.ts');
const proxyPath = resolve('src/proxy.ts');
const csrfPath = resolve('src/lib/server/csrf.ts');
const profilesModulePath = resolve('src/lib/server/hermes/profiles.ts');
const hermesCoreModulePath = resolve('src/lib/server/hermes/core.ts');
const hermesSessionsModulePath = resolve('src/lib/server/hermes/sessions.ts');
const hermesMessagesModulePath = resolve('src/lib/server/hermes/messages.ts');
const deckChatProjectionModulePath = resolve('src/lib/server/deck-chat-projection.ts');
const cronRoutePath = resolve('src/app/api/deck/cron/route.ts');
const hermesCronModulePath = resolve('src/lib/server/hermes/cron.ts');
let importNonce = 0;

function makeHome() {
  return mkdtempSync(join(tmpdir(), 'hermesdeck-rbac-auth-'));
}

async function loadAuth(home) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
  return import(`${authModuleUrl}?case=${Date.now()}-${importNonce++}`);
}

async function loadRbac(home) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
  return import(`${rbacModuleUrl}?case=${Date.now()}-${importNonce++}`);
}

async function loadSessionAuth(home) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
  return import(`${sessionAuthModuleUrl}?case=${Date.now()}-${importNonce++}`);
}

function authDir(home) {
  return join(home, '.hermesdeck');
}

function authFile(home) {
  return join(authDir(home), 'auth.json');
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64, { N: 1 << 15, maxmem: 64 * 1024 * 1024 }).toString('hex');
}

function writeV1Auth(home, overrides = {}) {
  mkdirSync(authDir(home), { recursive: true, mode: 0o700 });
  const salt = overrides.passwordSalt ?? randomBytes(16).toString('hex');
  const password = overrides.password ?? 'legacy-password-123';
  const record = {
    version: 1,
    username: 'legacy-admin',
    passwordSalt: salt,
    passwordHash: hashPassword(password, salt),
    sessionSecret: randomBytes(32).toString('hex'),
    passwordVersion: 7,
    bootstrap: true,
    ...overrides,
  };
  delete record.password;
  writeFileSync(authFile(home), JSON.stringify(record, null, 2), { mode: 0o600 });
  return { record, password };
}

function writeStore(home, store) {
  writeFileSync(authFile(home), JSON.stringify(store, null, 2), { mode: 0o600 });
}

function withSuppressedBootstrapLog(fn) {
  const originalLog = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = originalLog;
  }
}

test('fresh bootstrap creates a v2 store with exactly one active super_admin and restrictive permissions', async () => {
  const home = makeHome();
  const auth = await loadAuth(home);
  const logs = [];
  const originalLog = console.log;
  console.log = (message = '') => logs.push(String(message));
  try {
    const store = await auth.ensureAuthInitialized();
    assert.equal(store.version, 2);
    assert.equal(store.registrationsOpen, true);
    assert.equal(Object.keys(store.users).length, 1);
    const [user] = Object.values(store.users);
    assert.equal(user.role, 'super_admin');
    assert.equal(user.status, 'active');
    assert.equal(user.username, 'admin');
    assert.equal(user.bootstrap, true);
    assert.deepEqual(user.assignedProfileIds, []);
    assert.deepEqual(user.preferences, { profiles: {} });
    assert.equal(statSync(authDir(home)).mode & 0o777, 0o700);
    assert.equal(statSync(authFile(home)).mode & 0o777, 0o600);
    assert.match(logs.join('\n'), /HermesDeck first-run bootstrap/);
    assert.match(logs.join('\n'), /Username: admin/);
    const rename = auth.updateUsername('root');
    assert.equal(rename.ok, false);
    assert.match(rename.error, /super_admin username cannot be changed/);
  } finally {
    console.log = originalLog;
  }
});

test('v1 migration preserves the single-user super_admin credentials, password version, bootstrap flag, and session secret', async () => {
  const home = makeHome();
  const { record, password } = writeV1Auth(home);
  const auth = await loadAuth(home);

  const store = auth.readAuth();
  assert.equal(store.version, 2);
  assert.equal(store.sessionSecret, record.sessionSecret);
  const users = Object.values(store.users);
  assert.equal(users.length, 1);
  const [user] = users;
  assert.equal(user.role, 'super_admin');
  assert.equal(user.status, 'active');
  assert.equal(user.username, record.username);
  assert.equal(user.passwordSalt, record.passwordSalt);
  assert.equal(user.passwordHash, record.passwordHash);
  assert.equal(user.passwordVersion, record.passwordVersion);
  assert.equal(user.bootstrap, true);
  assert.equal(existsSync(join(authDir(home), 'auth.json.v1.bak')), true);

  const login = auth.authenticateUser(record.username, password);
  assert.equal(login.ok, true);
  const token = auth.issueSessionToken(login.user.id);
  const session = auth.verifySessionToken(token);
  assert.equal(session.ok, true);
  assert.equal(session.user.id, login.user.id);
});

test('wrong passwords are rejected for migrated super_admin login', async () => {
  const home = makeHome();
  const { record } = writeV1Auth(home);
  const auth = await loadAuth(home);
  auth.readAuth();
  const login = auth.authenticateUser(record.username, 'not-the-password');
  assert.equal(login.ok, false);
});

test('disabled users cannot log in and existing sessions are rejected after disable', async () => {
  const home = makeHome();
  let auth = await loadAuth(home);
  let store = withSuppressedBootstrapLog(() => auth.readAuth());
  const password = 'disabled-password-123';
  const credentials = auth.createPasswordRecord(password);
  const disabledUser = {
    id: 'user_disabled_1',
    username: 'disabled-user',
    role: 'user',
    status: 'disabled',
    ...credentials,
    assignedProfileIds: ['default'],
    preferences: { profiles: {} },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    approvedAt: new Date().toISOString(),
    approvedBy: Object.values(store.users)[0].id,
    disabledAt: new Date().toISOString(),
    disabledBy: Object.values(store.users)[0].id,
  };
  store = { ...store, users: { ...store.users, [disabledUser.id]: disabledUser } };
  writeStore(home, store);

  auth = await loadAuth(home);
  assert.equal(auth.authenticateUser(disabledUser.username, password).ok, false);

  writeStore(home, {
    ...store,
    users: {
      ...store.users,
      [disabledUser.id]: { ...disabledUser, status: 'active', disabledAt: undefined, disabledBy: undefined },
    },
  });
  auth = await loadAuth(home);
  const activeLogin = auth.authenticateUser(disabledUser.username, password);
  assert.equal(activeLogin.ok, true);
  const token = auth.issueSessionToken(activeLogin.user.id);

  writeStore(home, store);
  auth = await loadAuth(home);
  assert.equal(auth.verifySessionToken(token).ok, false);
});

test('auth loading rejects malformed v1 files without silently bootstrapping a second admin', async () => {
  const home = makeHome();
  mkdirSync(authDir(home), { recursive: true, mode: 0o700 });
  writeFileSync(authFile(home), JSON.stringify({ version: 1, username: 'broken' }, null, 2), { mode: 0o600 });
  const auth = await loadAuth(home);
  assert.throws(() => auth.readAuth(), /malformed|invalid/i);
  const raw = JSON.parse(readFileSync(authFile(home), 'utf8'));
  assert.equal(raw.version, 1);
  assert.equal(raw.username, 'broken');
});

test('auth loading rejects malformed v1 credential material without migrating or bootstrapping over it', async () => {
  const cases = [
    {
      name: 'non-hex password hash',
      overrides: { passwordHash: 'g'.repeat(128) },
    },
    {
      name: 'wrong-length password hash',
      overrides: { passwordHash: 'a'.repeat(126) },
    },
    {
      name: 'wrong-length password salt',
      overrides: { passwordSalt: 'a'.repeat(30) },
    },
  ];

  for (const { name, overrides } of cases) {
    const home = makeHome();
    const { record } = writeV1Auth(home, overrides);
    const auth = await loadAuth(home);

    assert.throws(() => auth.readAuth(), /invalid password material/i, name);
    assert.equal(existsSync(join(authDir(home), 'auth.json.v1.bak')), false, name);

    const raw = JSON.parse(readFileSync(authFile(home), 'utf8'));
    assert.equal(raw.version, 1, name);
    assert.equal(raw.username, record.username, name);
    assert.equal(raw.passwordSalt, record.passwordSalt, name);
    assert.equal(raw.passwordHash, record.passwordHash, name);
  }
});

test('auth store invariants reject a second super_admin', async () => {
  const home = makeHome();
  let auth = await loadAuth(home);
  const store = withSuppressedBootstrapLog(() => auth.readAuth());
  const superAdmin = Object.values(store.users)[0];
  const credentials = auth.createPasswordRecord('other-password-123');
  writeStore(home, {
    ...store,
    users: {
      ...store.users,
      second_super_admin: {
        id: 'second_super_admin',
        username: 'second-admin',
        role: 'super_admin',
        status: 'active',
        ...credentials,
        assignedProfileIds: [],
        preferences: { profiles: {} },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        approvedAt: new Date().toISOString(),
        approvedBy: superAdmin.id,
      },
    },
  });

  auth = await loadAuth(home);
  assert.throws(() => auth.readAuth(), /exactly one active super_admin|super_admin/i);
});

test('open registration creates a pending ordinary user and returns only safe user fields', async () => {
  const home = makeHome();
  const auth = await loadAuth(home);
  withSuppressedBootstrapLog(() => auth.readAuth());

  const result = auth.registerPendingUser({
    username: '  New.User  ',
    password: 'new-password-123',
    displayName: ' New User ',
    email: 'USER@example.COM ',
  });

  assert.equal(result.ok, true);
  assert.equal(result.user.username, 'New.User');
  assert.equal(result.user.displayName, 'New User');
  assert.equal(result.user.email, 'user@example.com');
  assert.equal(result.user.role, 'user');
  assert.equal(result.user.status, 'pending');
  assert.deepEqual(result.user.assignedProfileIds, []);
  assert.deepEqual(result.user.capabilities.canUseApp, false);
  assert.equal('passwordHash' in result.user, false);
  assert.equal('passwordSalt' in result.user, false);

  const store = auth.readAuth();
  const persisted = Object.values(store.users).find((user) => user.username === 'New.User');
  assert.ok(persisted);
  assert.equal(persisted.role, 'user');
  assert.equal(persisted.status, 'pending');
  assert.equal(persisted.passwordHash.length, 128);
});

test('registration rejects duplicate usernames under canonical normalization', async () => {
  const home = makeHome();
  const auth = await loadAuth(home);
  withSuppressedBootstrapLog(() => auth.readAuth());

  const first = auth.registerPendingUser({ username: 'Case.User', password: 'case-password-123' });
  assert.equal(first.ok, true);

  const duplicate = auth.registerPendingUser({ username: ' case.user ', password: 'case-password-456' });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /already in use/i);
});

test('pending user credentials authenticate only as pending and cannot receive or validate a protected app session', async () => {
  const home = makeHome();
  const auth = await loadAuth(home);
  withSuppressedBootstrapLog(() => auth.readAuth());

  const password = 'pending-password-123';
  const registered = auth.registerPendingUser({ username: 'pending-user', password });
  assert.equal(registered.ok, true);

  assert.equal(auth.authenticateUser('pending-user', password).ok, false);
  const pendingLogin = auth.authenticateUser('pending-user', password, { allowStatuses: ['active', 'pending'] });
  assert.equal(pendingLogin.ok, true);
  assert.equal(pendingLogin.user.status, 'pending');
  assert.throws(() => auth.issueSessionToken(pendingLogin.user.id), /inactive|missing/i);

  const store = auth.readAuth();
  const pendingUser = store.users[pendingLogin.user.id];
  const activeStore = {
    ...store,
    users: {
      ...store.users,
      [pendingUser.id]: { ...pendingUser, status: 'active', approvedAt: new Date().toISOString(), approvedBy: 'super_admin' },
    },
  };
  writeStore(home, activeStore);
  const reloaded = await loadAuth(home);
  const activeLogin = reloaded.authenticateUser('pending-user', password);
  assert.equal(activeLogin.ok, true);
  const activeToken = reloaded.issueSessionToken(activeLogin.user.id);

  writeStore(home, store);
  const pendingAgain = await loadAuth(home);
  assert.equal(pendingAgain.verifySessionToken(activeToken).ok, false);
});

test('active admin login still issues a protected app session', async () => {
  const home = makeHome();
  let auth = await loadAuth(home);
  const store = withSuppressedBootstrapLog(() => auth.readAuth());
  const password = 'admin-password-123';
  const credentials = auth.createPasswordRecord(password);
  const admin = {
    id: 'admin_1',
    username: 'active-admin',
    role: 'admin',
    status: 'active',
    ...credentials,
    assignedProfileIds: [],
    preferences: { profiles: {} },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    approvedAt: new Date().toISOString(),
    approvedBy: Object.values(store.users)[0].id,
  };
  writeStore(home, { ...store, users: { ...store.users, [admin.id]: admin } });

  auth = await loadAuth(home);
  const login = auth.authenticateUser('active-admin', password);
  assert.equal(login.ok, true);
  assert.equal(login.user.role, 'admin');
  const token = auth.issueSessionToken(login.user.id);
  const session = auth.verifySessionToken(token);
  assert.equal(session.ok, true);
  assert.equal(session.user.username, 'active-admin');
});

test('server RBAC helpers enforce admin roles, active status, and profile assignments', async () => {
  const home = makeHome();
  const auth = await loadAuth(home);
  const store = withSuppressedBootstrapLog(() => auth.readAuth());
  const superAdmin = Object.values(store.users)[0];
  const now = new Date().toISOString();
  const ordinary = {
    id: 'user_rbac_ordinary',
    username: 'rbac-user',
    role: 'user',
    status: 'active',
    ...auth.createPasswordRecord('ordinary-password-123'),
    assignedProfileIds: ['default', 'agent-a'],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: superAdmin.id,
  };
  const admin = {
    id: 'admin_rbac',
    username: 'rbac-admin',
    role: 'admin',
    status: 'active',
    ...auth.createPasswordRecord('admin-password-123'),
    assignedProfileIds: [],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: superAdmin.id,
  };
  const pending = {
    id: 'user_rbac_pending',
    username: 'rbac-pending',
    role: 'user',
    status: 'active',
    ...auth.createPasswordRecord('pending-password-123'),
    assignedProfileIds: ['default'],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: superAdmin.id,
  };
  const disabled = {
    id: 'user_rbac_disabled',
    username: 'rbac-disabled',
    role: 'user',
    status: 'active',
    ...auth.createPasswordRecord('disabled-password-123'),
    assignedProfileIds: ['default'],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: superAdmin.id,
  };
  const rejected = {
    id: 'user_rbac_rejected',
    username: 'rbac-rejected',
    role: 'user',
    status: 'active',
    ...auth.createPasswordRecord('rejected-password-123'),
    assignedProfileIds: ['default'],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: superAdmin.id,
  };
  writeStore(home, {
    ...store,
    users: {
      ...store.users,
      [ordinary.id]: ordinary,
      [admin.id]: admin,
      [pending.id]: pending,
      [disabled.id]: disabled,
      [rejected.id]: rejected,
    },
  });

  const authWithUsers = await loadAuth(home);
  const ordinaryToken = authWithUsers.issueSessionToken(ordinary.id);
  const adminToken = authWithUsers.issueSessionToken(admin.id);
  const pendingToken = authWithUsers.issueSessionToken(pending.id);
  const disabledToken = authWithUsers.issueSessionToken(disabled.id);
  const rejectedToken = authWithUsers.issueSessionToken(rejected.id);
  const activeStore = authWithUsers.readAuth();
  writeStore(home, {
    ...activeStore,
    users: {
      ...activeStore.users,
      [pending.id]: { ...activeStore.users[pending.id], status: 'pending', approvedAt: undefined, approvedBy: undefined },
      [disabled.id]: { ...activeStore.users[disabled.id], status: 'disabled', disabledAt: now, disabledBy: superAdmin.id },
      [rejected.id]: { ...activeStore.users[rejected.id], status: 'rejected', rejectedAt: now, rejectedBy: superAdmin.id },
    },
  });

  const rbac = await loadRbac(home);
  const reqFor = (token) => new Request('http://hermesdeck.local/api/deck/test', {
    headers: { cookie: `hermesdeck_session=${encodeURIComponent(token)}` },
  });

  const ordinaryGuard = rbac.requireActiveUser(reqFor(ordinaryToken));
  assert.equal(ordinaryGuard.ok, true);
  assert.equal(ordinaryGuard.user.username, 'rbac-user');
  assert.deepEqual(
    rbac.filterProfilesForUser(ordinaryGuard.user, [{ id: 'default' }, { id: 'agent-a' }, { id: 'agent-b' }]),
    [{ id: 'default' }, { id: 'agent-a' }],
  );
  assert.equal(rbac.requireProfileAccess(ordinaryGuard.user, 'agent-a').ok, true);
  const deniedProfile = rbac.requireProfileAccess(ordinaryGuard.user, 'agent-b');
  assert.equal(deniedProfile.ok, false);
  assert.equal(deniedProfile.response.status, 403);

  const superAdminToken = authWithUsers.issueSessionToken(superAdmin.id);
  const superAdminGuard = rbac.requireActiveUser(reqFor(superAdminToken));
  assert.equal(superAdminGuard.ok, true);
  assert.deepEqual(
    rbac.filterProfilesForUser(superAdminGuard.user, [{ id: 'default' }, { id: 'agent-a' }, { id: 'agent-b' }]),
    [{ id: 'default' }, { id: 'agent-a' }, { id: 'agent-b' }],
  );
  assert.equal(rbac.requireProfileAccess(superAdminGuard.user, 'agent-b').ok, true);

  const adminGuard = rbac.requireActiveUser(reqFor(adminToken));
  assert.equal(adminGuard.ok, true);
  assert.deepEqual(
    rbac.filterProfilesForUser(adminGuard.user, [{ id: 'default' }, { id: 'agent-b' }]),
    [{ id: 'default' }, { id: 'agent-b' }],
  );
  assert.equal(rbac.requireProfileAccess(adminGuard.user, 'agent-b').ok, true);
  assert.equal(rbac.requireAdmin(reqFor(adminToken)).ok, true);

  const terminalDenied = rbac.requireAdmin(reqFor(ordinaryToken));
  assert.equal(terminalDenied.ok, false);
  assert.equal(terminalDenied.response.status, 403);

  const missingDenied = rbac.requireActiveUser(new Request('http://hermesdeck.local/api/deck/test'));
  assert.equal(missingDenied.ok, false);
  assert.equal(missingDenied.response.status, 401);

  const malformedDenied = rbac.requireActiveUser(reqFor('not-a-valid-token'));
  assert.equal(malformedDenied.ok, false);
  assert.equal(malformedDenied.response.status, 401);

  const malformedPercentCookieDenied = rbac.requireActiveUser(new Request('http://hermesdeck.local/api/deck/test', {
    headers: { cookie: 'hermesdeck_session=%E0%A4%A' },
  }));
  assert.equal(malformedPercentCookieDenied.ok, false);
  assert.equal(malformedPercentCookieDenied.response.status, 401);

  const pendingDenied = rbac.requireActiveUser(reqFor(pendingToken));
  assert.equal(pendingDenied.ok, false);
  assert.equal(pendingDenied.response.status, 403);

  const disabledDenied = rbac.requireActiveUser(reqFor(disabledToken));
  assert.equal(disabledDenied.ok, false);
  assert.equal(disabledDenied.response.status, 403);

  const rejectedDenied = rbac.requireActiveUser(reqFor(rejectedToken));
  assert.equal(rejectedDenied.ok, false);
  assert.equal(rejectedDenied.response.status, 403);

  const invalidSignatureToken = `${ordinaryToken.slice(0, -1)}${ordinaryToken.endsWith('a') ? 'b' : 'a'}`;
  const sessionAuth = await loadSessionAuth(home);
  assert.equal(sessionAuth.readSessionCookie(new Request('http://hermesdeck.local/api/deck/test', {
    headers: { cookie: 'hermesdeck_session=%E0%A4%A' },
  })), undefined);
  const activeSession = sessionAuth.inspectProtectedSessionToken(ordinaryToken);
  assert.equal(activeSession.ok, true);
  assert.equal(activeSession.user.username, 'rbac-user');
  assert.deepEqual(
    [undefined, 'not-a-valid-token', invalidSignatureToken].map((token) => sessionAuth.inspectProtectedSessionToken(token).reason),
    ['unauthenticated', 'unauthenticated', 'unauthenticated'],
  );
  for (const [token, status] of [[pendingToken, 'pending'], [disabledToken, 'disabled'], [rejectedToken, 'rejected']]) {
    const inactiveSession = sessionAuth.inspectProtectedSessionToken(token);
    assert.equal(inactiveSession.ok, false, status);
    assert.equal(inactiveSession.reason, 'inactive_user', status);
    assert.equal(inactiveSession.user.status, status);
  }

});

async function withMockedHermesFetch(responder, fn) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const href = String(url);
    calls.push(href);
    const body = await responder(new URL(href));
    return Response.json(body);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function loadHermesSessionsModule() {
  return import(`${pathToFileURL(hermesSessionsModulePath).href}?case=${Date.now()}-${importNonce++}`);
}

async function loadHermesMessagesModule() {
  return import(`${pathToFileURL(hermesMessagesModulePath).href}?case=${Date.now()}-${importNonce++}`);
}

test('profile-scoped Hermes sessions fail closed when upstream omits profile metadata', async () => {
  await withMockedHermesFetch(async () => ({ data: [{ id: 'legacy-default', title: 'Default legacy row' }] }), async () => {
    const sessions = await loadHermesSessionsModule();
    await assert.rejects(
      () => sessions.getSessions('sensgift'),
      (err) => err?.code === 'profile_routing_unavailable' && err?.status === 502,
    );
  });
});

test('profile-scoped Hermes sessions fail closed on mismatched upstream profile metadata', async () => {
  await withMockedHermesFetch(async () => ({ data: [{ id: 'default-owned', profile_id: 'default' }] }), async () => {
    const sessions = await loadHermesSessionsModule();
    await assert.rejects(
      () => sessions.getSessions('sensgift'),
      (err) => err?.code === 'session_profile_mismatch' && err?.status === 403,
    );
  });
});

test('profile-scoped Hermes sessions accept matching upstream profile metadata', async () => {
  await withMockedHermesFetch(async () => ({ data: [{ id: 'sensgift-owned', profile_id: 'sensgift', title: 'Sensgift' }] }), async () => {
    const sessions = await loadHermesSessionsModule();
    const rows = await sessions.getSessions('sensgift');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'sensgift-owned');
    assert.equal(rows[0].profileId, 'sensgift');
  });
});

test('message reads prove session profile ownership before fetching upstream messages', async () => {
  await withMockedHermesFetch(async (url) => {
    if (url.pathname === '/api/sessions') return { data: [{ id: 'default-owned', profile_id: 'default' }] };
    if (url.pathname.endsWith('/messages')) return { data: [{ id: 'leaked-message', role: 'user', content: 'should not be read' }] };
    return { data: [] };
  }, async (calls) => {
    const messages = await loadHermesMessagesModule();
    await assert.rejects(
      () => messages.getMessages('default-owned', 'sensgift'),
      (err) => err?.code === 'session_profile_mismatch' && err?.status === 403,
    );
    assert.equal(calls.some((href) => href.includes('/api/sessions/default-owned/messages')), false);
  });
});

test('named-profile API messages are fetched after session ownership is proven', async () => {
  await withMockedHermesFetch(async (url) => {
    if (url.pathname === '/api/sessions') {
      assert.equal(url.searchParams.get('profile'), 'sensgift');
      return { data: [{ id: 'sensgift-owned', profile_id: 'sensgift' }] };
    }
    if (url.pathname === '/api/sessions/sensgift-owned/messages') {
      assert.equal(url.searchParams.get('profile'), 'sensgift');
      assert.equal(url.searchParams.get('limit'), '5');
      return { data: [{ id: 'sensgift-message', role: 'assistant', content: 'sensgift history' }] };
    }
    return { data: [] };
  }, async (calls) => {
    const messages = await loadHermesMessagesModule();
    const rows = await messages.getMessages('sensgift-owned', 'sensgift', { limit: 5 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'sensgift-message');
    assert.equal(rows[0].content, 'sensgift history');
    assert.equal(calls.some((href) => href.includes('/api/sessions/sensgift-owned/messages')), true);
  });
});

test('default Hermes sessions still accept legacy upstream rows without profile metadata', async () => {
  await withMockedHermesFetch(async () => ({ data: [{ id: 'legacy-default', title: 'Default legacy row' }] }), async () => {
    const sessions = await loadHermesSessionsModule();
    const rows = await sessions.getSessions('default');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'legacy-default');
    assert.equal(rows[0].profileId, 'default');
  });
});

test('Deck chat projection is profile scoped and rejects cross-profile message reads', async () => {
  const home = makeHome();
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  try {
    delete process.env.HERMESDECK_DATA_DIR;
    process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
    const projection = await import(`${pathToFileURL(deckChatProjectionModulePath).href}?case=${Date.now()}-${importNonce++}`);
    projection.startProjectedTurn({
      sessionId: 'sensgift-local-1',
      profileId: 'sensgift',
      ownerUserId: 'kevinchen',
      ownerRole: 'user',
      message: 'hello sensgift',
    });
    projection.finalizeProjectedTurn({
      sessionId: 'sensgift-local-1',
      profileId: 'sensgift',
      content: 'sensgift answer',
      responseId: 'resp_sensgift_1',
    });

    assert.equal(projection.hasProjectedSession('sensgift-local-1', 'sensgift'), true);
    assert.equal(projection.projectedResponseIdMatches('sensgift-local-1', 'sensgift', 'resp_sensgift_1'), true);
    assert.equal(projection.projectedResponseIdMatches('sensgift-local-1', 'sensgift', 'resp_other_profile'), false);
    assert.equal(projection.hasProjectedSession('sensgift-local-1', 'default'), false);
    assert.deepEqual(projection.listProjectedSessions('default'), []);
    assert.equal(projection.listProjectedSessions('sensgift')[0].profileId, 'sensgift');
    assert.deepEqual(
      projection.getProjectedMessages('sensgift-local-1', 'sensgift').map((message) => message.role),
      ['user', 'assistant'],
    );
    assert.throws(
      () => projection.getProjectedMessages('sensgift-local-1', 'default'),
      (err) => err?.code === 'session_profile_mismatch' && err?.status === 403,
    );
  } finally {
    if (oldAuthDir === undefined) delete process.env.HERMESDECK_AUTH_DIR;
    else process.env.HERMESDECK_AUTH_DIR = oldAuthDir;
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
  }
});

test('Deck chat projection uses a lock, atomic writes and prunes stale sessions', async () => {
  const home = makeHome();
  const dataDir = join(home, '.hermesdeck');
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  try {
    mkdirSync(dataDir, { recursive: true });
    process.env.HERMESDECK_DATA_DIR = dataDir;
    delete process.env.HERMESDECK_AUTH_DIR;
    const stale = '2020-01-01T00:00:00.000Z';
    const sessions = {};
    for (let i = 0; i < 780; i += 1) {
      sessions[`old-${i}`] = {
        id: `old-${i}`,
        profileId: 'sensgift',
        title: `old ${i}`,
        source: 'hermesdeck',
        createdAt: stale,
        updatedAt: stale,
        messageCount: 0,
        status: 'completed',
        messages: [],
      };
    }
    sessions['failed-keep'] = {
      id: 'failed-keep',
      profileId: 'sensgift',
      title: 'failed keep',
      source: 'hermesdeck',
      createdAt: stale,
      updatedAt: stale,
      messageCount: 0,
      status: 'failed',
      messages: [],
    };
    writeFileSync(join(dataDir, 'chat-projection.v1.json'), JSON.stringify({ version: 1, sessions, aliases: { staleAlias: 'old-0' }, createdAt: stale, updatedAt: stale }));

    const projection = await import(`${pathToFileURL(deckChatProjectionModulePath).href}?case=${Date.now()}-${importNonce++}`);
    projection.startProjectedTurn({
      sessionId: 'new-running',
      profileId: 'sensgift',
      ownerUserId: 'kevinchen',
      ownerRole: 'user',
      message: 'fresh',
    });

    const stored = JSON.parse(readFileSync(join(dataDir, 'chat-projection.v1.json'), 'utf8'));
    assert.ok(Object.keys(stored.sessions).length <= 750);
    assert.ok(stored.sessions['failed-keep']);
    assert.ok(stored.sessions['new-running']);
    assert.equal(stored.aliases.staleAlias, undefined);
    const source = readFileSync(deckChatProjectionModulePath, 'utf8');
    assert.match(source, /LOCK_FILE/);
    assert.match(source, /openSync\(LOCK_FILE, 'wx'/);
    assert.match(source, /renameSync\(tmp, STORE_FILE\)/);
    assert.match(source, /MAX_STORED_SESSIONS/);
  } finally {
    if (oldAuthDir === undefined) delete process.env.HERMESDECK_AUTH_DIR;
    else process.env.HERMESDECK_AUTH_DIR = oldAuthDir;
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
  }
});

test('named-profile chat stream does not forward unproven client session ids upstream', () => {
  const routeSource = readFileSync(chatStreamRoutePath, 'utf8');
  const streamSource = readFileSync(chatStreamModulePath, 'utf8');

  assert.match(routeSource, /hasProjectedSession\(requestedSessionId, profileId\)/);
  assert.match(routeSource, /projectedResponseIdMatches\(requestedSessionId, profileId, previousResponseId\)/);
  assert.match(routeSource, /session_profile_unverified/);
  assert.match(routeSource, /response_profile_unverified/);
  assert.match(routeSource, /`deck_\$\{randomUUID\(\)\}`/);
  assert.match(routeSource, /__trustedSessionIdForProfile: trustedSessionIdForProfile/);
  assert.match(streamSource, /const canForwardClientSessionId = body\?\.__trustedSessionIdForProfile !== false/);
  assert.match(streamSource, /clientSessionId && canForwardClientSessionId && reqHeaders\.Authorization/);
  assert.match(streamSource, /sessionId: stream\.sessionId/);
  assert.match(streamSource, /getHermesApiBase\(profile\)/);
  assert.match(streamSource, /apiHeaders\(profile\)/);
  assert.match(streamSource, /refusing to route chat to the default profile API/);
  assert.match(streamSource, /hooks\?\.onError\?\.\(\{[\s\S]*error: 'profile_routing_unavailable'/);
  assert.doesNotMatch(streamSource, /HERMES_API_BASE/);
  assert.doesNotMatch(streamSource, /X-Hermes-Profile/);
});

test('Hermes chat API base selection is per profile and fails closed for unconfigured named profiles', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'coder'), { recursive: true });
  mkdirSync(join(hermesRoot, 'profiles', 'missing'), { recursive: true });
  mkdirSync(join(hermesRoot, 'profiles', 'disabled'), { recursive: true });
  writeFileSync(join(hermesRoot, '.env'), 'API_SERVER_HOST=0.0.0.0\nAPI_SERVER_PORT=18642\nAPI_SERVER_KEY=default-secret\n');
  writeFileSync(join(hermesRoot, 'profiles', 'coder', '.env'), 'API_SERVER_HOST=127.0.0.2\nAPI_SERVER_PORT=18643\nAPI_SERVER_KEY=coder-secret\n');
  writeFileSync(join(hermesRoot, 'profiles', 'disabled', '.env'), 'API_SERVER_ENABLED=false\nAPI_SERVER_PORT=18644\nAPI_SERVER_KEY=disabled-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const oldHermesApiKey = process.env.HERMES_API_KEY;
  const oldApiServerKey = process.env.API_SERVER_KEY;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.HERMES_HOME;
    delete process.env.HERMES_API_BASE;
    delete process.env.HERMES_API_KEY;
    delete process.env.API_SERVER_KEY;
    const core = await import(`${pathToFileURL(hermesCoreModulePath).href}?case=${Date.now()}-${importNonce++}`);

    assert.equal(core.getHermesApiBase('default'), 'http://127.0.0.1:18642');
    assert.equal(core.getHermesApiBase('coder'), 'http://127.0.0.2:18643');
    assert.equal(core.getHermesApiBase('missing'), null);
    assert.equal(core.getHermesApiBase('disabled'), null);
    assert.equal(core.apiHeaders('default').Authorization, 'Bearer default-secret');
    assert.equal(core.apiHeaders('coder').Authorization, 'Bearer coder-secret');

    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), auth: init.headers?.Authorization });
      return Response.json({ ok: true });
    };
    try {
      await core.hermesApiGet('/api/sessions?profile=coder', 5000, 'coder');
      assert.deepEqual(calls[0], {
        url: 'http://127.0.0.2:18643/api/sessions?profile=coder',
        auth: 'Bearer coder-secret',
      });
      await assert.rejects(
        () => core.hermesApiGet('/api/sessions?profile=disabled', 5000, 'disabled'),
        /profile 'disabled' has no configured API server base/,
      );
      assert.equal(calls.length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }

    process.env.API_SERVER_KEY = 'global-default-secret';
    assert.equal(core.apiHeaders('default').Authorization, 'Bearer global-default-secret');
    assert.equal(core.apiHeaders('coder').Authorization, 'Bearer coder-secret');
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
    if (oldHermesApiKey === undefined) delete process.env.HERMES_API_KEY;
    else process.env.HERMES_API_KEY = oldHermesApiKey;
    if (oldApiServerKey === undefined) delete process.env.API_SERVER_KEY;
    else process.env.API_SERVER_KEY = oldApiServerKey;
  }
});

test('session and stats routes preserve profile-routing errors instead of generic fetch failures', () => {
  const sessionsRouteSource = readFileSync(resolve('src/app/api/deck/sessions/route.ts'), 'utf8');
  const messagesRouteSource = readFileSync(resolve('src/app/api/deck/sessions/[id]/messages/route.ts'), 'utf8');
  const statsRouteSource = readFileSync(statsRoutePath, 'utf8');
  for (const source of [sessionsRouteSource, messagesRouteSource, statsRouteSource]) {
    assert.match(source, /SessionProfileRoutingError/);
    assert.match(source, /err instanceof SessionProfileRoutingError/);
    assert.match(source, /error: err\.code/);
    assert.match(source, /status: err\.status/);
  }
  assert.match(sessionsRouteSource, /const api = await getSessions\(profile\)/);
  assert.match(sessionsRouteSource, /const sessions = mergeSessions\(projected, api\)/);
  assert.match(messagesRouteSource, /const messages = await getMessages\(decodedId, profile/);
  assert.doesNotMatch(messagesRouteSource, /noProjectedSessionError|profile !== 'default'/);
  assert.doesNotMatch(sessionsRouteSource, /profile === 'default'\s*\?/);
  assert.match(statsRouteSource, /listProjectedSessions\('default'\)/);
  assert.match(statsRouteSource, /getSessionsForStats\('default'\)/);
  assert.match(statsRouteSource, /statsFromSessions\(mergeSessionRows\(projected, api\), 'default'\)/);
});

test('admin user helpers approve users, assign profiles, reject invalid actors, and keep super_admin immutable', async () => {
  const home = makeHome();
  let auth = await loadAuth(home);
  const store = withSuppressedBootstrapLog(() => auth.readAuth());
  const superAdmin = Object.values(store.users)[0];
  const now = new Date().toISOString();
  const admin = {
    id: 'admin_phase4',
    username: 'phase4-admin',
    role: 'admin',
    status: 'active',
    ...auth.createPasswordRecord('admin-password-123'),
    assignedProfileIds: [],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: superAdmin.id,
  };
  const ordinary = {
    id: 'user_phase4_ordinary',
    username: 'phase4-user',
    role: 'user',
    status: 'active',
    ...auth.createPasswordRecord('user-password-123'),
    assignedProfileIds: [],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: superAdmin.id,
  };
  const pending = {
    id: 'user_phase4_pending',
    username: 'phase4-pending',
    role: 'user',
    status: 'pending',
    ...auth.createPasswordRecord('pending-password-123'),
    assignedProfileIds: [],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
  };
  writeStore(home, { ...store, users: { ...store.users, [admin.id]: admin, [ordinary.id]: ordinary, [pending.id]: pending } });

  auth = await loadAuth(home);
  const safeUsers = auth.listSafeDeckUsers();
  assert.equal(safeUsers.some((user) => 'passwordHash' in user || 'passwordSalt' in user), false);
  assert.equal(safeUsers.find((user) => user.id === superAdmin.id).immutable, true);

  const approved = auth.updateDeckUserByAdmin(admin.id, pending.id, { status: 'active' });
  assert.equal(approved.ok, true);
  assert.equal(approved.user.status, 'active');
  assert.equal(approved.user.approvedBy, admin.id);

  const assigned = auth.replaceDeckUserProfileAssignments(admin.id, ordinary.id, ['default', 'agent-a', 'default'], ['default', 'agent-a']);
  assert.equal(assigned.ok, true);
  assert.deepEqual(assigned.user.assignedProfileIds, ['default', 'agent-a']);

  const invalidProfile = auth.replaceDeckUserProfileAssignments(admin.id, ordinary.id, ['agent-b'], ['default', 'agent-a']);
  assert.equal(invalidProfile.ok, false);
  assert.equal(invalidProfile.code, 'invalid_profile');

  const ordinaryDenied = auth.updateDeckUserByAdmin(ordinary.id, pending.id, { status: 'disabled' });
  assert.equal(ordinaryDenied.ok, false);
  assert.equal(ordinaryDenied.code, 'forbidden');

  const superAdminDisabled = auth.updateDeckUserByAdmin(admin.id, superAdmin.id, { status: 'disabled' });
  assert.equal(superAdminDisabled.ok, false);
  assert.match(superAdminDisabled.error, /super_admin/i);
  assert.equal(auth.readAuth().users[superAdmin.id].status, 'active');

  const superAdminAssigned = auth.replaceDeckUserProfileAssignments(admin.id, superAdmin.id, ['default'], ['default']);
  assert.equal(superAdminAssigned.ok, false);
  assert.match(superAdminAssigned.error, /super_admin/i);

  const secondSuperAdmin = auth.updateDeckUserByAdmin(superAdmin.id, ordinary.id, { role: 'super_admin' });
  assert.equal(secondSuperAdmin.ok, false);
  assert.match(secondSuperAdmin.error, /super_admin/i);
  assert.equal(Object.values(auth.readAuth().users).filter((user) => user.role === 'super_admin').length, 1);

  const promoted = auth.updateDeckUserByAdmin(superAdmin.id, ordinary.id, { role: 'admin' });
  assert.equal(promoted.ok, true);
  assert.equal(promoted.user.role, 'admin');
  const demoted = auth.updateDeckUserByAdmin(superAdmin.id, ordinary.id, { role: 'user' });
  assert.equal(demoted.ok, true);
  assert.equal(demoted.user.role, 'user');

  const adminCannotPromote = auth.updateDeckUserByAdmin(admin.id, pending.id, { role: 'admin' });
  assert.equal(adminCannotPromote.ok, false);
  assert.match(adminCannotPromote.error, /super_admin/i);
});

test('model preferences are stored per user and profile without mutating assignments or config-like fields', async () => {
  const home = makeHome();
  let auth = await loadAuth(home);
  const store = withSuppressedBootstrapLog(() => auth.readAuth());
  const superAdmin = Object.values(store.users)[0];
  const now = new Date().toISOString();
  const userA = {
    id: 'user_model_a',
    username: 'model-a',
    role: 'user',
    status: 'active',
    ...auth.createPasswordRecord('model-a-password-123'),
    assignedProfileIds: ['shared-agent'],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: superAdmin.id,
  };
  const userB = {
    id: 'user_model_b',
    username: 'model-b',
    role: 'user',
    status: 'active',
    ...auth.createPasswordRecord('model-b-password-123'),
    assignedProfileIds: ['shared-agent'],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: superAdmin.id,
  };
  const admin = {
    id: 'admin_model_pref',
    username: 'model-admin',
    role: 'admin',
    status: 'active',
    ...auth.createPasswordRecord('model-admin-password-123'),
    assignedProfileIds: [],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: superAdmin.id,
  };
  writeStore(home, { ...store, users: { ...store.users, [userA.id]: userA, [userB.id]: userB, [admin.id]: admin } });

  auth = await loadAuth(home);
  const setA = auth.updateDeckModelPreference(userA.id, 'shared-agent', { modelId: 'claude-sonnet', modelProvider: 'anthropic' });
  const setB = auth.updateDeckModelPreference(userB.id, 'shared-agent', { modelId: 'gpt-4.1', modelProvider: 'openai' });
  const setAdmin = auth.updateDeckModelPreference(admin.id, 'unassigned-agent', { modelId: 'admin-model', modelProvider: 'local' });
  assert.equal(setA.ok, true);
  assert.equal(setB.ok, true);
  assert.equal(setAdmin.ok, true);

  assert.deepEqual(auth.getDeckModelPreference(userA.id, 'shared-agent'), {
    modelId: 'claude-sonnet',
    modelProvider: 'anthropic',
    updatedAt: setA.preference.updatedAt,
  });
  assert.deepEqual(auth.getDeckModelPreference(userB.id, 'shared-agent'), {
    modelId: 'gpt-4.1',
    modelProvider: 'openai',
    updatedAt: setB.preference.updatedAt,
  });
  assert.equal(auth.getDeckModelPreference(admin.id, 'unassigned-agent').modelId, 'admin-model');

  const after = auth.readAuth();
  assert.deepEqual(after.users[userA.id].assignedProfileIds, ['shared-agent']);
  assert.deepEqual(after.users[userB.id].assignedProfileIds, ['shared-agent']);
  assert.equal('config' in after.users[userA.id], false);
  assert.equal('profileConfig' in after.users[userA.id], false);
});

test('model preference route and chat stream enforce profile access and use stored fallback without config writes', () => {
  const routeSource = readFileSync(modelPreferencesRoutePath, 'utf8');
  const chatStreamSource = readFileSync(chatStreamRoutePath, 'utf8');
  const hookSource = readFileSync(useChatModelsPath, 'utf8');
  const modelsSource = readFileSync(modelsModulePath, 'utf8');
  const clientApiSource = readFileSync(clientApiPath, 'utf8');

  assert.match(routeSource, /requireActiveUser\(req\)/);
  assert.match(routeSource, /requireProfileAccess\(auth\.user, profileId/);
  assert.match(routeSource, /getDeckModelPreference\(auth\.user\.id, profileId\)/);
  assert.match(routeSource, /updateDeckModelPreference\(auth\.user\.id, profileId/);
  assert.match(routeSource, /readLimitedJsonObject\(req, 16_000\)/);
  assert.doesNotMatch(routeSource, /saveProfileConfig|saveProfileConfigFile|configSave|assignedProfileIds\s*:/);

  assert.match(chatStreamSource, /getDeckModelPreference\(auth\.user\.id, profileId\)/);
  assert.match(chatStreamSource, /hasExplicitModel/);
  // Regression: raw/whitespace profile ids must be replaced by the normalized, authorized id before streaming.
  assert.match(chatStreamSource, /const profileId = normalizeProfileId\(bodyRecord\.profileId, 'default'\);[\s\S]*const effectiveBody = \{\s*\.\.\.bodyRecord,\s*profileId,/);
  assert.match(chatStreamSource, /!hasExplicitModel && preference\?\.modelId \? \{ model: preference\.modelId \} : \{\}/);
  assert.match(chatStreamSource, /stream = createChatStream\(effectiveBody, \{[\s\S]*profileId,[\s\S]*ownerUserId: auth\.user\.id,[\s\S]*ownerRole: auth\.user\.role,[\s\S]*\}, req\.signal, projectionHooks\)/);
  assert.match(chatStreamSource, /ActiveStreamAuthorizationError[\s\S]*stream_supersede_forbidden/);
  assert.doesNotMatch(chatStreamSource, /updateDeckModelPreference|saveProfileConfig|saveProfileConfigFile/);

  assert.match(hookSource, /deckApi\.modelPreference\(profile/);
  assert.match(hookSource, /deckApi\.saveModelPreference\(profile/);
  assert.match(hookSource, /const saved = pref\?\.preference\?\.modelId[\s\S]*const def = saved\s*\|\|\s*\(r\.default\?\.model/);
  assert.match(hookSource, /if \(def\) setSelectedModelState\(def\.id\)/);
  assert.doesNotMatch(hookSource, /if \(def\) setSelectedModel\(def\.id\)/);
  assert.match(modelsSource, /fetchApiModels\(profile\)/);
  assert.match(modelsSource, /getHermesApiBase\(profile\)/);
  assert.match(modelsSource, /apiHeaders\(profile\)/);
  assert.doesNotMatch(modelsSource, /localModelCatalogForProfile|config\.yaml|state\.db|execFileAsync|spawn\(|runPythonOr/);
  assert.match(modelsSource, /extractModelItems/);
  assert.match(modelsSource, /throw new Error\('\/v1\/models returned no selectable profile models\.'\)/);
  assert.match(clientApiSource, /\/api\/deck\/model-preferences/);
  assert.doesNotMatch(hookSource, /localStorage/);
});

test('admin routes are guarded and validate profiles without leaking auth secrets', () => {
  const usersRoute = readFileSync(resolve('src/app/api/deck/admin/users/route.ts'), 'utf8');
  const userRoute = readFileSync(resolve('src/app/api/deck/admin/users/[id]/route.ts'), 'utf8');
  const profilesRoute = readFileSync(resolve('src/app/api/deck/admin/users/[id]/profiles/route.ts'), 'utf8');
  const deckProfilesRoute = readFileSync(resolve('src/app/api/deck/profiles/route.ts'), 'utf8');
  const csrfSource = readFileSync(csrfPath, 'utf8');
  const profilesSource = readFileSync(profilesModulePath, 'utf8');
  assert.match(usersRoute, /requireAdmin\(req\)/);
  assert.match(userRoute, /requireAdmin\(req\)/);
  assert.match(profilesRoute, /requireAdmin\(req\)/);
  assert.match(profilesRoute, /getStrictProfiles\(\)/);
  assert.doesNotMatch(profilesRoute, /getProfiles\(\)/);
  assert.match(profilesRoute, /replaceDeckUserProfileAssignments/);
  assert.doesNotMatch(usersRoute + userRoute + profilesRoute, /passwordHash|passwordSalt|sessionSecret/);
  assert.match(profilesRoute, /profiles_fetch_failed|Unable to validate profile assignments/);
  assert.match(deckProfilesRoute, /profiles_fetch_failed/);
  assert.doesNotMatch(deckProfilesRoute + profilesRoute, /fallbackProfilesForUser|localProfileIdsForCatalogFallback|profiles_catalog_unavailable/);
  assert.match(userRoute, /readLimitedJsonObject\(req, 16_000\)/);
  assert.match(profilesRoute, /readLimitedJsonObject\(req, 16_000\)/);
  assert.doesNotMatch(userRoute + profilesRoute, /readLimitedJson\([^\n]*,\s*\{\}\)/);
  assert.match(csrfSource, /export async function readLimitedJsonObject/);
  assert.match(csrfSource, /JSON body must be an object\./);
  assert.doesNotMatch(csrfSource, /catch\s*\{[\s\S]*fallback !== undefined[\s\S]*ok: true/);
  const strictStart = profilesSource.indexOf('async function fetchProfilesApi');
  const strictEnd = profilesSource.indexOf('export const getStrictProfiles');
  const strictProfileBlock = profilesSource.slice(strictStart, strictEnd);
  assert.match(strictProfileBlock, /fetch\(`\$\{base\}\$\{path\}`/);
  assert.match(strictProfileBlock, /Hermes Agent profile list unavailable/);
  assert.doesNotMatch(strictProfileBlock, /execFileAsync\(|runPythonOr\(|id: 'default'|getProfileActivity/);
  assert.match(profilesSource, /export const getProfiles = getStrictProfiles/);
});

test('settings page includes admin-only user management UI with immutable super_admin copy', () => {
  const source = readFileSync(resolve('src/components/AdminUsersPanel.tsx'), 'utf8');
  assert.match(source, /\/api\/deck\/admin\/users/);
  assert.match(source, /\/api\/deck\/profiles/);
  assert.match(source, /canManageUsers/);
  assert.match(source, /immutable super_admin/i);
  assert.match(source, /Approve/);
  assert.match(source, /Assign Agents/);
});

test('phase 6 UI gates terminal and config navigation by session capabilities', () => {
  const shellSource = readFileSync(resolve('src/components/AppShell.tsx'), 'utf8');
  const paletteSource = readFileSync(resolve('src/components/CommandPalette.tsx'), 'utf8');
  const dashboardSource = readFileSync(resolve('src/app/page.tsx'), 'utf8');

  assert.match(shellSource, /useDeckSession\(\)/);
  assert.match(shellSource, /canUseTerminal/);
  assert.match(shellSource, /canManageUsers/);
  assert.match(shellSource, /n\.key === 'terminal'[\s\S]*!canUseTerminal/);
  assert.match(shellSource, /n\.key === 'config'[\s\S]*!canManageUsers/);

  assert.match(paletteSource, /useDeckSession\(\)/);
  assert.match(paletteSource, /item\.id === 'p:terminal'[\s\S]*!canUseTerminal/);
  assert.match(paletteSource, /item\.id === 'p:config'[\s\S]*!canManageUsers/);
  assert.match(paletteSource, /item\.id === 'p:lcm'[\s\S]*!canManageUsers/);
  assert.match(paletteSource, /id: 'p:kanban'/);
  assert.match(paletteSource, /id: 'p:lcm'/);
  assert.match(paletteSource, /const loadSeqRef = useRef\(0\)/);
  assert.match(paletteSource, /const profileForLoad = activeProfile/);
  assert.match(paletteSource, /if \(loadSeqRef\.current !== seq\) return/);
  assert.match(paletteSource, /profileForLoad \? deckApi\.runs\(profileForLoad\) : Promise\.resolve\(\{ runs: \[\] \}\)/);

  assert.match(dashboardSource, /useDeckSession\(\)/);
  assert.match(dashboardSource, /canUseTerminal[\s\S]*\/terminal/);
  assert.match(dashboardSource, /canViewTokenAnalytics[\s\S]*deckApi\.tokens/);
});

test('phase 6 active profile reconciliation clears unauthorized stale selections and shows no-assigned-Agent state', () => {
  const contextSource = readFileSync(resolve('src/lib/profile-context.tsx'), 'utf8');
  const emptyStateSource = readFileSync(resolve('src/components/NoAssignedAgentsState.tsx'), 'utf8');
  const dashboardSource = readFileSync(resolve('src/app/page.tsx'), 'utf8');
  const profilesSource = readFileSync(resolve('src/app/profiles/page.tsx'), 'utf8');
  const chatSource = readFileSync(resolve('src/app/chat/page.tsx'), 'utf8');
  const profileChipSource = readFileSync(resolve('src/components/ProfileChip.tsx'), 'utf8');
  const chatHookSource = readFileSync(resolve('src/app/chat/_hooks/useChatStream.ts'), 'utf8');

  assert.match(contextSource, /function reconcileActiveProfile/);
  assert.match(contextSource, /profiles\.length === 0[\s\S]*removeStoredProfile\(\)/);
  assert.match(contextSource, /profiles\.some\(\(p\) => p\.id === prev\)/);
  assert.match(contextSource, /profiles\.find\(\(p\) => p\.active\)\?\.id[\s\S]*profiles\[0\]\?\.id/);
  assert.match(contextSource, /const \[profilesLoaded, setProfilesLoaded\] = useState\(false\)/);
  assert.match(contextSource, /pendingStoredProfileRef = useRef<string \| null>\(null\)/);
  assert.match(contextSource, /pendingStoredProfileRef\.current = stored/);
  assert.doesNotMatch(contextSource, /if \(stored\) setActiveProfileState\(stored\)/);
  assert.match(contextSource, /const pending = pendingStoredProfileRef\.current;[\s\S]*return reconcileActiveProfile\(pending \|\| prev, nextProfiles\)/);
  assert.match(contextSource, /catch \{[\s\S]*setProfiles\(\[\]\);[\s\S]*setActiveProfileState\(NO_PROFILE\)/);
  assert.match(contextSource, /setProfilesLoaded\(true\)/);
  assert.match(contextSource, /const setActiveProfile = useCallback\([\s\S]*profilesLoaded && profiles\.length === 0[\s\S]*removeStoredProfile\(\)[\s\S]*return NO_PROFILE/);
  assert.match(contextSource, /const onStorage = \(e: StorageEvent\) => \{[\s\S]*if \(!e\.newValue\) \{[\s\S]*setActiveProfileState\(NO_PROFILE\)/);
  assert.match(contextSource, /const onStorage = \(e: StorageEvent\) => \{[\s\S]*profilesLoaded && profiles\.length === 0[\s\S]*removeStoredProfile\(\)[\s\S]*return NO_PROFILE/);
  assert.match(contextSource, /if \(!profilesLoaded\) \{[\s\S]*pendingStoredProfileRef\.current = e\.newValue;[\s\S]*return NO_PROFILE/);
  assert.match(profileChipSource, /activeMeta\?\.name \|\| \(loading \? t\.loading : t\.label\)/);
  assert.doesNotMatch(profileChipSource, /activeMeta\?\.name \|\| activeProfile/);
  assert.match(chatHookSource, /if \(!profile\) \{[\s\S]*setError\(t\.profileUnavailable\);[\s\S]*return;[\s\S]*\}/);
  assert.match(chatHookSource, /profileId: profile/);
  assert.doesNotMatch(contextSource, /\|\| FALLBACK_PROFILE/);

  assert.match(emptyStateSource, /No assigned Agents/i);
  assert.match(emptyStateSource, /contact (an )?admin/i);
  assert.match(dashboardSource, /NoAssignedAgentsState/);
  assert.match(profilesSource, /NoAssignedAgentsState/);
  assert.match(chatSource, /NoAssignedAgentsState/);
});

test('phase 6 settings disables and annotates super_admin username changes while preserving password changes', () => {
  const source = readFileSync(resolve('src/app/settings/page.tsx'), 'utf8');
  assert.match(source, /immutableUsername/);
  assert.match(source, /role === 'super_admin'/);
  assert.match(source, /disabled=\{immutableUsername\}/);
  assert.match(source, /newUsername: wantsName \? newUsername\.trim\(\) : undefined/);
  assert.match(source, /super_admin username cannot be changed/i);
});

test('csrf auth boundary uses inactive-aware session inspection', () => {
  const source = readFileSync(csrfPath, 'utf8');
  assert.match(source, /inspectProtectedSessionToken\(readSessionCookie\(req\)\)/);
  assert.doesNotMatch(source, /verifySessionToken\(token\)/);
  assert.match(source, /result\.reason === 'inactive_user'[\s\S]*error: 'inactive_user'[\s\S]*status: 403/);
  assert.match(source, /error: 'Not authenticated\.'[\s\S]*status: 401/);
});

test('proxy auth boundary classifies inactive signed sessions before unauthenticated failures', () => {
  const source = readFileSync(proxyPath, 'utf8');
  assert.match(source, /inspectProtectedSessionToken\(token\)/);
  assert.doesNotMatch(source, /verifySessionToken\(token\)/);
  assert.match(source, /error: 'inactive_user'[\s\S]*status: 403/);
  assert.match(source, /error: 'Not authenticated\.'[\s\S]*status: 401/);
});

test('token analytics route uses the admin-only guard', () => {
  const source = readFileSync(tokenRoutePath, 'utf8');
  assert.match(source, /import \{ requireAdmin \} from '@\/lib\/server\/rbac';/);
  assert.match(source, /const auth = requireAdmin\(req\);/);
  assert.doesNotMatch(source, /requireProfileAccess/);
  assert.doesNotMatch(source, /getTokenStats\(days\)[\s\S]*requireAdmin\(req\)/);
});

test('chat resume authorization is bound to immutable stream metadata and API failures do not fall back to Hermes CLI', () => {
  const routeSource = readFileSync(chatStreamRoutePath, 'utf8');
  const resumeSource = readFileSync(chatResumeRoutePath, 'utf8');
  const streamSource = readFileSync(chatStreamModulePath, 'utf8');
  const hubSource = readFileSync(streamHubModulePath, 'utf8');

  assert.match(hubSource, /profileId: string;/);
  assert.match(hubSource, /ownerUserId: string;/);
  assert.match(hubSource, /createActiveStream\(sessionId: string, metadata: ActiveStreamMetadata\)/);
  assert.match(routeSource, /ownerUserId: auth\.user\.id/);
  assert.match(routeSource, /ownerRole: auth\.user\.role/);
  assert.match(resumeSource, /const active = getActiveStream\(sessionId\)/);
  assert.match(resumeSource, /requireProfileAccess\(auth\.user, active\.profileId/);
  assert.match(resumeSource, /active\.ownerUserId !== auth\.user\.id && !isAdminRole\(auth\.user\.role\)/);
  assert.doesNotMatch(resumeSource, /requireProfileAccess\(auth\.user, profileId/);

  assert.doesNotMatch(streamSource, /spawn\(['\"]hermes['\"]/);
  assert.doesNotMatch(streamSource, /fallback-cli|hermes-cli-fallback|backend: 'hermes-cli'/);
  assert.match(streamSource, /const rawProfile = stream\.profileId \|\|/);
  assert.match(streamSource, /const apiBase = getHermesApiBase\(profile\)/);
  assert.match(streamSource, /const reqHeaders = \{ \.\.\.apiHeaders\(profile\) \}/);
  assert.match(streamSource, /metadata = \{[\s\S]*profileId: profile,[\s\S]*source: 'hermesdeck'/);
  assert.match(streamSource, /profile_routing_unavailable/);
  assert.match(streamSource, /no configured API server base\/port/);
  assert.match(streamSource, /markStreamDone\(stream\);[\s\S]*return;[\s\S]*\}\n\n    const reqHeaders = \{ \.\.\.apiHeaders\(profile\) \}/);
  assert.match(streamSource, /hermes_api_unavailable/);
});

test('active chat stream supersede rejects a non-owner on the same profile without aborting the owner stream', async () => {
  const hub = await import(`${pathToFileURL(streamHubModulePath).href}?case=${Date.now()}-${importNonce++}`);
  const sessionId = `rbac-supersede-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ownerStream = hub.createActiveStream(sessionId, {
    profileId: 'shared-agent',
    ownerUserId: 'user-a',
    ownerRole: 'user',
  });
  let ownerAborted = false;
  ownerStream.abort.signal.addEventListener('abort', () => { ownerAborted = true; });

  assert.throws(
    () => hub.createActiveStream(sessionId, {
      profileId: 'shared-agent',
      ownerUserId: 'user-b',
      ownerRole: 'user',
    }),
    hub.ActiveStreamAuthorizationError,
  );
  assert.equal(ownerAborted, false);
  assert.equal(hub.getActiveStream(sessionId), ownerStream);
});

test('LCM and raw cache-image routes are admin-only', () => {
  const lcmSource = readFileSync(lcmRoutePath, 'utf8');
  const cacheImageSource = readFileSync(cacheImageRoutePath, 'utf8');
  const swSource = readFileSync(serviceWorkerPath, 'utf8');
  const shellSource = readFileSync(resolve('src/components/AppShell.tsx'), 'utf8');
  assert.match(lcmSource, /requireAdmin\(req\)/);
  assert.doesNotMatch(lcmSource, /requireAuth\(req\)|requireActiveUser\(req\)/);
  assert.match(cacheImageSource, /requireAdmin\(req\)/);
  assert.doesNotMatch(cacheImageSource, /requireProfileAccess|requireActiveUser/);
  const cacheImageSwStart = swSource.indexOf("url.pathname === '/api/deck/cache-image'");
  const cacheImageSwEnd = swSource.indexOf('// Other API requests');
  assert.notEqual(cacheImageSwStart, -1);
  assert.notEqual(cacheImageSwEnd, -1);
  const cacheImageSwBlock = swSource.slice(cacheImageSwStart, cacheImageSwEnd);
  assert.match(cacheImageSwBlock, /cache\.delete\(req\)/);
  assert.match(cacheImageSwBlock, /fetch\(req\)/);
  assert.doesNotMatch(cacheImageSwBlock, /cache\.match|putWithTrim\(IMAGE_CACHE|cache\.put/);
  assert.match(shellSource, /n\.key === 'lcm'[\s\S]*!canManageUsers/);
});

test('service worker shell excludes protected routes and navigation cache fallbacks', () => {
  const swSource = readFileSync(serviceWorkerPath, 'utf8');
  const appShellMatch = swSource.match(/const\s+APP_SHELL\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(appShellMatch);
  const appShell = appShellMatch[1];
  for (const route of ['/', '/chat', '/chat?source=pwa', '/profiles', '/runs', '/cron', '/tools', '/terminal', '/config', '/kanban', '/lcm', '/settings']) {
    const quoted = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.doesNotMatch(appShell, new RegExp(`['\"]${quoted}['\"]`), route);
  }
  const navigateMatch = swSource.match(/if\s*\(req\.mode\s*===\s*['"]navigate['"]\)\s*\{([\s\S]*?)\n\s*\}\n\s*\n\s*\/\/ Static assets/);
  assert.ok(navigateMatch);
  assert.doesNotMatch(navigateMatch[1], /putWithTrim|RUNTIME_CACHE|caches\.match\(req\)|chatHit|\/chat\?source=pwa/);
  assert.match(navigateMatch[1], /caches\.match\(['"]\/offline['"]\)/);
  assert.match(swSource, /!res\.redirected[\s\S]*putWithTrim\(RUNTIME_CACHE/);
});

test('cron profile routing errors preserve typed error code at route boundary', () => {
  const cronSource = readFileSync(hermesCronModulePath, 'utf8');
  const routeSource = readFileSync(cronRoutePath, 'utf8');
  assert.match(cronSource, /export class CronProfileRoutingError extends Error/);
  assert.match(cronSource, /readonly code = 'profile_routing_unavailable'/);
  assert.match(cronSource, /routed_profile_id/);
  assert.match(cronSource, /routing\.profile_id/);
  assert.match(cronSource, /throw new CronProfileRoutingError\(requestedProfile\)/);
  assert.match(routeSource, /err instanceof CronProfileRoutingError/);
  assert.match(routeSource, /error: err\.code/);
  assert.match(routeSource, /status: err\.status/);
  assert.match(routeSource, /cron_fetch_failed/);
});

test('API-only runtime helpers no longer use direct runtime storage or Hermes CLI probes', () => {
  const helperPaths = [
    'src/lib/server/hermes/sessions.ts',
    'src/lib/server/hermes/messages.ts',
    'src/lib/server/hermes/runs.ts',
    'src/lib/server/hermes/stats.ts',
    'src/lib/server/hermes/tokens.ts',
    'src/lib/server/hermes/tools.ts',
    'src/lib/server/hermes/models.ts',
    'src/lib/server/hermes/profiles.ts',
    'src/lib/server/hermes/health.ts',
    'src/lib/server/hermes/kanban.ts',
    'src/lib/server/hermes/lcm.ts',
  ];
  const combined = helperPaths.map((p) => readFileSync(resolve(p), 'utf8')).join('\n');
  assert.doesNotMatch(combined, /state\.db|sqlite3|pathlib\.Path\.home\(\)|execFileAsync\(['\"]hermes['\"]|spawn\(['\"]hermes['\"]|config\.yaml|profiles\/<id>|lcm\.db|kanban\.db|hermes kanban|runPython|node:fs|homedir\(\)|HERMES_DASHBOARD_BASE/);
  assert.match(readFileSync(resolve('src/lib/server/hermes/models.ts'), 'utf8'), /\/v1\/models/);
  assert.match(readFileSync(resolve('src/lib/server/hermes/profiles.ts'), 'utf8'), /\/v1\/profiles/);
  assert.match(readFileSync(resolve('src/lib/server/hermes/sessions.ts'), 'utf8'), /\/api\/sessions\?/);
  assert.match(readFileSync(resolve('src/lib/server/hermes/messages.ts'), 'utf8'), /\/api\/sessions\/\$\{encodeURIComponent\(trimmedSessionId\)\}\/messages/);
  assert.match(readFileSync(resolve('src/lib/server/hermes/stats.ts'), 'utf8'), /getSessionsForStats/);
  assert.match(readFileSync(resolve('src/lib/server/hermes/kanban.ts'), 'utf8'), /Hermes Agent API[\s\S]*\/api\/kanban/);
  assert.match(readFileSync(resolve('src/lib/server/hermes/lcm.ts'), 'utf8'), /\/api\/lcm[\s\S]*\/api\/lcm\/dashboard/);
  assert.doesNotMatch(readFileSync(resolve('src/lib/server/hermes/health.ts'), 'utf8'), /9120|\/api\/sessions|Dashboard sidecar|HERMES_DASHBOARD_BASE/);
});
