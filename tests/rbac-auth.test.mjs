import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, scryptSync, createHmac } from 'node:crypto';
import { register as registerLoader } from 'node:module';
import { NextRequest } from 'next/server.js';

registerLoader('./route-loader.mjs', import.meta.url);

const authModuleUrl = pathToFileURL(resolve('src/lib/server/auth.ts')).href;
const rbacModuleUrl = pathToFileURL(resolve('src/lib/server/rbac.ts')).href;
const sessionAuthModuleUrl = pathToFileURL(resolve('src/lib/server/session-auth.ts')).href;
const tokenRoutePath = resolve('src/app/api/deck/tokens/route.ts');
const statsRoutePath = resolve('src/app/api/deck/stats/route.ts');
const modelPreferencesRoutePath = resolve('src/app/api/deck/model-preferences/route.ts');
const chatStreamRoutePath = resolve('src/app/api/deck/chat/stream/route.ts');
const chatApprovalRoutePath = resolve('src/app/api/deck/chat/approval/route.ts');
const chatResumeRoutePath = resolve('src/app/api/deck/chat/resume/route.ts');
const chatStreamModulePath = resolve('src/lib/server/hermes/chat-stream.ts');
const clientSseModulePath = resolve('src/lib/client-sse.ts');
const streamHubModulePath = resolve('src/lib/server/hermes/stream-hub.ts');
const lcmRoutePath = resolve('src/app/api/deck/lcm/route.ts');
const configRoutePath = resolve('src/app/api/deck/config/route.ts');
const skillsRoutePath = resolve('src/app/api/deck/skills/route.ts');
const toolsRoutePath = resolve('src/app/api/deck/tools/route.ts');
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
const hermesToolsModulePath = resolve('src/lib/server/hermes/tools.ts');
const hermesMessagesModulePath = resolve('src/lib/server/hermes/messages.ts');
const deckChatProjectionModulePath = resolve('src/lib/server/deck-chat-projection.ts');
const deckSessionListModulePath = resolve('src/lib/server/deck-session-list.ts');
const cronRoutePath = resolve('src/app/api/deck/cron/route.ts');
const hermesCronModulePath = resolve('src/lib/server/hermes/cron.ts');
const registerRoutePath = resolve('src/app/api/deck/auth/register/route.ts');
const loginRoutePath = resolve('src/app/api/deck/auth/login/route.ts');
const mfaRoutePath = resolve('src/app/api/deck/auth/mfa/route.ts');
const adminUserRoutePath = resolve('src/app/api/deck/admin/users/[id]/route.ts');
const adminUserProfilesRoutePath = resolve('src/app/api/deck/admin/users/[id]/profiles/route.ts');
const deckProfilesRoutePath = resolve('src/app/api/deck/profiles/route.ts');
const deckModelsRoutePath = resolve('src/app/api/deck/models/route.ts');
const deckSessionsRoutePath = resolve('src/app/api/deck/sessions/route.ts');
const deckMessagesRoutePath = resolve('src/app/api/deck/sessions/[id]/messages/route.ts');
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

test('server RBAC helpers enforce admin roles, active status, and Agent assignments', async () => {
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
    assignedProfileIds: ['agent-a'],
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
    rbac.filterProfilesForUser(adminGuard.user, [{ id: 'default' }, { id: 'agent-a' }, { id: 'agent-b' }]),
    [{ id: 'agent-a' }],
  );
  assert.equal(rbac.requireProfileAccess(adminGuard.user, 'agent-a').ok, true);
  const adminDeniedProfile = rbac.requireProfileAccess(adminGuard.user, 'agent-b');
  assert.equal(adminDeniedProfile.ok, false);
  assert.equal(adminDeniedProfile.response.status, 403);
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

async function loadHermesCronModule() {
  return import(`${pathToFileURL(hermesCronModulePath).href}?case=${Date.now()}-${importNonce++}`);
}

async function loadHermesModelsModule() {
  return import(`${pathToFileURL(modelsModulePath).href}?case=${Date.now()}-${importNonce++}`);
}

async function loadHermesProfilesModule() {
  return import(`${pathToFileURL(profilesModulePath).href}?case=${Date.now()}-${importNonce++}`);
}

async function loadDeckSessionListModule() {
  return import(`${pathToFileURL(deckSessionListModulePath).href}?case=${Date.now()}-${importNonce++}`);
}

async function loadHermesCoreModule() {
  return import(`${pathToFileURL(hermesCoreModulePath).href}?case=${Date.now()}-${importNonce++}`);
}

async function loadRouteModule(routePath) {
  return import(`${pathToFileURL(routePath).href}?case=${Date.now()}-${importNonce++}`);
}

function routeRequest(path, init = {}) {
  const url = new URL(path, 'http://127.0.0.1:6117');
  const headers = new Headers(init.headers || {});
  if (!headers.has('origin') && !['GET', 'HEAD'].includes((init.method || 'GET').toUpperCase())) {
    headers.set('origin', 'http://127.0.0.1:6117');
  }
  const req = new Request(url, { ...init, headers });
  Object.defineProperty(req, 'nextUrl', { value: url });
  return req;
}

function jsonRouteRequest(path, method, body, { cookie } = {}) {
  const headers = {
    'content-type': 'application/json',
    ...(cookie ? { cookie } : {}),
  };
  return routeRequest(path, { method, headers, body: JSON.stringify(body) });
}

async function responseJson(res) {
  return res.json();
}

function cookieHeader(token) {
  return `hermesdeck_session=${encodeURIComponent(token)}`;
}

function sessionCookieValue(res) {
  const setCookie = res.headers.get('set-cookie') || '';
  const match = /(?:^|,\s*)hermesdeck_session=([^;,]+)/.exec(setCookie);
  return match ? decodeURIComponent(match[1]) : '';
}

function assertSafeUserPayload(user) {
  assert.equal(user && typeof user === 'object', true);
  assert.equal('passwordHash' in user, false);
  assert.equal('passwordSalt' in user, false);
  assert.equal('sessionSecret' in user, false);
}

test('profile-scoped Hermes sessions fail closed when upstream omits profile metadata', async () => {
  const home = makeHome();
  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMES_HOME = join(home, '.hermes');
    await withMockedHermesFetch(async () => ({ data: [{ id: 'legacy-default', title: 'Default legacy row' }] }), async () => {
      const sessions = await loadHermesSessionsModule();
      await assert.rejects(
        () => sessions.getSessions('sensgift'),
        (err) => err?.code === 'profile_routing_unavailable' && err?.status === 502,
      );
    });
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
  }
});

test('profile-scoped Hermes sessions fail closed on mismatched upstream profile metadata', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'sensgift'), { recursive: true });
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', '.env'), 'API_SERVER_PORT=18648\nAPI_SERVER_KEY=sensgift-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMES_HOME = hermesRoot;
    await withMockedHermesFetch(async () => ({ data: [{ id: 'default-owned', profile_id: 'default' }] }), async () => {
      const sessions = await loadHermesSessionsModule();
      await assert.rejects(
        () => sessions.getSessions('sensgift'),
        (err) => err?.code === 'session_profile_mismatch' && err?.status === 403,
      );
    });
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
  }
});

test('profile-scoped Hermes sessions accept matching upstream profile metadata', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'sensgift'), { recursive: true });
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', '.env'), 'API_SERVER_PORT=18648\nAPI_SERVER_KEY=sensgift-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMES_HOME = hermesRoot;
    await withMockedHermesFetch(async () => ({ data: [{ id: 'sensgift-owned', profile_id: 'sensgift', title: 'Sensgift' }] }), async () => {
      const sessions = await loadHermesSessionsModule();
      const rows = await sessions.getSessions('sensgift');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, 'sensgift-owned');
      assert.equal(rows[0].profileId, 'sensgift');
    });
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
  }
});

test('profile-scoped Hermes sessions accept response-envelope profile metadata', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'sensgift'), { recursive: true });
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', '.env'), 'API_SERVER_PORT=18648\nAPI_SERVER_KEY=sensgift-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMES_HOME = hermesRoot;
    await withMockedHermesFetch(async () => ({
      profile_id: 'sensgift',
      data: [{ id: 'sensgift-envelope', title: 'Envelope-profile legacy row' }],
    }), async (calls) => {
      const sessions = await loadHermesSessionsModule();
      const rows = await sessions.getSessions('sensgift');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, 'sensgift-envelope');
      assert.equal(rows[0].profileId, 'sensgift');
      assert.equal(calls[0].startsWith('http://127.0.0.1:18648/api/sessions?'), true);
    });
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
  }
});

test('profile-scoped Hermes sessions stamp unlabeled rows from a dedicated profile API base', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'sensgift'), { recursive: true });
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', '.env'), 'API_SERVER_PORT=18648\nAPI_SERVER_KEY=sensgift-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMES_HOME = hermesRoot;
    await withMockedHermesFetch(async () => ({ data: [{ id: 'sensgift-unlabeled', title: 'Dedicated profile legacy row' }] }), async (calls) => {
      const sessions = await loadHermesSessionsModule();
      const rows = await sessions.getSessions('sensgift');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, 'sensgift-unlabeled');
      assert.equal(rows[0].profileId, 'sensgift');
      assert.equal(calls[0].startsWith('http://127.0.0.1:18648/api/sessions?'), true);
    });
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
  }
});

test('deleteSession proves profile ownership then calls Hermes Agent API DELETE', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'sensgift'), { recursive: true });
  writeFileSync(join(hermesRoot, '.env'), 'API_SERVER_PORT=18642\nAPI_SERVER_KEY=default-secret\n');
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', '.env'), 'API_SERVER_PORT=18648\nAPI_SERVER_KEY=sensgift-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMES_HOME = hermesRoot;
    delete process.env.HERMES_API_BASE;
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET', auth: init.headers?.Authorization });
      if ((init.method || 'GET') === 'DELETE') return Response.json({ ok: true, removed: 1 });
      return Response.json({ profile_id: 'sensgift', data: [{ id: 'sensgift-session-1', profile_id: 'sensgift' }] });
    };

    const sessions = await loadHermesSessionsModule();
    const result = await sessions.deleteSession('sensgift-session-1', 'sensgift');
    assert.deepEqual(result, { ok: true, removed: 1 });
    assert.deepEqual(calls.map((call) => [call.method, call.url, call.auth]), [
      ['GET', 'http://127.0.0.1:18648/api/sessions?limit=200&offset=0&profile=sensgift', 'Bearer sensgift-secret'],
      ['DELETE', 'http://127.0.0.1:18648/api/sessions/sensgift-session-1?profile=sensgift', 'Bearer sensgift-secret'],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
  }
});

test('profile-scoped Hermes sessions reject unlabeled rows from the shared default API base', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'sensgift'), { recursive: true });
  writeFileSync(join(hermesRoot, '.env'), 'API_SERVER_PORT=6117\nAPI_SERVER_KEY=default-secret\n');
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', '.env'), 'API_SERVER_PORT=6117\nAPI_SERVER_KEY=default-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMES_HOME = hermesRoot;
    await withMockedHermesFetch(async () => ({ data: [{ id: 'shared-unlabeled' }] }), async () => {
      const sessions = await loadHermesSessionsModule();
      await assert.rejects(
        () => sessions.getSessions('sensgift'),
        (err) => err?.code === 'profile_routing_unavailable' && err?.status === 502,
      );
      await assert.rejects(
        () => sessions.getSessionsForStats('sensgift'),
        (err) => err?.code === 'profile_routing_unavailable' && err?.status === 502,
      );
    });
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
  }
});

test('profile-scoped Hermes sessions reject loopback alias rows from the shared default API base', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'sensgift'), { recursive: true });
  writeFileSync(join(hermesRoot, '.env'), 'API_SERVER_PORT=6117\nAPI_SERVER_KEY=sensgift-secret\n');
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', '.env'), 'HERMES_API_BASE=http://localhost:6117\nAPI_SERVER_KEY=sensgift-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMES_HOME = hermesRoot;
    await withMockedHermesFetch(async () => ({ data: [{ id: 'loopback-alias-unlabeled' }] }), async () => {
      const sessions = await loadHermesSessionsModule();
      await assert.rejects(
        () => sessions.getSessions('sensgift'),
        (err) => err?.code === 'profile_routing_unavailable' && err?.status === 502,
      );
    });
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
  }
});

test('profile-scoped Hermes sessions reject IPv6 loopback alias rows from the shared default API base', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'sensgift'), { recursive: true });
  writeFileSync(join(hermesRoot, '.env'), 'API_SERVER_PORT=6117\nAPI_SERVER_KEY=sensgift-secret\n');
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', '.env'), 'HERMES_API_BASE=http://[::1]:6117\nAPI_SERVER_KEY=sensgift-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMES_HOME = hermesRoot;
    await withMockedHermesFetch(async () => ({ data: [{ id: 'ipv6-loopback-alias-unlabeled' }] }), async () => {
      const sessions = await loadHermesSessionsModule();
      await assert.rejects(
        () => sessions.getSessions('sensgift'),
        (err) => err?.code === 'profile_routing_unavailable' && err?.status === 502,
      );
    });
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
  }
});

test('profile-scoped Hermes cron accepts unlabeled jobs from a dedicated profile API base', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'sensgift'), { recursive: true });
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', '.env'), 'API_SERVER_PORT=18648\nAPI_SERVER_KEY=sensgift-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMES_HOME = hermesRoot;
    await withMockedHermesFetch(async () => ({ jobs: [{ id: 'job-1', schedule: '* * * * *' }] }), async (calls) => {
      const cron = await loadHermesCronModule();
      const jobs = await cron.getCronJobs(['sensgift']);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].profile, 'sensgift');
      assert.equal(calls[0], 'http://127.0.0.1:18648/api/jobs?include_disabled=true&profile=sensgift');
    });
    await withMockedHermesFetch(async () => ({ jobs: [{ id: 'job-2', profile: 'default', schedule: '* * * * *' }] }), async () => {
      const cron = await loadHermesCronModule();
      await assert.rejects(
        () => cron.getCronJobs(['sensgift']),
        (err) => err?.code === 'cron_profile_mismatch' && err?.status === 403,
      );
    });
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
  }
});

test('model catalog resolves config default when Hermes API exposes only profile placeholders', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'sensgift'), { recursive: true });
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', '.env'), 'API_SERVER_PORT=18648\nAPI_SERVER_KEY=sensgift-secret\n');
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', 'config.yaml'), [
    'agent:',
    '  model:',
    '    provider: openai-codex',
    '    default: gpt-5.5',
    '  reasoning_effort: high',
    '',
  ].join('\n'));

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  const originalFetch = globalThis.fetch;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMES_HOME = hermesRoot;
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href === 'http://127.0.0.1:18648/v1/models') {
        return Response.json({ data: [{ id: 'sensgift', owned_by: 'hermes' }] });
      }
      if (href.endsWith('/v1/profiles') || href.endsWith('/api/profiles')) {
        return new Response('missing', { status: 404 });
      }
      return Response.json({ ok: true });
    };

    const models = await loadHermesModelsModule();
    const payload = await models.getModels('sensgift');
    assert.equal(payload.default.model, 'gpt-5.5');
    assert.equal(payload.default.provider, 'openai-codex');
    assert.equal(payload.reasoningEffort, 'high');
    assert.equal(payload.providers.some((provider) => provider.models.some((model) => model.id === 'sensgift')), false);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
  }
});

test('local fallback profile catalog includes non-secret runtime model metadata', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'sensgift'), { recursive: true });
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', '.env'), 'API_SERVER_PORT=18648\nAPI_SERVER_KEY=sensgift-secret\n');
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', 'config.yaml'), [
    'agent:',
    '  model:',
    '    provider: openai-codex',
    '    default: gpt-5.5',
    '  reasoning_effort: high',
    '',
  ].join('\n'));

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  const originalFetch = globalThis.fetch;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMES_HOME = hermesRoot;
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href.endsWith('/v1/profiles') || href.endsWith('/api/profiles')) {
        return new Response('missing', { status: 404 });
      }
      if (href === 'http://127.0.0.1:18648/health') return Response.json({ ok: true });
      return Response.json({ ok: true, profile_id: 'default' });
    };

    const profiles = await loadHermesProfilesModule();
    const rows = await profiles.getStrictProfiles();
    const sensgift = rows.find((profile) => profile.id === 'sensgift');
    assert.equal(sensgift?.model, 'gpt-5.5');
    assert.equal(sensgift?.reasoningEffort, 'high');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
  }
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

test('Deck session list fails closed when upstream Agent metadata proof is unavailable', async () => {
  const home = makeHome();
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  try {
    process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
    process.env.HERMESDECK_DATA_DIR = join(home, '.hermesdeck');
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMES_HOME = join(home, '.hermes');
    await withMockedHermesFetch(async () => ({
      data: [{ id: 'unverified-api-row', title: 'Must not be trusted without profile metadata' }],
    }), async () => {
      const sessionList = await loadDeckSessionListModule();
      const projection = await import(pathToFileURL(deckChatProjectionModulePath).href);
      projection.startProjectedTurn({
        sessionId: 'sensgift-kevin-projected',
        profileId: 'sensgift',
        ownerUserId: 'kevinchen',
        ownerRole: 'user',
        message: 'Kevin projected turn',
      });
      projection.startProjectedTurn({
        sessionId: 'sensgift-other-owner',
        profileId: 'sensgift',
        ownerUserId: 'other-user',
        ownerRole: 'user',
        message: 'Other user projected turn',
      });

      await assert.rejects(
        () => sessionList.listDeckSessionsForProfile('sensgift', { userId: 'kevinchen', role: 'user' }),
        (err) => err?.code === 'profile_routing_unavailable' && err?.status === 502,
      );
      assert.deepEqual(
        projection.listProjectedSessions('sensgift', { userId: 'kevinchen', role: 'user' }).map((row) => row.id),
        ['sensgift-kevin-projected'],
      );
    });
  } finally {
    if (oldAuthDir === undefined) delete process.env.HERMESDECK_AUTH_DIR;
    else process.env.HERMESDECK_AUTH_DIR = oldAuthDir;
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
  }
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

test('Deck message hydration finalizes empty projected assistant drafts from completed API messages', async () => {
  const home = makeHome();
  const dataDir = join(home, '.hermesdeck-data');
  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const oldApiServerKey = process.env.API_SERVER_KEY;
  const originalFetch = globalThis.fetch;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
    process.env.HERMESDECK_DATA_DIR = dataDir;
    process.env.HERMES_API_BASE = 'http://127.0.0.1:18703';
    process.env.API_SERVER_KEY = 'default-secret';

    const auth = await loadAuth(home);
    let store = withSuppressedBootstrapLog(() => auth.readAuth());
    const now = new Date().toISOString();
    const user = {
      id: 'user_message_hydration',
      username: 'message-hydration-user',
      role: 'user',
      status: 'active',
      ...auth.createPasswordRecord('message-hydration-password-123'),
      assignedProfileIds: ['default'],
      preferences: { profiles: {} },
      createdAt: now,
      updatedAt: now,
      approvedAt: now,
      approvedBy: Object.values(store.users)[0].id,
    };
    store = { ...store, users: { ...store.users, [user.id]: user } };
    writeStore(home, store);
    const token = auth.issueSessionToken(user.id);

    const projection = await import(`${pathToFileURL(deckChatProjectionModulePath).href}?case=${Date.now()}-${importNonce++}`);
    const viewer = { userId: user.id, role: user.role };
    projection.startProjectedTurn({ sessionId: 'hydrate-final', profileId: 'default', ownerUserId: user.id, ownerRole: user.role, message: 'finish me' });
    projection.startProjectedTurn({ sessionId: 'hydrate-running', profileId: 'default', ownerUserId: user.id, ownerRole: user.role, message: 'still running' });
    projection.startProjectedTurn({ sessionId: 'hydrate-duplicate', profileId: 'default', ownerUserId: user.id, ownerRole: user.role, message: 'repeat prompt' });
    projection.finalizeProjectedTurn({
      sessionId: 'hydrate-duplicate',
      profileId: 'default',
      viewer,
      content: 'old duplicate answer',
      responseId: 'resp_old_duplicate',
    });
    projection.startProjectedTurn({ sessionId: 'hydrate-duplicate', profileId: 'default', ownerUserId: user.id, ownerRole: user.role, message: 'repeat prompt' });

    const latestUserCreatedAt = (sessionId) => {
      const createdAt = projection.getProjectedMessages(sessionId, 'default', { viewer })
        .filter((message) => message.role === 'user')
        .at(-1)?.createdAt;
      assert.equal(typeof createdAt, 'string');
      return createdAt;
    };
    const offsetIso = (iso, ms) => new Date(new Date(iso).getTime() + ms).toISOString();
    const finalUserAt = latestUserCreatedAt('hydrate-final');
    const runningUserAt = latestUserCreatedAt('hydrate-running');
    const duplicateCurrentUserAt = latestUserCreatedAt('hydrate-duplicate');

    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href.includes('/api/sessions/hydrate-final/messages')) {
        return Response.json({ data: [
          { id: 'u-api-final', role: 'user', content: 'finish me', created_at: offsetIso(finalUserAt, 1) },
          { id: 'a-api-final', role: 'assistant', content: 'finished answer', created_at: offsetIso(finalUserAt, 2), metadata: { finish_reason: 'stop', responseId: 'resp_hydrate_final' } },
        ] });
      }
      if (href.includes('/api/sessions/hydrate-running/messages')) {
        return Response.json({ data: [
          { id: 'u-api-running', role: 'user', content: 'still running', created_at: offsetIso(runningUserAt, 1) },
        ] });
      }
      if (href.includes('/api/sessions/hydrate-duplicate/messages')) {
        return Response.json({ data: [
          { id: 'u-api-duplicate-old', role: 'user', content: 'repeat prompt', created_at: offsetIso(duplicateCurrentUserAt, -10_000) },
          { id: 'a-api-duplicate-old', role: 'assistant', content: 'older answer must not recover current draft', created_at: offsetIso(duplicateCurrentUserAt, -9_000), metadata: { finish_reason: 'stop', responseId: 'resp_old_duplicate_api' } },
        ] });
      }
      if (href.includes('/api/sessions')) return Response.json({ data: [{ id: 'hydrate-final' }, { id: 'hydrate-running' }, { id: 'hydrate-duplicate' }] });
      return Response.json({ data: [] });
    };

    const route = await loadRouteModule(deckMessagesRoutePath);
    const finalRes = await route.GET(routeRequest('/api/deck/sessions/hydrate-final/messages?profile=default', { headers: { cookie: cookieHeader(token) } }), { params: Promise.resolve({ id: 'hydrate-final' }) });
    assert.equal(finalRes.status, 200);
    const finalBody = await responseJson(finalRes);
    assert.equal(finalBody.messages.at(-1).content, 'finished answer');
    assert.equal(finalBody.messages.at(-1).metadata.projectionStatus, 'final');
    assert.equal(projection.getProjectedMessages('hydrate-final', 'default', { viewer }).at(-1).content, 'finished answer');

    const runningRes = await route.GET(routeRequest('/api/deck/sessions/hydrate-running/messages?profile=default', { headers: { cookie: cookieHeader(token) } }), { params: Promise.resolve({ id: 'hydrate-running' }) });
    assert.equal(runningRes.status, 200);
    const runningBody = await responseJson(runningRes);
    assert.equal(runningBody.messages.at(-1).content, '');
    assert.equal(runningBody.messages.at(-1).metadata.projectionStatus, 'draft');

    const duplicateRes = await route.GET(routeRequest('/api/deck/sessions/hydrate-duplicate/messages?profile=default', { headers: { cookie: cookieHeader(token) } }), { params: Promise.resolve({ id: 'hydrate-duplicate' }) });
    assert.equal(duplicateRes.status, 200);
    const duplicateBody = await responseJson(duplicateRes);
    assert.equal(duplicateBody.messages.at(-1).content, '');
    assert.equal(duplicateBody.messages.at(-1).metadata.projectionStatus, 'draft');
    assert.equal(
      projection.getProjectedMessages('hydrate-duplicate', 'default', { viewer }).at(-1).content,
      '',
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldAuthDir === undefined) delete process.env.HERMESDECK_AUTH_DIR;
    else process.env.HERMESDECK_AUTH_DIR = oldAuthDir;
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
    if (oldApiServerKey === undefined) delete process.env.API_SERVER_KEY;
    else process.env.API_SERVER_KEY = oldApiServerKey;
  }
});

test('Deck chat projection proof/write helpers are profile-scoped and owner/admin-scoped', async () => {
  const home = makeHome();
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  try {
    delete process.env.HERMESDECK_DATA_DIR;
    process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
    const projection = await import(`${pathToFileURL(deckChatProjectionModulePath).href}?case=${Date.now()}-${importNonce++}`);
    projection.startProjectedTurn({
      sessionId: 'owner-scoped-local-1',
      profileId: 'sensgift',
      ownerUserId: 'owner-a',
      ownerRole: 'user',
      message: 'hello owner',
    });
    projection.finalizeProjectedTurn({
      sessionId: 'owner-scoped-local-1',
      profileId: 'sensgift',
      viewer: { userId: 'owner-a', role: 'user' },
      content: 'owner answer',
      responseId: 'resp_owner_a',
    });

    assert.equal(projection.hasProjectedSession('owner-scoped-local-1', 'sensgift', { userId: 'owner-a', role: 'user' }), true);
    assert.equal(projection.projectedResponseIdMatches('owner-scoped-local-1', 'sensgift', 'resp_owner_a', { userId: 'owner-a', role: 'user' }), true);
    assert.equal(projection.hasProjectedSession('owner-scoped-local-1', 'sensgift', { userId: 'owner-b', role: 'user' }), false);
    assert.equal(projection.projectedResponseIdMatches('owner-scoped-local-1', 'sensgift', 'resp_owner_a', { userId: 'owner-b', role: 'user' }), false);
    assert.equal(projection.hasProjectedSession('owner-scoped-local-1', 'sensgift', { userId: 'admin-1', role: 'admin' }), true);
    assert.throws(
      () => projection.recordProjectedRunEvent({
        sessionId: 'owner-scoped-local-1',
        profileId: 'sensgift',
        viewer: { userId: 'owner-b', role: 'user' },
        type: 'response.output_item.added',
        payload: { item: { id: 'fc_shared', type: 'function_call', name: 'tool' } },
      }),
      (err) => err?.code === 'session_profile_mismatch' && err?.status === 403,
    );
  } finally {
    if (oldAuthDir === undefined) delete process.env.HERMESDECK_AUTH_DIR;
    else process.env.HERMESDECK_AUTH_DIR = oldAuthDir;
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
  }
});

test('projected continuation history is owner/profile scoped and omits unsafe rows', async () => {
  const home = makeHome();
  const dataDir = join(home, '.hermesdeck');
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  try {
    mkdirSync(dataDir, { recursive: true });
    process.env.HERMESDECK_DATA_DIR = dataDir;
    delete process.env.HERMESDECK_AUTH_DIR;
    const longText = 'L'.repeat(1500);
    writeFileSync(join(dataDir, 'chat-projection.v1.json'), JSON.stringify({
      version: 1,
      sessions: {
        'history-safe-session': {
          id: 'history-safe-session',
          profileId: 'sensgift',
          title: 'history safe',
          source: 'hermesdeck',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          messageCount: 8,
          ownerUserId: 'owner-a',
          ownerRole: 'user',
          status: 'completed',
          messages: [
            { id: 'u1', role: 'user', content: 'safe user', createdAt: '2026-01-01T00:00:00.000Z' },
            { id: 'a1', role: 'assistant', content: 'safe assistant', createdAt: '2026-01-01T00:00:01.000Z', metadata: { projectionStatus: 'final' } },
            { id: 'tool1', role: 'tool', content: 'tool output must not leak', createdAt: '2026-01-01T00:00:02.000Z' },
            { id: 'draft1', role: 'assistant', content: 'draft must not leak', createdAt: '2026-01-01T00:00:03.000Z', metadata: { projectionStatus: 'draft' } },
            { id: 'err1', role: 'assistant', content: 'Error: secret failure body', createdAt: '2026-01-01T00:00:04.000Z', metadata: { projectionStatus: 'error' } },
            { id: 'att1', role: 'user', content: 'attachment body must not leak', createdAt: '2026-01-01T00:00:05.000Z', attachments: [{ id: 'att', name: 'raw.txt', mime: 'text/plain', size: 10, kind: 'text', text: 'private' }] },
            { id: 'tc1', role: 'assistant', content: '', createdAt: '2026-01-01T00:00:06.000Z', toolName: 'search', toolCalls: [{ id: 'call_1', name: 'search', arguments: '{}' }] },
            { id: 'a2', role: 'assistant', content: longText, createdAt: '2026-01-01T00:00:07.000Z', metadata: { projectionStatus: 'final' } },
          ],
        },
      },
      aliases: {},
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }, null, 2));

    const projection = await import(`${pathToFileURL(deckChatProjectionModulePath).href}?case=${Date.now()}-${importNonce++}`);
    const continuation = projection.getProjectedContinuation('history-safe-session', 'sensgift', { userId: 'owner-a', role: 'user' });
    assert.deepEqual(continuation.conversationHistory, [
      { role: 'user', content: 'safe user' },
      { role: 'assistant', content: 'safe assistant' },
      { role: 'assistant', content: 'L'.repeat(1000) },
    ]);
    assert.equal(projection.getProjectedContinuation('history-safe-session', 'sensgift', { userId: 'owner-b', role: 'user' }), null);
    assert.equal(projection.getProjectedContinuation('history-safe-session', 'default', { userId: 'owner-a', role: 'user' }), null);
  } finally {
    if (oldAuthDir === undefined) delete process.env.HERMESDECK_AUTH_DIR;
    else process.env.HERMESDECK_AUTH_DIR = oldAuthDir;
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
  }
});

test('Deck chat projection does not durably write argument deltas', async () => {
  const home = makeHome();
  const dataDir = join(home, '.hermesdeck');
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  try {
    process.env.HERMESDECK_DATA_DIR = dataDir;
    delete process.env.HERMESDECK_AUTH_DIR;
    const projection = await import(`${pathToFileURL(deckChatProjectionModulePath).href}?case=${Date.now()}-${importNonce++}`);
    projection.startProjectedTurn({
      sessionId: 'delta-local-1',
      profileId: 'sensgift',
      ownerUserId: 'owner-a',
      ownerRole: 'user',
      message: 'use a tool',
    });
    const storePath = join(dataDir, 'chat-projection.v1.json');
    const beforeDelta = readFileSync(storePath, 'utf8');

    projection.recordProjectedRunEvent({
      sessionId: 'delta-local-1',
      profileId: 'sensgift',
      viewer: { userId: 'owner-a', role: 'user' },
      type: 'response.function_call.arguments.delta',
      payload: { item_id: 'fc_delta', delta: '{"q"' },
    });
    assert.equal(readFileSync(storePath, 'utf8'), beforeDelta);

    projection.recordProjectedRunEvent({
      sessionId: 'delta-local-1',
      profileId: 'sensgift',
      viewer: { userId: 'owner-a', role: 'user' },
      type: 'response.function_call.arguments.done',
      payload: { item_id: 'fc_delta', arguments: '{"q":"done"}', name: 'search' },
    });
    assert.match(readFileSync(storePath, 'utf8'), /"arguments": "\{\\"q\\":\\"done\\"\}"/);
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

test('chat stream proves named Agent API routability before upstream runs call', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  const dataDir = join(home, '.hermesdeck-data');
  mkdirSync(join(hermesRoot, 'profiles', 'coder'), { recursive: true });
  writeFileSync(join(hermesRoot, '.env'), 'API_SERVER_PORT=18642\n');
  writeFileSync(join(hermesRoot, 'profiles', 'coder', '.env'), 'API_SERVER_PORT=18643\nAPI_SERVER_KEY=coder-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  const originalFetch = globalThis.fetch;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.HERMES_HOME;
    delete process.env.HERMES_API_BASE;
    process.env.HERMESDECK_DATA_DIR = dataDir;

    const auth = await loadAuth(home);
    let store = withSuppressedBootstrapLog(() => auth.readAuth());
    const user = {
      id: 'user_coder_chat',
      username: 'coder-chat-user',
      role: 'user',
      status: 'active',
      ...auth.createPasswordRecord('coder-password-123'),
      assignedProfileIds: ['coder'],
      preferences: { profiles: {} },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      approvedBy: Object.values(store.users)[0].id,
    };
    store = { ...store, users: { ...store.users, [user.id]: user } };
    writeStore(home, store);
    const token = auth.issueSessionToken(user.id);

    const streamRoute = await loadRouteModule(chatStreamRoutePath);
    const requestBody = { profileId: 'coder', message: 'hello', model: 'mock-model' };

    for (const [caseName, healthBody] of [
      ['mismatched identity', { ok: true, profile_id: 'default' }],
    ]) {
      const calls = [];
      globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), method: init.method || 'GET' });
        if (String(url) === 'http://127.0.0.1:18643/health') return Response.json(healthBody);
        if (String(url).endsWith('/v1/runs')) return Response.json({ unexpected: true });
        return new Response('not found', { status: 404 });
      };

      const res = await streamRoute.POST(jsonRouteRequest('/api/deck/chat/stream', 'POST', requestBody, { cookie: cookieHeader(token) }));
      assert.equal(res.status, 502, caseName);
      const payload = await responseJson(res);
      assert.equal(payload.error, 'profile_routing_unavailable');
      assert.match(payload.detail, /not routable|\/health/);
      assert.deepEqual(calls.map((call) => call.url), ['http://127.0.0.1:18643/health']);
      assert.equal(calls.some((call) => call.url.endsWith('/v1/runs')), false, `${caseName} must not call upstream runs`);
    }

    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET', auth: init.headers?.Authorization });
      if (String(url) === 'http://127.0.0.1:18643/health') return Response.json({ ok: true });
      if (String(url) === 'http://127.0.0.1:18643/v1/runs') {
        return Response.json({ run_id: 'run_coder', status: 'started' }, { status: 202 });
      }
      if (String(url) === 'http://127.0.0.1:18643/v1/runs/run_coder/events') {
        const body = new ReadableStream({
          start(controller) {
            setTimeout(() => {
              controller.enqueue(new TextEncoder().encode('data: {"type":"message.delta","delta":"ok"}\n\n'));
              controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
              controller.close();
            }, 10);
          },
        });
        return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-Hermes-Session-Id': 'coder-session' } });
      }
      return new Response('not found', { status: 404 });
    };

    const okRes = await streamRoute.POST(jsonRouteRequest('/api/deck/chat/stream', 'POST', requestBody, { cookie: cookieHeader(token) }));
    assert.equal(okRes.status, 200);
    assert.equal(okRes.headers.get('content-type')?.startsWith('text/event-stream'), true);
    assert.equal(calls.some((call) => call.url === 'http://127.0.0.1:18643/health'), true);
    assert.equal(calls.some((call) => call.url === 'http://127.0.0.1:18643/v1/runs' && call.method === 'POST'), true);
    assert.equal(calls.find((call) => call.url === 'http://127.0.0.1:18643/v1/runs')?.auth, 'Bearer coder-secret');
    const sseText = await okRes.text();
    assert.match(sseText, /event: hub|event: done/);
    const hubSessionId = /"sessionId":"([^"]+)"/.exec(sseText)?.[1];
    const hub = await import(`${pathToFileURL(streamHubModulePath).href}?case=${Date.now()}-${importNonce++}`);
    const activeStream = hubSessionId ? hub.getActiveStream(hubSessionId) : undefined;
    if (activeStream?.evictTimer) clearTimeout(activeStream.evictTimer);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
    if (oldAuthDir === undefined) delete process.env.HERMESDECK_AUTH_DIR;
    else process.env.HERMESDECK_AUTH_DIR = oldAuthDir;
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
  }
});

test('default-profile chat stream does not continue from unproven restored client ids', async () => {
  const home = makeHome();
  const dataDir = join(home, '.hermesdeck-data');
  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const oldApiServerKey = process.env.API_SERVER_KEY;
  const originalFetch = globalThis.fetch;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
    process.env.HERMESDECK_DATA_DIR = dataDir;
    process.env.HERMES_API_BASE = 'http://127.0.0.1:18701';
    process.env.API_SERVER_KEY = 'default-secret';

    const auth = await loadAuth(home);
    let store = withSuppressedBootstrapLog(() => auth.readAuth());
    const now = new Date().toISOString();
    const user = {
      id: 'user_default_chat_proof',
      username: 'default-chat-proof-user',
      role: 'user',
      status: 'active',
      ...auth.createPasswordRecord('default-chat-proof-password-123'),
      assignedProfileIds: ['default'],
      preferences: { profiles: {} },
      createdAt: now,
      updatedAt: now,
      approvedAt: now,
      approvedBy: Object.values(store.users)[0].id,
    };
    store = { ...store, users: { ...store.users, [user.id]: user } };
    writeStore(home, store);
    const token = auth.issueSessionToken(user.id);
    const streamRoute = await loadRouteModule(chatStreamRoutePath);

    const staleSessionId = 'restored-default-session-from-browser';
    const upstreamCalls = [];
    globalThis.fetch = async (url, init = {}) => {
      upstreamCalls.push({
        url: String(url),
        method: init.method || 'GET',
        sessionId: init.headers?.['X-Hermes-Session-Id'],
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (String(url).endsWith('/v1/runs')) return Response.json({ run_id: 'run_default_new', status: 'started' }, { status: 202 });
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"ok","id":"resp_default_new"}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const res = await streamRoute.POST(jsonRouteRequest('/api/deck/chat/stream', 'POST', {
      profileId: 'default',
      sessionId: staleSessionId,
      message: 'start safely',
      model: 'mock-model',
    }, { cookie: cookieHeader(token) }));
    assert.equal(res.status, 200);
    const sseText = await res.text();
    const postCalls = upstreamCalls.filter((call) => call.url.endsWith('/v1/runs'));
    assert.equal(postCalls.length, 1);
    assert.equal(postCalls[0].sessionId?.startsWith('deck_'), true);
    assert.notEqual(postCalls[0].sessionId, staleSessionId);
    assert.equal('previous_response_id' in postCalls[0].body, false);
    assert.equal(upstreamCalls.some((call) => call.url.endsWith('/health')), false);
    const hubSessionId = /"sessionId":"([^"]+)"/.exec(sseText)?.[1] || postCalls[0].sessionId;
    const hub = await import(`${pathToFileURL(streamHubModulePath).href}?case=${Date.now()}-${importNonce++}`);
    const activeStream = hubSessionId ? hub.getActiveStream(hubSessionId) : undefined;
    if (activeStream?.evictTimer) clearTimeout(activeStream.evictTimer);

    const blockedCalls = [];
    globalThis.fetch = async (url, init = {}) => {
      blockedCalls.push({ url: String(url), method: init.method || 'GET' });
      return Response.json({ unexpected: true });
    };
    const blockedRes = await streamRoute.POST(jsonRouteRequest('/api/deck/chat/stream', 'POST', {
      profileId: 'default',
      sessionId: 'other-restored-default-session',
      previousResponseId: 'resp_from_unproven_restored_state',
      message: 'must not continue',
      model: 'mock-model',
    }, { cookie: cookieHeader(token) }));
    assert.equal(blockedRes.status, 403);
    assert.equal((await responseJson(blockedRes)).error, 'session_profile_unverified');
    assert.deepEqual(blockedCalls, []);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldAuthDir === undefined) delete process.env.HERMESDECK_AUTH_DIR;
    else process.env.HERMESDECK_AUTH_DIR = oldAuthDir;
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
    if (oldApiServerKey === undefined) delete process.env.API_SERVER_KEY;
    else process.env.API_SERVER_KEY = oldApiServerKey;
  }
});

test('chat stream rejects another ordinary user continuing owner-scoped projected sessions before active stream creation', async () => {
  const home = makeHome();
  const dataDir = join(home, '.hermesdeck-data');
  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const oldApiServerKey = process.env.API_SERVER_KEY;
  const originalFetch = globalThis.fetch;
  const projectedSessionId = 'owner-a-projected-default-session';
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
    process.env.HERMESDECK_DATA_DIR = dataDir;
    process.env.HERMES_API_BASE = 'http://127.0.0.1:18702';
    process.env.API_SERVER_KEY = 'default-secret';

    const auth = await loadAuth(home);
    let store = withSuppressedBootstrapLog(() => auth.readAuth());
    const now = new Date().toISOString();
    const userA = {
      id: 'user_projected_owner_a',
      username: 'projected-owner-a',
      role: 'user',
      status: 'active',
      ...auth.createPasswordRecord('projected-owner-a-password-123'),
      assignedProfileIds: ['default'],
      preferences: { profiles: {} },
      createdAt: now,
      updatedAt: now,
      approvedAt: now,
      approvedBy: Object.values(store.users)[0].id,
    };
    const userB = {
      id: 'user_projected_owner_b',
      username: 'projected-owner-b',
      role: 'user',
      status: 'active',
      ...auth.createPasswordRecord('projected-owner-b-password-123'),
      assignedProfileIds: ['default'],
      preferences: { profiles: {} },
      createdAt: now,
      updatedAt: now,
      approvedAt: now,
      approvedBy: Object.values(store.users)[0].id,
    };
    store = { ...store, users: { ...store.users, [userA.id]: userA, [userB.id]: userB } };
    writeStore(home, store);
    const userBToken = auth.issueSessionToken(userB.id);

    const projection = await import(`${pathToFileURL(deckChatProjectionModulePath).href}?case=${Date.now()}-${importNonce++}`);
    projection.startProjectedTurn({
      sessionId: projectedSessionId,
      profileId: 'default',
      ownerUserId: userA.id,
      ownerRole: userA.role,
      message: 'owned by user A',
    });
    projection.finalizeProjectedTurn({
      sessionId: projectedSessionId,
      profileId: 'default',
      viewer: { userId: userA.id, role: userA.role },
      content: 'user A answer',
      responseId: 'resp_owner_a_projected',
    });
    assert.equal(projection.projectedResponseIdMatches(
      projectedSessionId,
      'default',
      'resp_owner_a_projected',
      { userId: userA.id, role: userA.role },
    ), true);
    assert.equal(projection.projectedResponseIdMatches(
      projectedSessionId,
      'default',
      'resp_owner_a_projected',
      { userId: userB.id, role: userB.role },
    ), false);

    const upstreamCalls = [];
    globalThis.fetch = async (url, init = {}) => {
      upstreamCalls.push({ url: String(url), method: init.method || 'GET' });
      return Response.json({ unexpected: true });
    };

    const streamRoute = await loadRouteModule(chatStreamRoutePath);
    const res = await streamRoute.POST(jsonRouteRequest('/api/deck/chat/stream', 'POST', {
      profileId: 'default',
      sessionId: projectedSessionId,
      previousResponseId: 'resp_owner_a_projected',
      message: 'user B must not continue user A session',
      model: 'mock-model',
    }, { cookie: cookieHeader(userBToken) }));
    assert.equal(res.status, 403);
    assert.equal((await responseJson(res)).error, 'session_profile_unverified');
    assert.deepEqual(upstreamCalls, []);

    const hub = await import(`${pathToFileURL(streamHubModulePath).href}?case=${Date.now()}-${importNonce++}`);
    assert.equal(hub.getActiveStream(projectedSessionId), undefined);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldAuthDir === undefined) delete process.env.HERMESDECK_AUTH_DIR;
    else process.env.HERMESDECK_AUTH_DIR = oldAuthDir;
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
    if (oldApiServerKey === undefined) delete process.env.API_SERVER_KEY;
    else process.env.API_SERVER_KEY = oldApiServerKey;
  }
});

test('server-canonical projection response id overrides stale client continuation and item ids are ignored', async () => {
  const home = makeHome();
  const dataDir = join(home, '.hermesdeck-data');
  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const oldApiServerKey = process.env.API_SERVER_KEY;
  const originalFetch = globalThis.fetch;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
    process.env.HERMESDECK_DATA_DIR = dataDir;
    process.env.HERMES_API_BASE = 'http://127.0.0.1:18703';
    process.env.API_SERVER_KEY = 'default-secret';

    const auth = await loadAuth(home);
    let store = withSuppressedBootstrapLog(() => auth.readAuth());
    const now = new Date().toISOString();
    const user = {
      id: 'user_canonical_continuation',
      username: 'canonical-continuation',
      role: 'user',
      status: 'active',
      ...auth.createPasswordRecord('canonical-continuation-password-123'),
      assignedProfileIds: ['default'],
      preferences: { profiles: {} },
      createdAt: now,
      updatedAt: now,
      approvedAt: now,
      approvedBy: Object.values(store.users)[0].id,
    };
    store = { ...store, users: { ...store.users, [user.id]: user } };
    writeStore(home, store);
    const token = auth.issueSessionToken(user.id);

    const projection = await import(`${pathToFileURL(deckChatProjectionModulePath).href}?case=${Date.now()}-${importNonce++}`);
    projection.startProjectedTurn({
      sessionId: 'deck-visible-session',
      profileId: 'default',
      ownerUserId: user.id,
      ownerRole: user.role,
      message: 'first',
    });
    projection.finalizeProjectedTurn({
      sessionId: 'deck-visible-session',
      profileId: 'default',
      viewer: { userId: user.id, role: user.role },
      content: 'first answer',
      responseId: 'resp_server_canonical',
    });

    const upstreamCalls = [];
    globalThis.fetch = async (url, init = {}) => {
      upstreamCalls.push({
        url: String(url),
        method: init.method || 'GET',
        sessionId: init.headers?.['X-Hermes-Session-Id'],
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (String(url).endsWith('/v1/runs')) return Response.json({ run_id: 'run_canonical', status: 'started' }, { status: 202 });
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_item.done","item":{"id":"fc_tool_item","type":"function_call","name":"tool","arguments":"{}"}}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: {"type":"response.completed","response":{"id":"resp_new_server"}}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-Hermes-Session-Id': 'deck-visible-session' } });
    };

    const streamRoute = await loadRouteModule(chatStreamRoutePath);
    const res = await streamRoute.POST(jsonRouteRequest('/api/deck/chat/stream', 'POST', {
      profileId: 'default',
      sessionId: 'deck-visible-session',
      previousResponseId: 'resp_stale_client_value',
      message: 'continue',
      model: 'mock-model',
    }, { cookie: cookieHeader(token) }));
    assert.equal(res.status, 200);
    const sseText = await res.text();
    const postCalls = upstreamCalls.filter((call) => call.url.endsWith('/v1/runs'));
    assert.equal(postCalls.length, 1);
    assert.equal(postCalls[0].sessionId, 'deck-visible-session');
    assert.equal(postCalls[0].body.previous_response_id, 'resp_server_canonical');
    assert.equal('conversation_history' in postCalls[0].body, false);
    assert.match(sseText, /"responseId":"resp_new_server"/);
    assert.doesNotMatch(sseText, /"responseId":"fc_tool_item"/);

    const stored = JSON.parse(readFileSync(join(dataDir, 'chat-projection.v1.json'), 'utf8'));
    assert.equal(stored.sessions['deck-visible-session'].responseId, 'resp_new_server');
    assert.equal(stored.sessions['deck-visible-session'].messages.some((message) => message.metadata?.responseId === 'fc_tool_item'), false);

    const hub = await import(`${pathToFileURL(streamHubModulePath).href}?case=${Date.now()}-${importNonce++}`);
    const activeStream = hub.getActiveStream('deck-visible-session');
    if (activeStream?.evictTimer) clearTimeout(activeStream.evictTimer);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldAuthDir === undefined) delete process.env.HERMESDECK_AUTH_DIR;
    else process.env.HERMESDECK_AUTH_DIR = oldAuthDir;
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
    if (oldApiServerKey === undefined) delete process.env.API_SERVER_KEY;
    else process.env.API_SERVER_KEY = oldApiServerKey;
  }
});

test('projected messages resolve browser aliases after canonical session id reconciliation', async () => {
  const home = makeHome();
  const dataDir = join(home, '.hermesdeck-data');
  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMESDECK_DATA_DIR = dataDir;
    const projection = await import(`${pathToFileURL(deckChatProjectionModulePath).href}?case=${Date.now()}-${importNonce++}`);
    const viewer = { userId: 'user_alias_kevin', role: 'user' };
    projection.startProjectedTurn({
      sessionId: 'deck_generated_alias_session',
      profileId: 'sensgift',
      ownerUserId: viewer.userId,
      ownerRole: viewer.role,
      message: 'alias probe',
    });
    projection.reconcileProjectedSessionId('browser_visible_alias_session', 'deck_generated_alias_session', 'sensgift', viewer);
    projection.reconcileProjectedSessionId('deck_generated_alias_session', 'backend_canonical_alias_session', 'sensgift', viewer);
    projection.finalizeProjectedTurn({
      sessionId: 'backend_canonical_alias_session',
      profileId: 'sensgift',
      viewer,
      content: 'alias ok',
      responseId: 'resp_alias_ok',
    });

    const messages = projection.getProjectedMessages('browser_visible_alias_session', 'sensgift', { viewer });
    assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant']);
    assert.equal(messages[1].content, 'alias ok');

    const storePath = join(dataDir, 'chat-projection.v1.json');
    const stored = JSON.parse(readFileSync(storePath, 'utf8'));
    assert.equal(stored.aliases.browser_visible_alias_session, 'backend_canonical_alias_session');
    assert.equal(stored.aliases.deck_generated_alias_session, 'backend_canonical_alias_session');

    delete stored.aliases.browser_visible_alias_session;
    writeFileSync(storePath, JSON.stringify(stored, null, 2));
    const legacyMessages = projection.getProjectedMessages('browser_visible_alias_session', 'sensgift', { viewer });
    assert.equal(legacyMessages[1].content, 'alias ok');
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
  }
});

test('chat stream strips client-supplied conversation_history for unproven new sessions', async () => {
  const home = makeHome();
  const dataDir = join(home, '.hermesdeck-data');
  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const oldApiServerKey = process.env.API_SERVER_KEY;
  const originalFetch = globalThis.fetch;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
    process.env.HERMESDECK_DATA_DIR = dataDir;
    process.env.HERMES_API_BASE = 'http://127.0.0.1:18704';
    process.env.API_SERVER_KEY = 'default-secret';

    const auth = await loadAuth(home);
    let store = withSuppressedBootstrapLog(() => auth.readAuth());
    const now = new Date().toISOString();
    const user = {
      id: 'user_untrusted_history',
      username: 'untrusted-history',
      role: 'user',
      status: 'active',
      ...auth.createPasswordRecord('untrusted-history-password-123'),
      assignedProfileIds: ['default'],
      preferences: { profiles: {} },
      createdAt: now,
      updatedAt: now,
      approvedAt: now,
      approvedBy: Object.values(store.users)[0].id,
    };
    store = { ...store, users: { ...store.users, [user.id]: user } };
    writeStore(home, store);
    const token = auth.issueSessionToken(user.id);

    const upstreamCalls = [];
    globalThis.fetch = async (url, init = {}) => {
      upstreamCalls.push({
        url: String(url),
        method: init.method || 'GET',
        sessionId: init.headers?.['X-Hermes-Session-Id'],
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (String(url).endsWith('/v1/runs')) return Response.json({ run_id: 'run_untrusted_history', status: 'started' }, { status: 202 });
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"response.completed","response":{"id":"resp_untrusted_history_reply"}}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-Hermes-Session-Id': 'server-new-history-test' } });
    };

    const streamRoute = await loadRouteModule(chatStreamRoutePath);
    const res = await streamRoute.POST(jsonRouteRequest('/api/deck/chat/stream', 'POST', {
      profileId: 'default',
      sessionId: 'browser-unproven-history-session',
      message: 'new session prompt',
      model: 'mock-model',
      conversation_history: [
        { role: 'user', content: 'CLIENT POISON snake_case' },
        { role: 'assistant', content: 'poison answer' },
      ],
      conversationHistory: [
        { role: 'user', content: 'CLIENT POISON camelCase' },
        { role: 'assistant', content: 'poison answer' },
      ],
    }, { cookie: cookieHeader(token) }));
    assert.equal(res.status, 200);
    const sseText = await res.text();
    const postCalls = upstreamCalls.filter((call) => call.url.endsWith('/v1/runs'));
    assert.equal(postCalls.length, 1);
    assert.match(postCalls[0].sessionId, /^deck_/);
    assert.equal(postCalls[0].body.previous_response_id, undefined);
    assert.equal('conversation_history' in postCalls[0].body, false);
    assert.doesNotMatch(JSON.stringify(postCalls[0].body), /CLIENT POISON/);
    assert.match(sseText, /"responseId":"resp_untrusted_history_reply"/);

    const hub = await import(`${pathToFileURL(streamHubModulePath).href}?case=${Date.now()}-${importNonce++}`);
    const activeStream = hub.getActiveStream(postCalls[0].sessionId);
    if (activeStream?.evictTimer) clearTimeout(activeStream.evictTimer);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldAuthDir === undefined) delete process.env.HERMESDECK_AUTH_DIR;
    else process.env.HERMESDECK_AUTH_DIR = oldAuthDir;
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
    if (oldApiServerKey === undefined) delete process.env.API_SERVER_KEY;
    else process.env.API_SERVER_KEY = oldApiServerKey;
  }
});

test('stale previous response 404 clears projected response chain so retry starts fresh', async () => {
  const home = makeHome();
  const dataDir = join(home, '.hermesdeck-data');
  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const oldApiServerKey = process.env.API_SERVER_KEY;
  const originalFetch = globalThis.fetch;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
    process.env.HERMESDECK_DATA_DIR = dataDir;
    process.env.HERMES_API_BASE = 'http://127.0.0.1:18705';
    process.env.API_SERVER_KEY = 'default-secret';

    const auth = await loadAuth(home);
    let store = withSuppressedBootstrapLog(() => auth.readAuth());
    const now = new Date().toISOString();
    const user = {
      id: 'user_stale_previous_response',
      username: 'stale-previous-response',
      role: 'user',
      status: 'active',
      ...auth.createPasswordRecord('stale-previous-response-password-123'),
      assignedProfileIds: ['default'],
      preferences: { profiles: {} },
      createdAt: now,
      updatedAt: now,
      approvedAt: now,
      approvedBy: Object.values(store.users)[0].id,
    };
    store = { ...store, users: { ...store.users, [user.id]: user } };
    writeStore(home, store);
    const token = auth.issueSessionToken(user.id);

    const projection = await import(`${pathToFileURL(deckChatProjectionModulePath).href}?case=${Date.now()}-${importNonce++}`);
    projection.startProjectedTurn({
      sessionId: 'deck-stale-response-session',
      profileId: 'default',
      ownerUserId: user.id,
      ownerRole: user.role,
      message: 'first',
    });
    projection.finalizeProjectedTurn({
      sessionId: 'deck-stale-response-session',
      profileId: 'default',
      viewer: { userId: user.id, role: user.role },
      content: 'first answer',
      responseId: 'resp_missing_upstream',
    });

    const upstreamCalls = [];
    globalThis.fetch = async (url, init = {}) => {
      upstreamCalls.push({
        url: String(url),
        method: init.method || 'GET',
        sessionId: init.headers?.['X-Hermes-Session-Id'],
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      const isRunPost = String(url).endsWith('/v1/runs');
      if (isRunPost && upstreamCalls.filter((call) => call.url.endsWith('/v1/runs')).length === 1) {
        return new Response(JSON.stringify({ error: 'Previous response not found: resp_missing_upstream' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (isRunPost) return Response.json({ run_id: 'run_after_repair', status: 'started' }, { status: 202 });
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"response.completed","response":{"id":"resp_after_repair"}}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-Hermes-Session-Id': 'deck-stale-response-session' } });
    };

    const streamRoute = await loadRouteModule(chatStreamRoutePath);
    const failed = await streamRoute.POST(jsonRouteRequest('/api/deck/chat/stream', 'POST', {
      profileId: 'default',
      sessionId: 'deck-stale-response-session',
      previousResponseId: 'resp_client_stale_ignored',
      message: 'continue with stale server id',
      model: 'mock-model',
    }, { cookie: cookieHeader(token) }));
    assert.equal(failed.status, 200);
    const failedSse = await failed.text();
    assert.match(failedSse, /Previous response not found: resp_missing_upstream/);
    const firstPost = upstreamCalls.filter((call) => call.url.endsWith('/v1/runs'))[0];
    assert.equal(firstPost.body.previous_response_id, 'resp_missing_upstream');

    let stored = JSON.parse(readFileSync(join(dataDir, 'chat-projection.v1.json'), 'utf8'));
    assert.equal(stored.sessions['deck-stale-response-session'].responseId, undefined);
    assert.equal(stored.sessions['deck-stale-response-session'].previousResponseId, undefined);
    const continuationAfterStale = projection.getProjectedContinuation('deck-stale-response-session', 'default', { userId: user.id, role: user.role });
    assert.equal(continuationAfterStale.sessionId, 'deck-stale-response-session');
    assert.equal(continuationAfterStale.responseChainStale, true);
    assert.deepEqual(continuationAfterStale.conversationHistory, [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'continue with stale server id' },
    ]);

    const retry = await streamRoute.POST(jsonRouteRequest('/api/deck/chat/stream', 'POST', {
      profileId: 'default',
      sessionId: 'deck-stale-response-session',
      previousResponseId: 'resp_client_still_stale',
      message: 'retry after repair',
      model: 'mock-model',
    }, { cookie: cookieHeader(token) }));
    assert.equal(retry.status, 200);
    const retrySse = await retry.text();
    const postCalls = upstreamCalls.filter((call) => call.url.endsWith('/v1/runs'));
    assert.equal(postCalls.length, 2);
    assert.equal(postCalls[1].body.previous_response_id, undefined);
    assert.deepEqual(postCalls[1].body.conversation_history, [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'continue with stale server id' },
    ]);
    assert.match(retrySse, /"responseId":"resp_after_repair"/);
    stored = JSON.parse(readFileSync(join(dataDir, 'chat-projection.v1.json'), 'utf8'));
    assert.equal(stored.sessions['deck-stale-response-session'].responseId, 'resp_after_repair');

    const hub = await import(`${pathToFileURL(streamHubModulePath).href}?case=${Date.now()}-${importNonce++}`);
    const activeStream = hub.getActiveStream('deck-stale-response-session');
    if (activeStream?.evictTimer) clearTimeout(activeStream.evictTimer);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldAuthDir === undefined) delete process.env.HERMESDECK_AUTH_DIR;
    else process.env.HERMESDECK_AUTH_DIR = oldAuthDir;
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
    if (oldApiServerKey === undefined) delete process.env.API_SERVER_KEY;
    else process.env.API_SERVER_KEY = oldApiServerKey;
  }
});

test('chat approval route requires authenticated pending projected session ownership', async () => {
  const home = makeHome();
  const dataDir = join(home, '.hermesdeck-data');
  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const oldApiServerKey = process.env.API_SERVER_KEY;
  const originalFetch = globalThis.fetch;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
    process.env.HERMESDECK_DATA_DIR = dataDir;
    process.env.HERMES_API_BASE = 'http://127.0.0.1:18706';
    process.env.API_SERVER_KEY = 'default-secret';

    const auth = await loadAuth(home);
    let store = withSuppressedBootstrapLog(() => auth.readAuth());
    const now = new Date().toISOString();
    const userA = {
      id: 'user_approval_owner', username: 'approval-owner', role: 'user', status: 'active',
      ...auth.createPasswordRecord('approval-owner-password-123'), assignedProfileIds: ['default'], preferences: { profiles: {} },
      createdAt: now, updatedAt: now, approvedAt: now, approvedBy: Object.values(store.users)[0].id,
    };
    const userB = {
      id: 'user_approval_other', username: 'approval-other', role: 'user', status: 'active',
      ...auth.createPasswordRecord('approval-other-password-123'), assignedProfileIds: ['default'], preferences: { profiles: {} },
      createdAt: now, updatedAt: now, approvedAt: now, approvedBy: Object.values(store.users)[0].id,
    };
    store = { ...store, users: { ...store.users, [userA.id]: userA, [userB.id]: userB } };
    writeStore(home, store);
    const tokenA = auth.issueSessionToken(userA.id);
    const tokenB = auth.issueSessionToken(userB.id);

    const projection = await import(`${pathToFileURL(deckChatProjectionModulePath).href}?case=${Date.now()}-${importNonce++}`);
    const viewerA = { userId: userA.id, role: userA.role };
    projection.startProjectedTurn({ sessionId: 'approval-session', profileId: 'default', ownerUserId: userA.id, ownerRole: userA.role, message: 'needs approval' });
    projection.recordProjectedRunEvent({
      sessionId: 'approval-session', profileId: 'default', viewer: viewerA, type: 'approval.request',
      payload: { type: 'approval.request', run_id: 'run_approval_owner', command: 'echo ok', choices: ['once', 'deny'] },
    });

    const upstreamCalls = [];
    globalThis.fetch = async (url, init = {}) => {
      upstreamCalls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
      return Response.json({ ok: true });
    };
    const route = await loadRouteModule(chatApprovalRoutePath);
    const body = { profileId: 'default', sessionId: 'approval-session', runId: 'run_approval_owner', choice: 'once', all: true, resolve_all: true };

    const wrongSession = await route.POST(jsonRouteRequest('/api/deck/chat/approval', 'POST', { ...body, sessionId: 'other-session' }, { cookie: cookieHeader(tokenA) }));
    assert.equal(wrongSession.status, 403);
    const wrongUser = await route.POST(jsonRouteRequest('/api/deck/chat/approval', 'POST', body, { cookie: cookieHeader(tokenB) }));
    assert.equal(wrongUser.status, 403);
    assert.deepEqual(upstreamCalls, []);

    const ok = await route.POST(jsonRouteRequest('/api/deck/chat/approval', 'POST', body, { cookie: cookieHeader(tokenA) }));
    assert.equal(ok.status, 200);
    assert.deepEqual(upstreamCalls, [{ url: 'http://127.0.0.1:18706/v1/runs/run_approval_owner/approval', method: 'POST', body: { choice: 'once' } }]);
    assert.equal(projection.hasPendingProjectedApproval({ sessionId: 'approval-session', profileId: 'default', runId: 'run_approval_owner', viewer: viewerA }), false);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldAuthDir === undefined) delete process.env.HERMESDECK_AUTH_DIR;
    else process.env.HERMESDECK_AUTH_DIR = oldAuthDir;
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
    if (oldApiServerKey === undefined) delete process.env.API_SERVER_KEY;
    else process.env.API_SERVER_KEY = oldApiServerKey;
  }
});

test('projected continuation rejects non-resp ids and unproven response chains fail closed', async () => {
  const home = makeHome();
  const dataDir = join(home, '.hermesdeck-data');
  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const oldApiServerKey = process.env.API_SERVER_KEY;
  const originalFetch = globalThis.fetch;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
    process.env.HERMESDECK_DATA_DIR = dataDir;
    process.env.HERMES_API_BASE = 'http://127.0.0.1:18704';
    process.env.API_SERVER_KEY = 'default-secret';

    const auth = await loadAuth(home);
    let store = withSuppressedBootstrapLog(() => auth.readAuth());
    const now = new Date().toISOString();
    const user = {
      id: 'user_invalid_continuation',
      username: 'invalid-continuation',
      role: 'user',
      status: 'active',
      ...auth.createPasswordRecord('invalid-continuation-password-123'),
      assignedProfileIds: ['default'],
      preferences: { profiles: {} },
      createdAt: now,
      updatedAt: now,
      approvedAt: now,
      approvedBy: Object.values(store.users)[0].id,
    };
    store = { ...store, users: { ...store.users, [user.id]: user } };
    writeStore(home, store);
    const token = auth.issueSessionToken(user.id);

    const projection = await import(`${pathToFileURL(deckChatProjectionModulePath).href}?case=${Date.now()}-${importNonce++}`);
    projection.startProjectedTurn({
      sessionId: 'no-response-proof-session',
      profileId: 'default',
      ownerUserId: user.id,
      ownerRole: user.role,
      message: 'first',
      previousResponseId: 'fc_invalid_previous',
    });
    projection.finalizeProjectedTurn({
      sessionId: 'no-response-proof-session',
      profileId: 'default',
      viewer: { userId: user.id, role: user.role },
      content: 'bad answer id ignored',
      responseId: 'call_invalid_response',
    });
    assert.equal(projection.projectedResponseIdMatches('no-response-proof-session', 'default', 'call_invalid_response', { userId: user.id, role: user.role }), false);
    const invalidContinuation = projection.getProjectedContinuation('no-response-proof-session', 'default', { userId: user.id, role: user.role });
    assert.equal(invalidContinuation.sessionId, 'no-response-proof-session');
    assert.equal(invalidContinuation.responseId, undefined);
    assert.deepEqual(invalidContinuation.conversationHistory, [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'bad answer id ignored' },
    ]);

    const upstreamCalls = [];
    globalThis.fetch = async (url, init = {}) => {
      upstreamCalls.push({ url: String(url), method: init.method || 'GET' });
      return Response.json({ unexpected: true });
    };

    const streamRoute = await loadRouteModule(chatStreamRoutePath);
    const res = await streamRoute.POST(jsonRouteRequest('/api/deck/chat/stream', 'POST', {
      profileId: 'default',
      sessionId: 'no-response-proof-session',
      previousResponseId: 'fc_invalid_previous',
      message: 'must fail closed',
      model: 'mock-model',
    }, { cookie: cookieHeader(token) }));
    assert.equal(res.status, 403);
    assert.equal((await responseJson(res)).error, 'response_profile_unverified');
    assert.deepEqual(upstreamCalls, []);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldAuthDir === undefined) delete process.env.HERMESDECK_AUTH_DIR;
    else process.env.HERMESDECK_AUTH_DIR = oldAuthDir;
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
    if (oldApiServerKey === undefined) delete process.env.API_SERVER_KEY;
    else process.env.API_SERVER_KEY = oldApiServerKey;
  }
});

test('chat stream does not forward unproven client session ids or response ids upstream', () => {
  const routeSource = readFileSync(chatStreamRoutePath, 'utf8');
  const streamSource = readFileSync(chatStreamModulePath, 'utf8');

  assert.match(routeSource, /proveProfileRoutable\(profileId\)/);
  assert.match(routeSource, /profileId !== 'default'/);
  assert.match(routeSource, /profile_routing_unavailable/);
  assert.match(routeSource, /getProjectedContinuation\(requestedSessionId, profileId, projectionViewer\)/);
  assert.doesNotMatch(routeSource, /projectedResponseIdMatches\(requestedSessionId, profileId, previousResponseId, projectionViewer\)/);
  assert.doesNotMatch(routeSource, /profileId !== 'default' && hasPreviousResponseId/);
  assert.match(routeSource, /const generatedDeckSessionId = requestedSessionId && !projectedSessionIsTrusted/);
  assert.doesNotMatch(routeSource, /trustedSessionIdForProfile = profileId === 'default'/);
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

test('chat resume cursor advances only after replayed events are consumed and gaps fail closed', () => {
  const clientSseSource = readFileSync(clientSseModulePath, 'utf8');
  const hookSource = readFileSync(resolve('src/app/chat/_hooks/useChatStream.ts'), 'utf8');

  assert.match(clientSseSource, /latestSeq is a producer high-water mark, not a consumed cursor/);
  assert.match(clientSseSource, /if \(gap\) \{\n\s+throw new Error\('stream replay gap/);
  assert.match(clientSseSource, /callbacks\.onEvent\?\.\(event, data\);[\s\S]*callbacks\.onSeq\?\.\(observedSeq\);/);
  assert.match(hookSource, /if \(info\.gap\) \{[\s\S]*Stream replay gap/);
  assert.doesNotMatch(hookSource, /inf\.lastSeq = info\.latestSeq/);
  assert.match(hookSource, /lastSeq: inf\.lastSeq/);
});

test('profile-scoped session rows require upstream proof or server-owned dedicated profile API routing', () => {
  const sessionsSource = readFileSync(hermesSessionsModulePath, 'utf8');

  assert.match(sessionsSource, /function profileIdForTrustedRow\([\s\S]*responseHasProfileMetadata = false/);
  assert.match(sessionsSource, /!isDefaultProfile\(requestedProfile\)[\s\S]*!responseHasProfileMetadata[\s\S]*!responseScopedByDedicatedApiBase/);
  assert.match(sessionsSource, /hasDedicatedProfileRouting\(profile\)/);
  assert.doesNotMatch(sessionsSource, /getHermesApiBase\(profile\)/);
  assert.match(sessionsSource, /Hermes Agent did not include session profile metadata for a profile-scoped session list/);
});

test('projection hook failures are fatal instead of running unprojected streams', () => {
  const streamSource = readFileSync(chatStreamModulePath, 'utf8');
  const routeSource = readFileSync(chatStreamRoutePath, 'utf8');

  assert.match(streamSource, /function runProjectionHook\(fn: \(\(\) => void\) \| undefined\): void \{\n\s+if \(!fn\) return;\n\s+fn\(\);\n\}/);
  assert.doesNotMatch(streamSource, /projection failures must not break live chat/);
  assert.match(routeSource, /error instanceof SessionProfileRoutingError/);
  assert.match(routeSource, /status: error\.status/);
  assert.match(routeSource, /JSON\.stringify\(\{ error: error\.code, detail: error\.message \}\)/);
});

test('profile HERMES_HOME with trailing slash resolves back to Hermes root', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'coder'), { recursive: true });
  writeFileSync(join(hermesRoot, '.env'), 'API_SERVER_PORT=18642\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMES_HOME = `${join(hermesRoot, 'profiles', 'coder')}/`;
    delete process.env.HERMES_API_BASE;
    const core = await loadHermesCoreModule();

    assert.equal(core.defaultHermesRoot(), hermesRoot);
    assert.equal(core.getHermesApiBase('default'), 'http://127.0.0.1:18642');
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
  }
});

test('Hermes API default port is the Agent API port, not the Deck UI port', async () => {
  const home = makeHome();
  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.HERMES_HOME;
    delete process.env.HERMES_API_BASE;
    const core = await loadHermesCoreModule();
    assert.equal(core.getHermesApiBase('default'), 'http://127.0.0.1:8642');
  } finally {
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
  }
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

test('admin profile catalog falls back to local routable profiles when Hermes profile APIs are unavailable', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'sensgift'), { recursive: true });
  mkdirSync(join(hermesRoot, 'profiles', 'bad profile'), { recursive: true });
  mkdirSync(join(hermesRoot, 'profiles', 'broken'), { recursive: true });
  mkdirSync(join(hermesRoot, 'profiles', 'parent', 'nested'), { recursive: true });
  writeFileSync(join(hermesRoot, '.env'), 'API_SERVER_PORT=18642\nAPI_SERVER_KEY=default-secret\n');
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', '.env'), 'API_SERVER_PORT=18648\nAPI_SERVER_KEY=sensgift-secret\n');
  writeFileSync(join(hermesRoot, 'profiles', 'broken', '.env'), 'API_SERVER_PORT=18649\nAPI_SERVER_KEY=broken-secret\n');
  writeFileSync(join(hermesRoot, 'profiles', 'parent', 'nested', '.env'), 'API_SERVER_PORT=18650\nAPI_SERVER_KEY=nested-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.HERMES_HOME;
    delete process.env.HERMES_API_BASE;
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), auth: init.headers?.Authorization });
      if (String(url).endsWith('/v1/profiles') || String(url).endsWith('/api/profiles')) {
        return new Response('missing', { status: 404 });
      }
      if (String(url) === 'http://127.0.0.1:18649/health') return new Response('down', { status: 503 });
      if (String(url) === 'http://127.0.0.1:18648/health') return Response.json({ ok: true, profile_id: 'sensgift' });
      return Response.json({ ok: true });
    };

    const profiles = await loadHermesProfilesModule();
    const result = await profiles.getStrictProfiles();
    assert.deepEqual(result.map((profile) => profile.id), ['default', 'sensgift']);
    assert.equal(result[0].active, true);
    assert.deepEqual(
      calls.map((call) => call.url.replace(/^http:\/\/127\.0\.0\.1:\d+/, 'http://127.0.0.1:<port>')),
      [
        'http://127.0.0.1:<port>/v1/profiles',
        'http://127.0.0.1:<port>/api/profiles',
        'http://127.0.0.1:<port>/health',
        'http://127.0.0.1:<port>/health',
        'http://127.0.0.1:<port>/health',
      ],
    );
    assert.equal(calls.some((call) => call.url.includes('18650')), false, 'must not recursively scan nested profiles');
    assert.equal(calls.some((call) => call.url.includes('bad%20profile') || call.url.includes('bad profile')), false);
    assert.equal(calls.some((call) => call.url === 'http://127.0.0.1:18649/health'), true, 'must probe and exclude unroutable immediate profiles');
    assert.equal(calls.some((call) => call.url === 'http://127.0.0.1:18648/health'), true);
    assert.equal(calls.find((call) => call.url === 'http://127.0.0.1:18648/health')?.auth, 'Bearer sensgift-secret');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
  }
});

test('admin profile catalog prefers Hermes API catalog when available', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'localonly'), { recursive: true });
  writeFileSync(join(hermesRoot, '.env'), 'API_SERVER_PORT=18652\n');
  writeFileSync(join(hermesRoot, 'profiles', 'localonly', '.env'), 'API_SERVER_PORT=18653\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.HERMES_HOME;
    delete process.env.HERMES_API_BASE;
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).endsWith('/v1/profiles')) return Response.json({ profiles: [{ id: 'default', name: 'Default API' }] });
      if (String(url).endsWith('/api/profiles')) return Response.json({ profiles: [{ id: 'default' }, { id: 'api-agent' }] });
      throw new Error(`unexpected fallback health probe: ${url}`);
    };

    const profiles = await loadHermesProfilesModule();
    const result = await profiles.getStrictProfiles();
    assert.deepEqual(result.map((profile) => profile.id), ['default', 'api-agent']);
    assert.equal(calls.some((url) => url.endsWith('/health')), false);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
  }
});

test('admin profile catalog does not fall back locally unless both strict Hermes profile APIs return 404', async () => {
  const cases = [
    {
      name: '500 and 401',
      handler: (url) => String(url).endsWith('/v1/profiles')
        ? new Response('server error', { status: 500 })
        : new Response('unauthorized', { status: 401 }),
      pattern: /\/v1\/profiles returned HTTP 500.*\/api\/profiles returned HTTP 401/s,
    },
    {
      name: 'mixed 404 and 500',
      handler: (url) => String(url).endsWith('/v1/profiles')
        ? new Response('missing', { status: 404 })
        : new Response('server error', { status: 500 }),
      pattern: /\/v1\/profiles returned HTTP 404.*\/api\/profiles returned HTTP 500/s,
    },
    {
      name: 'malformed JSON and 404',
      handler: (url) => String(url).endsWith('/v1/profiles')
        ? new Response('{not json', { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response('missing', { status: 404 }),
      pattern: /\/v1\/profiles returned invalid JSON.*\/api\/profiles returned HTTP 404/s,
    },
  ];

  for (const scenario of cases) {
    const home = makeHome();
    const hermesRoot = join(home, '.hermes');
    mkdirSync(join(hermesRoot, 'profiles', 'localonly'), { recursive: true });
    writeFileSync(join(hermesRoot, '.env'), 'API_SERVER_PORT=18654\n');
    writeFileSync(join(hermesRoot, 'profiles', 'localonly', '.env'), 'API_SERVER_PORT=18655\n');

    const oldHome = process.env.HOME;
    const oldUserprofile = process.env.USERPROFILE;
    const oldHermesHome = process.env.HERMES_HOME;
    const oldHermesApiBase = process.env.HERMES_API_BASE;
    const originalFetch = globalThis.fetch;
    const calls = [];
    try {
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      delete process.env.HERMES_HOME;
      delete process.env.HERMES_API_BASE;
      globalThis.fetch = async (url) => {
        calls.push(String(url));
        if (String(url).endsWith('/v1/profiles') || String(url).endsWith('/api/profiles')) return scenario.handler(url);
        throw new Error(`${scenario.name}: unexpected local fallback health probe: ${url}`);
      };

      const profiles = await loadHermesProfilesModule();
      await assert.rejects(() => profiles.getStrictProfiles(), scenario.pattern);
      assert.deepEqual(
        calls.map((url) => url.replace(/^http:\/\/127\.0\.0\.1:\d+/, 'http://127.0.0.1:<port>')),
        ['http://127.0.0.1:<port>/v1/profiles', 'http://127.0.0.1:<port>/api/profiles'],
        `${scenario.name} must not enumerate or health-probe local profiles`,
      );
    } finally {
      globalThis.fetch = originalFetch;
      process.env.HOME = oldHome;
      process.env.USERPROFILE = oldUserprofile;
      if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
      else process.env.HERMES_HOME = oldHermesHome;
      if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
      else process.env.HERMES_API_BASE = oldHermesApiBase;
    }
  }
});

test('ordinary assigned Agent list returns only configured assigned Agents without local enumeration', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'sensgift'), { recursive: true });
  mkdirSync(join(hermesRoot, 'profiles', 'unassigned'), { recursive: true });
  writeFileSync(join(hermesRoot, '.env'), 'API_SERVER_PORT=18642\n');
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', '.env'), 'API_SERVER_PORT=18648\nAPI_SERVER_KEY=sensgift-secret\n');
  writeFileSync(join(hermesRoot, 'profiles', 'unassigned', '.env'), 'API_SERVER_PORT=18649\nAPI_SERVER_KEY=unassigned-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.HERMES_HOME;
    delete process.env.HERMES_API_BASE;
    globalThis.fetch = async (url, init = {}) => {
      const href = String(url);
      calls.push({ url: href, auth: init.headers?.Authorization });
      if (href === 'http://127.0.0.1:18648/health') return Response.json({ ok: true });
      return Response.json({ ok: true });
    };

    const profiles = await loadHermesProfilesModule();
    const result = await profiles.getAssignedRoutableProfiles(['bad/profile', 'sensgift', 'sensgift']);
    assert.deepEqual(result.map((profile) => profile.id), ['sensgift']);
    assert.equal(result[0].active, true);
    assert.deepEqual(calls, [{ url: 'http://127.0.0.1:18648/health', auth: 'Bearer sensgift-secret' }]);
    assert.equal(calls.some((call) => call.url.includes('18649')), false);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
  }
});

test('named assigned Agent list accepts reachable health without routed identity', async () => {
  const home = makeHome();
  mkdirSync(join(home, '.hermes', 'profiles', 'sensgift'), { recursive: true });
  writeFileSync(join(home, '.hermes', 'profiles', 'sensgift', '.env'), 'API_SERVER_PORT=18648\nAPI_SERVER_KEY=sensgift-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const originalFetch = globalThis.fetch;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.HERMES_HOME;
    delete process.env.HERMES_API_BASE;
    globalThis.fetch = async () => Response.json({ ok: true });

    const profiles = await loadHermesProfilesModule();
    const result = await profiles.getAssignedRoutableProfiles(['sensgift']);
    assert.deepEqual(result.map((profile) => profile.id), ['sensgift']);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
  }
});

test('named assigned profile fallback fails closed on shared default base without routed identity', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'sensgift'), { recursive: true });
  writeFileSync(join(hermesRoot, '.env'), 'API_SERVER_PORT=18642\nAPI_SERVER_KEY=shared-secret\n');
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', '.env'), 'API_SERVER_PORT=18642\nAPI_SERVER_KEY=shared-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const originalFetch = globalThis.fetch;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMES_HOME = hermesRoot;
    delete process.env.HERMES_API_BASE;
    globalThis.fetch = async () => Response.json({ ok: true });

    const profiles = await loadHermesProfilesModule();
    await assert.rejects(
      () => profiles.getAssignedRoutableProfiles(['sensgift']),
      (err) => err?.code === 'assigned_profiles_unavailable'
        && err?.details.some((detail) => detail.includes('did not prove a dedicated non-default Agent route')),
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
  }
});

test('named assigned profile fallback fails closed when health proves a different profile', async () => {
  const home = makeHome();
  mkdirSync(join(home, '.hermes', 'profiles', 'sensgift'), { recursive: true });
  writeFileSync(join(home, '.hermes', 'profiles', 'sensgift', '.env'), 'API_SERVER_PORT=18648\nAPI_SERVER_KEY=sensgift-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const originalFetch = globalThis.fetch;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.HERMES_HOME;
    delete process.env.HERMES_API_BASE;
    globalThis.fetch = async () => Response.json({ ok: true, routed_profile_id: 'default' });

    const profiles = await loadHermesProfilesModule();
    await assert.rejects(
      () => profiles.getAssignedRoutableProfiles(['sensgift']),
      (err) => err?.code === 'assigned_profiles_unavailable'
        && err?.details.some((detail) => detail.includes("/health proved routed profile 'default'")),
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
  }
});

test('default assigned profile fallback allows legacy health without routed identity', async () => {
  const home = makeHome();

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const originalFetch = globalThis.fetch;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.HERMES_HOME;
    delete process.env.HERMES_API_BASE;
    globalThis.fetch = async () => Response.json({ ok: true });

    const profiles = await loadHermesProfilesModule();
    const result = await profiles.getAssignedRoutableProfiles(['default']);
    assert.deepEqual(result.map((profile) => profile.id), ['default']);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
  }
});

test('ordinary assigned profile fallback fails closed when assignments are unroutable', async () => {
  const home = makeHome();
  mkdirSync(join(home, '.hermes', 'profiles', 'broken'), { recursive: true });
  writeFileSync(join(home, '.hermes', 'profiles', 'broken', '.env'), 'API_SERVER_PORT=18650\nAPI_SERVER_KEY=broken-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const originalFetch = globalThis.fetch;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.HERMES_HOME;
    delete process.env.HERMES_API_BASE;
    globalThis.fetch = async () => new Response('down', { status: 503 });

    const profiles = await loadHermesProfilesModule();
    await assert.rejects(
      () => profiles.getAssignedRoutableProfiles(['bad/profile', 'broken', 'missing']),
      (err) => err?.code === 'assigned_profiles_unavailable'
        && err?.status === 502
        && err?.details.some((detail) => detail.includes('invalid or duplicate'))
        && err?.details.some((detail) => detail.includes('broken: /health returned HTTP 503'))
        && err?.details.some((detail) => detail.includes('missing: no configured API server base')),
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
  }
});

test('route-level registration approval assignment and assigned-profile use preserves RBAC under Deck-owned catalog fallback', async () => {
  const home = makeHome();
  const hermesRoot = join(home, '.hermes');
  mkdirSync(join(hermesRoot, 'profiles', 'sensgift'), { recursive: true });
  mkdirSync(join(hermesRoot, 'profiles', 'unassigned'), { recursive: true });
  writeFileSync(join(hermesRoot, '.env'), 'API_SERVER_PORT=18642\nAPI_SERVER_KEY=default-secret\n');
  writeFileSync(join(hermesRoot, 'profiles', 'sensgift', '.env'), 'API_SERVER_PORT=18648\nAPI_SERVER_KEY=sensgift-secret\n');
  writeFileSync(join(hermesRoot, 'profiles', 'unassigned', '.env'), 'API_SERVER_PORT=18649\nAPI_SERVER_KEY=unassigned-secret\n');

  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldHermesHome = process.env.HERMES_HOME;
  const oldHermesApiBase = process.env.HERMES_API_BASE;
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
    process.env.HERMES_HOME = hermesRoot;
    delete process.env.HERMES_API_BASE;

    globalThis.fetch = async (url, init = {}) => {
      const href = String(url);
      calls.push({ url: href, auth: init.headers?.Authorization });
      if (href.endsWith('/v1/profiles') || href.endsWith('/api/profiles')) {
        return new Response('missing', { status: 404 });
      }
      if (href === 'http://127.0.0.1:18642/health') return Response.json({ ok: true, profile_id: 'default' });
      if (href === 'http://127.0.0.1:18648/health') return Response.json({ ok: true });
      if (href === 'http://127.0.0.1:18649/health') return Response.json({ ok: true, profile_id: 'unassigned' });
      if (href === 'http://127.0.0.1:18648/v1/models') {
        return Response.json({ data: [{ id: 'sensgift-model', provider: 'openai', default: true }] });
      }
      if (href.startsWith('http://127.0.0.1:18648/api/sessions?') && href.includes('profile=sensgift')) {
        return Response.json({ profile_id: 'sensgift', data: [{ id: 'sensgift-session-1', profile_id: 'sensgift', title: 'Sensgift chat' }] });
      }
      return Response.json({ data: [] });
    };

    const auth = await loadAuth(home);
    const store = withSuppressedBootstrapLog(() => auth.readAuth());
    const superAdmin = Object.values(store.users)[0];
    const adminToken = auth.issueSessionToken(superAdmin.id);
    const adminCookie = cookieHeader(adminToken);

    const registerRoute = await loadRouteModule(registerRoutePath);
    const loginRoute = await loadRouteModule(loginRoutePath);
    const adminUserRoute = await loadRouteModule(adminUserRoutePath);
    const adminProfilesRoute = await loadRouteModule(adminUserProfilesRoutePath);
    const profilesRoute = await loadRouteModule(deckProfilesRoutePath);
    const modelsRoute = await loadRouteModule(deckModelsRoutePath);
    const sessionsRoute = await loadRouteModule(deckSessionsRoutePath);

    const registerRes = await registerRoute.POST(jsonRouteRequest('/api/deck/auth/register', 'POST', {
      username: 'fresh-user',
      password: 'fresh-password-123',
      displayName: 'Fresh User',
      email: 'fresh@example.test',
    }));
    assert.equal(registerRes.status, 201);
    assert.equal(sessionCookieValue(registerRes), '', 'registration must not set a protected session cookie');
    const registered = await responseJson(registerRes);
    assert.equal(registered.ok, true);
    assert.equal(registered.status, 'pending');
    assert.equal(registered.pending, true);
    assert.equal(registered.user.username, 'fresh-user');
    assert.deepEqual(registered.user.assignedProfileIds, []);
    assert.equal(registered.user.capabilities.canUseApp, false);
    assertSafeUserPayload(registered.user);

    const pendingLoginRes = await loginRoute.POST(jsonRouteRequest('/api/deck/auth/login', 'POST', {
      username: 'fresh-user',
      password: 'fresh-password-123',
    }));
    assert.equal(pendingLoginRes.status, 200);
    assert.equal(sessionCookieValue(pendingLoginRes), '', 'pending login must not set a protected session cookie');
    const pendingLogin = await responseJson(pendingLoginRes);
    assert.equal(pendingLogin.ok, true);
    assert.equal(pendingLogin.pending, true);
    assert.equal(pendingLogin.status, 'pending');
    assertSafeUserPayload(pendingLogin.user);

    const approveRes = await adminUserRoute.PATCH(
      jsonRouteRequest(`/api/deck/admin/users/${encodeURIComponent(registered.user.id)}`, 'PATCH', { status: 'active' }, { cookie: adminCookie }),
      { params: Promise.resolve({ id: encodeURIComponent(registered.user.id) }) },
    );
    const approved = await responseJson(approveRes);
    assert.equal(approveRes.status, 200, JSON.stringify(approved));
    assert.equal(approved.ok, true);
    assert.equal(approved.user.status, 'active');
    assert.equal(approved.user.approvedBy, superAdmin.id);

    const assignRes = await adminProfilesRoute.PUT(
      jsonRouteRequest(`/api/deck/admin/users/${encodeURIComponent(registered.user.id)}/profiles`, 'PUT', { assignedProfileIds: ['sensgift'] }, { cookie: adminCookie }),
      { params: Promise.resolve({ id: encodeURIComponent(registered.user.id) }) },
    );
    assert.equal(assignRes.status, 200);
    const assigned = await responseJson(assignRes);
    assert.equal(assigned.ok, true);
    assert.deepEqual(assigned.validProfileIds, ['default', 'sensgift', 'unassigned']);
    assert.deepEqual(assigned.user.assignedProfileIds, ['sensgift']);
    assert.equal(calls.some((call) => call.url.endsWith('/v1/profiles')), true);
    assert.equal(calls.some((call) => call.url.endsWith('/api/profiles')), true);
    assert.equal(calls.find((call) => call.url === 'http://127.0.0.1:18648/health')?.auth, 'Bearer sensgift-secret');

    const activeLoginRes = await loginRoute.POST(jsonRouteRequest('/api/deck/auth/login', 'POST', {
      username: 'fresh-user',
      password: 'fresh-password-123',
    }));
    assert.equal(activeLoginRes.status, 200);
    const activeToken = sessionCookieValue(activeLoginRes);
    assert.match(activeToken, /\S/);
    const activeLogin = await responseJson(activeLoginRes);
    assert.equal(activeLogin.ok, true);
    assert.equal(activeLogin.pending, false);
    assert.equal(activeLogin.user.status, 'active');
    assert.deepEqual(activeLogin.user.assignedProfileIds, ['sensgift']);
    assertSafeUserPayload(activeLogin.user);
    const activeCookie = cookieHeader(activeToken);

    const scopedAdmin = {
      id: 'admin_scoped_profile_route',
      username: 'scoped-admin',
      role: 'admin',
      status: 'active',
      ...auth.createPasswordRecord('scoped-admin-password-123'),
      assignedProfileIds: ['sensgift'],
      preferences: { profiles: {} },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      approvedBy: superAdmin.id,
    };
    const storeWithScopedAdmin = auth.readAuth();
    writeStore(home, { ...storeWithScopedAdmin, users: { ...storeWithScopedAdmin.users, [scopedAdmin.id]: scopedAdmin } });
    const scopedAdminCookie = cookieHeader(auth.issueSessionToken(scopedAdmin.id));

    const adminProfilesRes = await profilesRoute.GET(routeRequest('/api/deck/profiles', { headers: { cookie: scopedAdminCookie } }));
    assert.equal(adminProfilesRes.status, 200);
    const adminProfiles = await responseJson(adminProfilesRes);
    assert.deepEqual(adminProfiles.profiles.map((profile) => profile.id), ['sensgift']);
    const adminModelsRes = await modelsRoute.GET(routeRequest('/api/deck/models?profile=sensgift', { headers: { cookie: scopedAdminCookie } }));
    assert.equal(adminModelsRes.status, 200);
    const callsBeforeAdminForbidden = calls.length;
    const adminUnassignedSessionsRes = await sessionsRoute.GET(routeRequest('/api/deck/sessions?profile=unassigned', { headers: { cookie: scopedAdminCookie } }));
    assert.equal(adminUnassignedSessionsRes.status, 403);
    assert.equal(calls.slice(callsBeforeAdminForbidden).some((call) => call.url.includes('18649')), false, 'admin forbidden profiles must not call corresponding upstream APIs');

    const visibleProfilesRes = await profilesRoute.GET(routeRequest('/api/deck/profiles', { headers: { cookie: activeCookie } }));
    assert.equal(visibleProfilesRes.status, 200);
    const visibleProfiles = await responseJson(visibleProfilesRes);
    assert.deepEqual(visibleProfiles.profiles.map((profile) => profile.id), ['sensgift']);

    const modelsRes = await modelsRoute.GET(routeRequest('/api/deck/models?profile=sensgift', { headers: { cookie: activeCookie } }));
    assert.equal(modelsRes.status, 200);
    const modelPayload = await responseJson(modelsRes);
    assert.equal(modelPayload.providers[0].models[0].id, 'sensgift-model');
    assert.equal(calls.find((call) => call.url === 'http://127.0.0.1:18648/v1/models')?.auth, 'Bearer sensgift-secret');

    const sessionsRes = await sessionsRoute.GET(routeRequest('/api/deck/sessions?profile=sensgift', { headers: { cookie: activeCookie } }));
    assert.equal(sessionsRes.status, 200);
    const sessionsPayload = await responseJson(sessionsRes);
    assert.deepEqual(sessionsPayload.sessions.map((row) => row.id), ['sensgift-session-1']);
    assert.deepEqual(sessionsPayload.sessions.map((row) => row.profileId), ['sensgift']);

    const callsBeforeForbidden = calls.length;
    const defaultModelsRes = await modelsRoute.GET(routeRequest('/api/deck/models?profile=default', { headers: { cookie: activeCookie } }));
    assert.equal(defaultModelsRes.status, 403);
    const unassignedSessionsRes = await sessionsRoute.GET(routeRequest('/api/deck/sessions?profile=unassigned', { headers: { cookie: activeCookie } }));
    assert.equal(unassignedSessionsRes.status, 403);
    assert.equal(calls.slice(callsBeforeForbidden).some((call) => call.url.includes('18642') || call.url.includes('18649')), false, 'forbidden profiles must not call corresponding upstream APIs');

    const disableRes = await adminUserRoute.PATCH(
      jsonRouteRequest(`/api/deck/admin/users/${encodeURIComponent(registered.user.id)}`, 'PATCH', { status: 'disabled' }, { cookie: adminCookie }),
      { params: Promise.resolve({ id: encodeURIComponent(registered.user.id) }) },
    );
    assert.equal(disableRes.status, 200);
    const disabled = await responseJson(disableRes);
    assert.equal(disabled.user.status, 'disabled');

    const disabledProfilesRes = await profilesRoute.GET(routeRequest('/api/deck/profiles', { headers: { cookie: activeCookie } }));
    assert.equal(disabledProfilesRes.status, 403);
    const disabledLoginRes = await loginRoute.POST(jsonRouteRequest('/api/deck/auth/login', 'POST', {
      username: 'fresh-user',
      password: 'fresh-password-123',
    }));
    assert.equal(disabledLoginRes.status, 401);
    assert.equal(sessionCookieValue(disabledLoginRes), '');
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
    if (oldHermesApiBase === undefined) delete process.env.HERMES_API_BASE;
    else process.env.HERMES_API_BASE = oldHermesApiBase;
    if (oldAuthDir === undefined) delete process.env.HERMESDECK_AUTH_DIR;
    else process.env.HERMESDECK_AUTH_DIR = oldAuthDir;
  }
});

test('session and stats routes preserve profile-routing errors instead of generic fetch failures', () => {
  const messagesRouteSource = readFileSync(resolve('src/app/api/deck/sessions/[id]/messages/route.ts'), 'utf8');
  const statsRouteSource = readFileSync(statsRoutePath, 'utf8');
  for (const source of [messagesRouteSource, statsRouteSource]) {
    assert.match(source, /SessionProfileRoutingError/);
    assert.match(source, /err instanceof SessionProfileRoutingError/);
    assert.match(source, /error: err\.code/);
    assert.match(source, /status: err\.status/);
  }
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
  assert.match(modelsSource, /readProfileRuntimeConfig\(profile\)/);
  assert.doesNotMatch(modelsSource, /localModelCatalogForProfile|state\.db|execFileAsync|spawn\(|runPythonOr/);
  assert.match(modelsSource, /extractModelItems/);
  assert.match(modelsSource, /if \(!modelItems\.length\) \{[\s\S]*providers: \[\],[\s\S]*orphanModels: \[\],[\s\S]*reasoningEffort,[\s\S]*reasoningLevels,[\s\S]*\}/);
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
  assert.match(profilesRoute, /profiles_fetch_failed|Unable to validate Agent assignments/);
  assert.match(deckProfilesRoute, /profiles_fetch_failed/);
  assert.match(deckProfilesRoute, /isSuperAdminRole\(auth\.user\.role\)[\s\S]*getStrictProfiles\(\)[\s\S]*getAssignedRoutableProfiles\(auth\.user\.assignedProfileIds\)/);
  assert.doesNotMatch(deckProfilesRoute, /getProfiles\(\)/);
  assert.match(profilesSource, /getAssignedRoutableProfiles/);
  assert.match(profilesSource, /ADMIN_CATALOG_LOCAL_PROFILE_LIMIT\s*=\s*64/);
  assert.match(profilesSource, /getHermesApiBase\(profileId\)/);
  assert.doesNotMatch(profilesSource, /readdirSync|opendirSync|scandir|recursive:\s*true/);
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
  assert.match(strictProfileBlock, /const candidates: DeckProfile\[\]\[\] = \[\]/);
  assert.match(strictProfileBlock, /item\.length > winner\.length/);
  assert.match(strictProfileBlock, /Hermes Agent profile list unavailable/);
  assert.doesNotMatch(strictProfileBlock, /execFileAsync\(|runPythonOr\(|id: 'default'|getProfileActivity/);
  assert.doesNotMatch(profilesSource, /export const getProfiles\b/);
});

test('profile catalog UI does not fabricate a default-only list for admin outage mode', () => {
  const providerSource = readFileSync(resolve('src/lib/profile-context.tsx'), 'utf8');
  const chipSource = readFileSync(resolve('src/components/ProfileChip.tsx'), 'utf8');

  assert.match(providerSource, /catalogError: string \| null/);
  assert.match(providerSource, /setProfiles\(\[\]\);\s*setCatalogError/);
  assert.doesNotMatch(providerSource, /setProfiles\(\[\{ id, name: id, active: true, toolsets: \[\] \}\]\)/);
  assert.match(chipSource, /catalogUnavailable/);
  assert.match(chipSource, /catalogError \? t\.catalogUnavailable : t\.empty/);
});

test('settings page includes admin-only user management UI with immutable super_admin copy', () => {
  const source = readFileSync(resolve('src/components/AdminUsersPanel.tsx'), 'utf8');
  assert.match(source, /\/api\/deck\/admin\/users/);
  assert.match(source, /\/api\/deck\/profiles/);
  assert.match(source, /canManageUsers/);
  assert.match(source, /immutable super_admin/i);
  assert.match(source, /Approve/);
  assert.match(source, /Assign Agents/);
  assert.match(source, /profileCatalogWarning/);
  assert.match(source, /user approvals remain available/i);
  assert.match(source, /Profile assignment must stay fail-closed/);
});

test('phase 6 UI gates local-management navigation by super_admin capability', () => {
  const shellSource = readFileSync(resolve('src/components/AppShell.tsx'), 'utf8');
  const paletteSource = readFileSync(resolve('src/components/CommandPalette.tsx'), 'utf8');
  const dashboardSource = readFileSync(resolve('src/app/page.tsx'), 'utf8');

  assert.match(shellSource, /useDeckSession\(\)/);
  assert.match(shellSource, /canUseTerminal/);
  assert.match(shellSource, /n\.key === 'terminal'[\s\S]*!canUseTerminal/);
  assert.match(shellSource, /n\.key === 'config'[\s\S]*!canUseTerminal/);
  assert.match(shellSource, /n\.key === 'lcm'[\s\S]*!canUseTerminal/);

  assert.match(paletteSource, /useDeckSession\(\)/);
  assert.match(paletteSource, /item\.id === 'p:terminal'[\s\S]*!canUseTerminal/);
  assert.match(paletteSource, /item\.id === 'p:config'[\s\S]*!canUseTerminal/);
  assert.match(paletteSource, /item\.id === 'p:lcm'[\s\S]*!canUseTerminal/);
  assert.doesNotMatch(paletteSource, /id: 'p:kanban'/);
  assert.doesNotMatch(paletteSource, /id: 'p:runs'/);
  assert.match(paletteSource, /id: 'p:lcm'/);
  assert.match(paletteSource, /const loadSeqRef = useRef\(0\)/);
  assert.match(paletteSource, /const profileForLoad = activeProfile/);
  assert.match(paletteSource, /if \(loadSeqRef\.current !== seq\) return/);
  assert.match(paletteSource, /profileForLoad \? deckApi\.tools\(profileForLoad\) : Promise\.resolve\(\{ tools: \[\] \}\)/);
  assert.doesNotMatch(paletteSource, /deckApi\.runs/);

  assert.match(dashboardSource, /useDeckSession\(\)/);
  assert.match(dashboardSource, /canUseTerminal[\s\S]*\/terminal/);
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
  assert.match(contextSource, /isAdminSession\(session\)[\s\S]*adminEmergencyProfileId/);
  assert.match(contextSource, /This is not a local catalog fallback/);
  assert.match(contextSource, /isAdminSession\(session\)[\s\S]*setProfiles\(\[\]\);[\s\S]*setCatalogError/);
  assert.match(contextSource, /catch \(err\) \{[\s\S]*setProfiles\(\[\]\);[\s\S]*setActiveProfileState\(NO_PROFILE\)/);
  assert.match(contextSource, /setProfilesLoaded\(true\)/);
  assert.match(contextSource, /const setActiveProfile = useCallback\([\s\S]*profilesLoaded && profiles\.length === 0[\s\S]*removeStoredProfile\(\)[\s\S]*return NO_PROFILE/);
  assert.match(contextSource, /const onStorage = \(e: StorageEvent\) => \{[\s\S]*if \(!e\.newValue\) \{[\s\S]*setActiveProfileState\(NO_PROFILE\)/);
  assert.match(contextSource, /const onStorage = \(e: StorageEvent\) => \{[\s\S]*profilesLoaded && profiles\.length === 0[\s\S]*removeStoredProfile\(\)[\s\S]*return NO_PROFILE/);
  assert.match(contextSource, /if \(!profilesLoaded\) \{[\s\S]*pendingStoredProfileRef\.current = e\.newValue;[\s\S]*return NO_PROFILE/);
  assert.match(profileChipSource, /activeMeta\?\.name \|\| \(catalogError && activeProfile \? activeProfile : \(loading \? t\.loading : t\.label\)\)/);
  assert.match(profileChipSource, /catalogError \? t\.catalogUnavailable : t\.empty/);
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
  assert.match(source, /requireAdmin/);
  assert.match(source, /const auth = requireAdmin\(req\);/);
  assert.match(source, /requireProfileAccess\(auth\.user, profile\)/);
  assert.match(source, /isSuperAdminRole\(auth\.user\.role\)/);
  assert.doesNotMatch(source, /getTokenStats\(days\)[\s\S]*requireAdmin\(req\)/);
});

test('token analytics route checks scoped admin profile access before unavailable fallback', async () => {
  const home = makeHome();
  let auth = await loadAuth(home);
  const store = withSuppressedBootstrapLog(() => auth.readAuth());
  const superAdmin = Object.values(store.users)[0];
  const now = new Date().toISOString();
  const admin = {
    id: 'token_admin',
    username: 'token-admin',
    role: 'admin',
    status: 'active',
    ...auth.createPasswordRecord('token-admin-password-123'),
    assignedProfileIds: ['agent-a'],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: superAdmin.id,
  };
  writeStore(home, { ...store, users: { ...store.users, [admin.id]: admin } });
  auth = await loadAuth(home);
  const token = auth.issueSessionToken(admin.id);
  const route = await import(`${pathToFileURL(tokenRoutePath).href}?case=${Date.now()}-${importNonce++}`);
  const req = (profile) => new NextRequest(`https://deck.example.test/api/deck/tokens?days=7${profile ? `&profile=${profile}` : ''}`, {
    headers: { cookie: `hermesdeck_session=${encodeURIComponent(token)}` },
  });

  const globalDenied = await route.GET(req());
  assert.equal(globalDenied.status, 403);

  const profileDenied = await route.GET(req('agent-b'));
  assert.equal(profileDenied.status, 403);

  const unavailable = await route.GET(req('agent-a'));
  assert.equal(unavailable.status, 200);
  const body = await unavailable.json();
  assert.equal(body.unavailableReason.includes('does not currently expose token analytics'), true);
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

test('local filesystem and LCM management routes require super_admin', () => {
  const lcmSource = readFileSync(lcmRoutePath, 'utf8');
  const configSource = readFileSync(configRoutePath, 'utf8');
  const skillsSource = readFileSync(skillsRoutePath, 'utf8');
  const liveTerminalSources = [
    'src/app/api/deck/term/sessions/route.ts',
    'src/app/api/deck/term/sessions/[id]/route.ts',
    'src/app/api/deck/term/sessions/[id]/resize/route.ts',
    'src/app/api/deck/term/sessions/[id]/windows/route.ts',
    'src/app/api/deck/term/sessions/[id]/tmux/route.ts',
    'src/app/api/deck/term/sessions/[id]/stream/route.ts',
    'src/app/api/deck/term/sessions/[id]/input/route.ts',
  ].map((path) => readFileSync(resolve(path), 'utf8'));
  const cacheImageSource = readFileSync(cacheImageRoutePath, 'utf8');
  const swSource = readFileSync(serviceWorkerPath, 'utf8');
  const shellSource = readFileSync(resolve('src/components/AppShell.tsx'), 'utf8');
  for (const source of [lcmSource, configSource, skillsSource, ...liveTerminalSources]) {
    assert.match(source, /requireSuperAdmin\(req\)/);
    assert.doesNotMatch(source, /requireAdmin\(req\)|requireAuth\(req\)|requireActiveUser\(req\)/);
  }
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
  assert.match(shellSource, /n\.key === 'lcm'[\s\S]*!canUseTerminal/);
});

test('tools discovery is Agent API-first and local fallback is super_admin-only', () => {
  const toolsModuleSource = readFileSync(hermesToolsModulePath, 'utf8');
  const toolsRouteSource = readFileSync(toolsRoutePath, 'utf8');
  const clientApiSource = readFileSync(clientApiPath, 'utf8');
  assert.match(toolsModuleSource, /hermesApiGet<unknown>\('\/v1\/skills'/);
  assert.match(toolsModuleSource, /hermesApiGet<unknown>\('\/v1\/toolsets'/);
  assert.match(toolsModuleSource, /indexSkillFiles\(\)/);
  assert.match(toolsRouteSource, /requireProfileAccess\(auth\.user, profile/);
  assert.match(toolsRouteSource, /allowLocalFallback: isSuperAdminRole\(auth\.user\.role\)/);
  assert.match(clientApiSource, /tools: \(profileId = 'default', signal\?: AbortSignal\)/);
  assert.doesNotMatch(clientApiSource, /tools: \(signal\?: AbortSignal\)/);
});

test('assigned named-profile users can fetch API-backed tools only for that profile', async () => {
  const home = makeHome();
  const profileId = `agent-tools-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const oldHome = process.env.HOME;
  const oldUserprofile = process.env.USERPROFILE;
  const oldAuthDir = process.env.HERMESDECK_AUTH_DIR;
  const oldHermesHome = process.env.HERMES_HOME;
  const originalFetch = globalThis.fetch;
  try {
    const auth = await loadAuth(home);
    const store = withSuppressedBootstrapLog(() => auth.readAuth());
    const superAdmin = Object.values(store.users)[0];
    const now = new Date().toISOString();
    const user = {
      id: 'named_tools_user',
      username: 'named-tools-user',
      role: 'user',
      status: 'active',
      ...auth.createPasswordRecord('named-tools-password-123'),
      assignedProfileIds: [profileId],
      preferences: { profiles: {} },
      createdAt: now,
      updatedAt: now,
      approvedAt: now,
      approvedBy: superAdmin.id,
    };
    writeStore(home, { ...store, users: { ...store.users, [user.id]: user } });
    mkdirSync(join(home, '.hermes', 'profiles', profileId), { recursive: true });
    writeFileSync(join(home, '.hermes', 'profiles', profileId, '.env'), 'HERMES_API_BASE=http://127.0.0.1:18642\nAPI_SERVER_KEY=named-profile-key\n');
    process.env.HERMES_HOME = join(home, '.hermes');
    const cookie = cookieHeader(auth.issueSessionToken(user.id));
    const calls = [];
    globalThis.fetch = async (url) => {
      const href = String(url);
      calls.push(href);
      if (href.endsWith('/v1/skills')) return Response.json({ skills: [{ name: 'named-skill', category: 'research' }] });
      if (href.endsWith('/v1/toolsets')) return Response.json({ toolsets: [{ name: 'named-toolset', enabled: true }] });
      return new Response('not found', { status: 404 });
    };
    const route = await loadRouteModule(toolsRoutePath);

    const allowed = await route.GET(routeRequest(`/api/deck/tools?profile=${encodeURIComponent(profileId)}`, { headers: { cookie } }));
    assert.equal(allowed.status, 200);
    const allowedBody = await responseJson(allowed);
    assert.deepEqual(allowedBody.tools.map((tool) => tool.name).sort(), ['named-skill', 'named-toolset']);
    assert.deepEqual(calls.map((href) => new URL(href).pathname).sort(), ['/v1/skills', '/v1/toolsets']);

    calls.length = 0;
    const bareDefault = await route.GET(routeRequest('/api/deck/tools', { headers: { cookie } }));
    assert.equal(bareDefault.status, 403);
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.HOME = oldHome;
    process.env.USERPROFILE = oldUserprofile;
    if (oldAuthDir === undefined) delete process.env.HERMESDECK_AUTH_DIR;
    else process.env.HERMESDECK_AUTH_DIR = oldAuthDir;
    if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHermesHome;
  }
});

test('admin users are denied local config skill and LCM routes', async () => {
  const home = makeHome();
  const auth = await loadAuth(home);
  const store = withSuppressedBootstrapLog(() => auth.readAuth());
  const superAdmin = Object.values(store.users)[0];
  const now = new Date().toISOString();
  const admin = {
    id: 'local_admin_denied',
    username: 'local-admin-denied',
    role: 'admin',
    status: 'active',
    ...auth.createPasswordRecord('admin-password-123'),
    assignedProfileIds: ['default'],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: superAdmin.id,
  };
  writeStore(home, { ...store, users: { ...store.users, [admin.id]: admin } });
  const cookie = cookieHeader(auth.issueSessionToken(admin.id));
  const [configRoute, skillsRoute, lcmRoute] = await Promise.all([
    loadRouteModule(configRoutePath),
    loadRouteModule(skillsRoutePath),
    loadRouteModule(lcmRoutePath),
  ]);

  assert.equal((await configRoute.GET(routeRequest('/api/deck/config?profile=default', { headers: { cookie } }))).status, 403);
  assert.equal((await skillsRoute.GET(routeRequest('/api/deck/skills?path=foo/SKILL.md', { headers: { cookie } }))).status, 403);
  assert.equal((await lcmRoute.GET(routeRequest('/api/deck/lcm', { headers: { cookie } }))).status, 403);
});

test('service worker shell excludes protected routes and navigation cache fallbacks', () => {
  const swSource = readFileSync(serviceWorkerPath, 'utf8');
  const appShellMatch = swSource.match(/const\s+APP_SHELL\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(appShellMatch);
  const appShell = appShellMatch[1];
  for (const route of ['/', '/chat', '/chat?source=pwa', '/profiles', '/cron', '/tools', '/terminal', '/config', '/lcm', '/settings']) {
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
  assert.match(cronSource, /profile_routing_unavailable/);
  assert.match(cronSource, /cron_profile_mismatch/);
  assert.match(cronSource, /routed_profile_id/);
  assert.match(cronSource, /routing\.profile_id/);
  assert.match(cronSource, /return true/);
  assert.match(routeSource, /err instanceof CronProfileRoutingError/);
  assert.match(routeSource, /error: err\.code/);
  assert.match(routeSource, /status: err\.status/);
  assert.match(routeSource, /cron_fetch_failed/);
});

test('API-only runtime helpers no longer use direct runtime storage or Hermes CLI probes', () => {
  const helperPaths = [
    'src/lib/server/hermes/sessions.ts',
    'src/lib/server/hermes/messages.ts',
    'src/lib/server/hermes/stats.ts',
    'src/lib/server/hermes/tokens.ts',
    'src/lib/server/hermes/tools.ts',
    'src/lib/server/hermes/models.ts',
    'src/lib/server/hermes/health.ts',
  ];
  const combined = helperPaths.map((p) => readFileSync(resolve(p), 'utf8')).join('\n');
  assert.doesNotMatch(combined, /state\.db|sqlite3|pathlib\.Path\.home\(\)|execFileAsync\(['\"]hermes['\"]|spawn\(['\"]hermes['\"]|config\.yaml|profiles\/<id>|lcm\.db|kanban\.db|hermes kanban|runPython|node:fs|homedir\(\)|HERMES_DASHBOARD_BASE/);
  const profilesSource = readFileSync(resolve('src/lib/server/hermes/profiles.ts'), 'utf8');
  assert.doesNotMatch(profilesSource, /state\.db|sqlite3|pathlib\.Path\.home\(\)|execFileAsync\(['\"]hermes['\"]|spawn\(['\"]hermes['\"]|config\.yaml|profiles\/<id>|lcm\.db|kanban\.db|hermes kanban|runPython|HERMES_DASHBOARD_BASE/);
  assert.match(readFileSync(resolve('src/lib/server/hermes/models.ts'), 'utf8'), /\/v1\/models/);
  assert.match(profilesSource, /\/v1\/profiles/);
  assert.match(readFileSync(resolve('src/lib/server/hermes/sessions.ts'), 'utf8'), /\/api\/sessions\?/);
  assert.match(readFileSync(resolve('src/lib/server/hermes/messages.ts'), 'utf8'), /\/api\/sessions\/\$\{encodeURIComponent\(trimmedSessionId\)\}\/messages/);
  assert.match(readFileSync(resolve('src/lib/server/hermes/stats.ts'), 'utf8'), /getSessionsForStats/);
  assert.match(readFileSync(resolve('src/lib/server/hermes/lcm.ts'), 'utf8'), /read-only adapter over hermes-lcm's existing on-disk SQLite state/);
  assert.doesNotMatch(readFileSync(resolve('src/lib/server/hermes/health.ts'), 'utf8'), /9120|\/api\/sessions|Dashboard sidecar|HERMES_DASHBOARD_BASE/);
});


const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32decode(value) {
  let bits = 0, acc = 0;
  const out = [];
  for (const ch of value.toUpperCase().replace(/=|\s/g, '')) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('bad base32');
    acc = (acc << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((acc >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret, now = Date.now()) {
  const counter = Math.floor(now / 30000);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac('sha1', b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 255) << 16) | ((h[o + 2] & 255) << 8) | (h[o + 3] & 255);
  return String(n % 1000000).padStart(6, '0');
}
async function loadRoute(routePath) {
  return import(`${pathToFileURL(routePath).href}?case=${Date.now()}-${importNonce++}`);
}
async function loadRouteCase(routePath, caseTag) {
  return import(`${pathToFileURL(routePath).href}?case=${caseTag}`);
}
function makeJsonRequest(url, body, cookie) {
  const headers = { origin: 'https://deck.example.test', 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return new NextRequest(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

test('TOTP MFA enrollment gates login session issuance until second factor succeeds', async () => {
  process.env.HERMESDECK_PUBLIC_ORIGIN = 'https://deck.example.test';
  const home = makeHome();
  const auth = await loadAuth(home);
  let store = withSuppressedBootstrapLog(() => auth.readAuth());
  const user = Object.values(store.users)[0];
  const password = 'mfa-password-123';
  const freshCreds = auth.createPasswordRecord(password, user.passwordVersion + 1);
  writeStore(home, { ...store, users: { ...store.users, [user.id]: { ...user, ...freshCreds, bootstrap: undefined } } });
  const sessionCookie = `hermesdeck_session=${auth.issueSessionToken(user.id)}`;
  const mfaRoute = await loadRoute(mfaRoutePath);

  let res = await mfaRoute.POST(makeJsonRequest('https://deck.example.test/api/deck/auth/mfa', { action: 'totp-enroll-start', currentPassword: 'wrong' }, sessionCookie));
  assert.equal(res.status, 401);
  res = await mfaRoute.POST(makeJsonRequest('https://deck.example.test/api/deck/auth/mfa', { action: 'totp-enroll-start', currentPassword: password }, sessionCookie));
  assert.equal(res.status, 200);
  const start = await res.json();
  assert.match(start.secret, /^[A-Z2-7]+$/);
  assert.match(start.otpauth, /^otpauth:\/\/totp\//);
  assert.match(start.qrDataUrl, /^data:image\/png;base64,/);
  res = await mfaRoute.POST(makeJsonRequest('https://deck.example.test/api/deck/auth/mfa', { action: 'totp-enroll-confirm', currentPassword: password, secret: start.secret, code: totp(start.secret) }, sessionCookie));
  assert.equal(res.status, 200);

  const loginRoute = await loadRoute(loginRoutePath);
  res = await loginRoute.POST(makeJsonRequest('https://deck.example.test/api/deck/auth/login', { username: user.username, password }));
  assert.equal(res.status, 200);
  assert.equal(res.cookies.get('hermesdeck_session'), undefined);
  const login = await res.json();
  assert.equal(login.mfaRequired, true);
  assert.equal(login.factors.totp, true);
});

test('passkey registration options do not require TOTP enrollment', async () => {
  const home = makeHome();
  const auth = await loadAuth(home);
  const store = withSuppressedBootstrapLog(() => auth.readAuth());
  const user = Object.values(store.users)[0];
  const password = 'passkey-only-password-123';
  writeStore(home, { ...store, users: { ...store.users, [user.id]: { ...user, ...auth.createPasswordRecord(password, user.passwordVersion + 1), mfa: undefined, bootstrap: undefined } } });
  const sessionCookie = `hermesdeck_session=${auth.issueSessionToken(user.id)}`;
  const mfaRoute = await loadRoute(mfaRoutePath);

  const res = await mfaRoute.POST(makeJsonRequest('https://deck.example.test/api/deck/auth/mfa', { action: 'passkey-register-options', currentPassword: password, name: 'Passkey' }, sessionCookie));
  const body = await res.json();
  assert.equal(res.status, 200, body.error);
  assert.equal(typeof body.challengeId, 'string');
  assert.equal(typeof body.options?.challenge, 'string');
});

test('TOTP MFA rate limit survives freshly minted pre-auth tokens', async () => {
  const home = makeHome();
  const auth = await loadAuth(home);
  const store = withSuppressedBootstrapLog(() => auth.readAuth());
  const user = Object.values(store.users)[0];
  const userId = `mfa_rate_${Date.now()}`;
  const username = `mfa-rate-${Date.now()}`;
  const password = 'mfa-rate-password-123';
  const secret = 'JBSWY3DPEHPK3PXP';
  writeStore(home, {
    ...store,
    users: {
      [userId]: {
        ...user,
        id: userId,
        username,
        ...auth.createPasswordRecord(password, user.passwordVersion + 1),
        mfa: { totp: { enabled: true, secret, enabledAt: new Date().toISOString() } },
        bootstrap: undefined,
      },
    },
  });
  const caseTag = `${Date.now()}-${importNonce++}`;
  const loginRoute = await loadRouteCase(loginRoutePath, caseTag);
  const mfaRoute = await loadRouteCase(mfaRoutePath, caseTag);
  let mfaToken = '';
  for (let i = 0; i < 6; i++) {
    if (i % 3 === 0) {
      const okLogin = await loginRoute.POST(makeJsonRequest('https://deck.example.test/api/deck/auth/login', { username, password }));
      assert.equal(okLogin.status, 200);
      mfaToken = (await okLogin.json()).mfaToken;
    }
    const res = await mfaRoute.POST(makeJsonRequest('https://deck.example.test/api/deck/auth/mfa', { action: 'login-totp', mfaToken, code: '000000' }));
    assert.equal(res.status, 401);
  }
  const loginRes = await loginRoute.POST(makeJsonRequest('https://deck.example.test/api/deck/auth/login', { username, password }));
  const freshToken = (await loginRes.json()).mfaToken;
  const blocked = await mfaRoute.POST(makeJsonRequest('https://deck.example.test/api/deck/auth/mfa', { action: 'login-totp', mfaToken: freshToken, code: '000000' }));
  assert.equal(blocked.status, 429);
});

test('WebAuthn challenge IDs cannot be used as password MFA tokens', async () => {
  const home = makeHome();
  const auth = await loadAuth(home);
  const store = withSuppressedBootstrapLog(() => auth.readAuth());
  const user = Object.values(store.users)[0];
  const userId = `mfa_purpose_${Date.now()}`;
  const username = `mfa-purpose-${Date.now()}`;
  const password = 'mfa-purpose-password-123';
  const secret = 'JBSWY3DPEHPK3PXP';
  writeStore(home, {
    ...store,
    users: {
      [userId]: {
        ...user,
        id: userId,
        username,
        ...auth.createPasswordRecord(password, user.passwordVersion + 1),
        mfa: {
          totp: { enabled: true, secret, enabledAt: new Date().toISOString() },
          passkeys: [{ id: 'fake-passkey', publicKey: Buffer.from('fake-public-key').toString('base64url'), counter: 0, createdAt: new Date().toISOString() }],
        },
        bootstrap: undefined,
      },
    },
  });
  const caseTag = `${Date.now()}-${importNonce++}`;
  const loginRoute = await loadRouteCase(loginRoutePath, caseTag);
  const mfaRoute = await loadRouteCase(mfaRoutePath, caseTag);
  const loginRes = await loginRoute.POST(makeJsonRequest('https://deck.example.test/api/deck/auth/login', { username, password }));
  assert.equal(loginRes.status, 200);
  const login = await loginRes.json();
  const optionsRes = await mfaRoute.POST(makeJsonRequest('https://deck.example.test/api/deck/auth/mfa', { action: 'passkey-login-options', mfaToken: login.mfaToken }));
  const options = await optionsRes.json();
  assert.equal(optionsRes.status, 200, options.error);
  const { challengeId } = options;
  const res = await mfaRoute.POST(makeJsonRequest('https://deck.example.test/api/deck/auth/mfa', { action: 'login-totp', mfaToken: challengeId, code: totp(secret) }));
  assert.equal(res.status, 401);
  assert.equal(res.cookies.get('hermesdeck_session'), undefined);
});
