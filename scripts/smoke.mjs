#!/usr/bin/env node
import { spawn } from 'node:child_process';

const host = '127.0.0.1';
const useWrapper = process.env.SMOKE_USE_WRAPPER === '1';
const port = Number(process.env.SMOKE_PORT || (useWrapper ? 6138 : 6128));
const legacyPort = Number(process.env.SMOKE_LEGACY_PORT || 6137);
const canonicalBase = `http://${host}:${port}`;
const legacyBase = `http://${host}:${legacyPort}`;
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 45_000);

const child = useWrapper
  ? spawn(process.execPath, ['scripts/dev-with-redirect.mjs', '--start'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HERMESDECK_LIVE_TERMINAL: '0',
        NEXT_TELEMETRY_DISABLED: '1',
        CANONICAL_PORT: String(port),
        LEGACY_PORT: String(legacyPort),
        NEXT_HOST: host,
        CANONICAL_HOST: host,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  : spawn('npx', ['next', 'start', '-H', host, '-p', String(port)], {
      cwd: process.cwd(),
      env: { ...process.env, HERMESDECK_LIVE_TERMINAL: '0', NEXT_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

let output = '';
child.stdout.on('data', (d) => { output += d; process.stdout.write(d); });
child.stderr.on('data', (d) => { output += d; process.stderr.write(d); });

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForReady(base = canonicalBase) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early with code ${child.exitCode}`);
    try {
      const res = await fetch(`${base}/login`, { redirect: 'manual' });
      if (res.status >= 200 && res.status < 500) return;
    } catch {}
    await sleep(500);
  }
  throw new Error(`server did not become ready within ${timeoutMs}ms\n${output.slice(-4000)}`);
}

async function check(base, path, accept) {
  const res = await fetch(`${base}${path}`, { redirect: 'manual' });
  const body = await res.text();
  if (!accept(res, body)) {
    throw new Error(`${base}${path} failed: status=${res.status}, content-type=${res.headers.get('content-type')}, body=${body.slice(0, 300)}`);
  }
  console.log(`[smoke] ${base}${path} OK (${res.status})`);
}

async function runCoreChecks(base) {
  await check(base, '/login', (res, body) => res.status === 200 && /HermesDeck|登录|Login/i.test(body));
  await check(base, '/offline', (res) => res.status === 200);
  await check(base, '/manifest.webmanifest', (res, body) => res.status === 200 && /HermesDeck/.test(body));
  await check(base, '/sw.js', (res, body) => res.status === 200 && /service worker|install|fetch/i.test(body));
  await check(base, '/', (res) => res.status === 307 || res.status === 308 || res.status === 200);
}

try {
  await waitForReady(canonicalBase);
  await runCoreChecks(canonicalBase);
  if (useWrapper) {
    await waitForReady(legacyBase);
    await check(legacyBase, '/login', (res, body) => res.status === 200 && /HermesDeck|登录|Login/i.test(body));
    await check(legacyBase, '/manifest.webmanifest', (res, body) => res.status === 200 && /HermesDeck/.test(body));
  }
  console.log('[smoke] all checks passed');
} finally {
  child.kill('SIGTERM');
  setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1000).unref();
}
