import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { register as registerLoader } from 'node:module';
import { NextRequest } from 'next/server.js';

registerLoader('./route-loader.mjs', import.meta.url);

const authModuleUrl = pathToFileURL(resolve('src/lib/server/auth.ts')).href;
const clientMetaModuleUrl = pathToFileURL(resolve('src/lib/session-meta.ts')).href;
const metadataModuleUrl = pathToFileURL(resolve('src/lib/server/session-metadata.ts')).href;
const routeModuleUrl = pathToFileURL(resolve('src/app/api/deck/session-meta/route.ts')).href;
let nonce = 0;

function makeHome() {
  return mkdtempSync(join(tmpdir(), 'hermesdeck-session-meta-'));
}

function configureHome(home) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.HERMESDECK_AUTH_DIR = join(home, '.hermesdeck');
  process.env.HERMESDECK_DATA_DIR = join(home, '.hermesdeck');
  process.env.HERMESDECK_PUBLIC_ORIGIN = 'https://deck.example.test';
}

async function loadAuth(home) {
  configureHome(home);
  return import(`${authModuleUrl}?case=${Date.now()}-${nonce++}`);
}

async function loadClientMeta(home) {
  configureHome(home);
  return import(`${clientMetaModuleUrl}?case=${Date.now()}-${nonce++}`);
}

async function loadMetadata(home) {
  configureHome(home);
  return import(`${metadataModuleUrl}?case=${Date.now()}-${nonce++}`);
}

async function loadRoute(home) {
  configureHome(home);
  return import(`${routeModuleUrl}?case=${Date.now()}-${nonce++}`);
}

async function issueSuperAdminToken(home) {
  const auth = await loadAuth(home);
  const store = await auth.ensureAuthInitialized();
  const [user] = Object.values(store.users);
  return { token: auth.issueSessionToken(user.id), userId: user.id };
}

function request(url, token, { method = 'GET', body, origin = 'https://deck.example.test' } = {}) {
  const headers = new Headers({ cookie: `hermesdeck_session=${encodeURIComponent(token)}` });
  if (origin !== undefined && origin !== null) headers.set('origin', origin);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function authFile(home) {
  return join(home, '.hermesdeck', 'auth.json');
}

function writeStore(home, store) {
  mkdirSync(join(home, '.hermesdeck'), { recursive: true, mode: 0o700 });
  writeFileSync(authFile(home), JSON.stringify(store, null, 2), { mode: 0o600 });
}

test('client metadata helpers keep goals browser-local across server sync', async () => {
  const home = makeHome();
  const clientMeta = await loadClientMeta(home);
  const local = {
    version: 1,
    folders: [{ id: 'local-folder', name: 'Local Folder', createdAt: '2026-06-25T00:00:00.000Z' }],
    byId: {
      s1: {
        pinned: true,
        customTitle: 'Local title',
        goal: { text: 'Finish the report', setAt: '2026-06-25T00:00:00.000Z' },
      },
      s2: {
        goal: { text: 'Browser-only goal', setAt: '2026-06-25T00:00:00.000Z', pausedAt: '2026-06-25T01:00:00.000Z' },
      },
    },
  };

  const serverPayload = clientMeta.serverBackedMetaStore(local);
  assert.equal(serverPayload.byId.s1.goal, undefined);
  assert.equal(serverPayload.byId.s1.customTitle, 'Local title');
  assert.equal(serverPayload.byId.s2, undefined);

  const hydrated = clientMeta.mergeServerMetaPreservingLocalGoals({
    version: 1,
    folders: [{ id: 'server-folder', name: 'Server Folder', createdAt: '2026-06-25T00:00:00.000Z' }],
    byId: { s1: { pinned: false, customTitle: 'Server title' } },
  }, local);
  assert.equal(hydrated.byId.s1.customTitle, 'Server title');
  assert.deepEqual(hydrated.byId.s1.goal, local.byId.s1.goal);
  assert.deepEqual(hydrated.byId.s2.goal, local.byId.s2.goal);
  assert.equal(hydrated.folders[0].id, 'server-folder');
});

test('session metadata store is scoped by Deck user and profile and sanitizes unbounded fields', async () => {
  const home = makeHome();
  const metadata = await loadMetadata(home);
  const meta = {
    version: 1,
    folders: [
      { id: 'work', name: 'Work', createdAt: '2026-06-25T00:00:00.000Z' },
      { id: 'work', name: 'Duplicate' },
    ],
    byId: {
      s1: {
        pinned: true,
        folderId: 'work',
        archived: true,
        archivedAt: '2026-06-25T00:00:00.000Z',
        customTitle: 'A'.repeat(300),
        tags: ['one', 'ONE', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'],
        goal: { text: 'Do not persist to server', setAt: '2026-06-25T00:00:00.000Z' },
      },
      missing: { pinned: true },
    },
  };

  const saved = metadata.putSessionMetaStore('user-a', 'default', meta, ['s1']);
  assert.equal(saved.folders.length, 1);
  assert.equal(saved.byId.s1.pinned, true);
  assert.equal(saved.byId.s1.folderId, 'work');
  assert.equal(saved.byId.s1.customTitle.length, 160);
  assert.deepEqual(saved.byId.s1.tags, ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']);
  assert.equal(saved.byId.s1.goal, undefined);
  assert.equal(saved.byId.missing, undefined);

  const overlaid = metadata.overlaySessionMetadata([
    { id: 's1', profileId: 'default', title: 'Original', source: 'api_server' },
  ], saved);
  assert.equal(overlaid[0].title, saved.byId.s1.customTitle);
  assert.equal(overlaid[0].pinned, true);
  assert.equal(overlaid[0].archived, true);
  assert.deepEqual(overlaid[0].tags, saved.byId.s1.tags);

  assert.equal(metadata.getSessionMetaStore('user-b', 'default').byId.s1, undefined);
  assert.equal(metadata.getSessionMetaStore('user-a', 'other').byId.s1, undefined);
});

test('session-meta route enforces CSRF/profile auth and persists server-side metadata', async () => {
  const home = makeHome();
  const { token } = await issueSuperAdminToken(home);
  const route = await loadRoute(home);

  const blocked = await route.PUT(request('https://deck.example.test/api/deck/session-meta', token, {
    method: 'PUT',
    origin: 'https://evil.example.test',
    body: { profileId: 'default', metaStore: { version: 1, folders: [], byId: {} } },
  }));
  assert.equal(blocked.status, 403);

  const put = await route.PUT(request('https://deck.example.test/api/deck/session-meta', token, {
    method: 'PUT',
    body: {
      profileId: 'default',
      metaStore: {
        version: 1,
        folders: [{ id: 'folder1', name: 'Folder 1', createdAt: '2026-06-25T00:00:00.000Z' }],
        byId: {
          s1: {
            pinned: true,
            folderId: 'folder1',
            customTitle: 'Pinned title',
            tags: ['deck'],
            goal: { text: 'Browser local route goal', setAt: '2026-06-25T00:00:00.000Z' },
          },
        },
      },
    },
  }));
  assert.equal(put.status, 200);
  const putBody = await put.json();
  assert.equal(putBody.ok, true);
  assert.equal(putBody.metaStore.byId.s1.customTitle, 'Pinned title');
  assert.equal(putBody.metaStore.byId.s1.goal, undefined);

  const get = await route.GET(request('https://deck.example.test/api/deck/session-meta?profile=default', token));
  assert.equal(get.status, 200);
  const getBody = await get.json();
  assert.equal(getBody.metaStore.byId.s1.pinned, true);
  assert.equal(getBody.metaStore.folders[0].name, 'Folder 1');
});

test('session-meta route denies unassigned profile for ordinary users', async () => {
  const home = makeHome();
  const auth = await loadAuth(home);
  const store = await auth.ensureAuthInitialized();
  const superAdmin = Object.values(store.users)[0];
  const now = new Date().toISOString();
  const user = {
    id: 'ordinary-user',
    username: 'ordinary-user',
    role: 'user',
    status: 'active',
    ...auth.createPasswordRecord('ordinary-password-123'),
    assignedProfileIds: ['default'],
    preferences: { profiles: {} },
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: superAdmin.id,
  };
  writeStore(home, { ...store, users: { ...store.users, [user.id]: user } });
  const token = auth.issueSessionToken(user.id);
  const route = await loadRoute(home);

  const denied = await route.GET(request('https://deck.example.test/api/deck/session-meta?profile=other', token));
  assert.equal(denied.status, 403);
});
