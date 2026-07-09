import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve('src/app/api/deck');
const publicRoutes = new Set([
  'auth/login/route.ts',
  'auth/logout/route.ts',
  'auth/register/route.ts',
  'auth/mfa/route.ts',
  'auth/session/route.ts',
]);

function routes(dir = root) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...routes(p));
    else if (name === 'route.ts') out.push(p);
  }
  return out;
}

test('/api/deck routes declare auth and mutating CSRF guards', () => {
  const missingAuth = [];
  const missingCsrf = [];
  for (const file of routes()) {
    const rel = relative(root, file);
    const src = readFileSync(file, 'utf8');
    if (publicRoutes.has(rel)) continue;
    // `proveCronJob()` is an indirect auth/profile-proof helper imported by cron sub-routes.
    if (!/require(?:Auth|Admin|SuperAdmin|ActiveUser|DeckUser|ProfileAccess)|verifySessionToken\(|proveCronJob\(|export \{ dynamic, GET \}/.test(src)) {
      missingAuth.push(rel);
    }
    if (/export async function (POST|PUT|PATCH|DELETE)/.test(src) && !/guardMutating|isSameOrigin\(/.test(src)) {
      missingCsrf.push(rel);
    }
  }
  assert.deepEqual(missingAuth, [], 'routes missing auth/profile guard');
  assert.deepEqual(missingCsrf, [], 'mutating routes missing CSRF/same-origin guard');
});
