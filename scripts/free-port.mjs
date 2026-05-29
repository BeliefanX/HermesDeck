#!/usr/bin/env node
// Free a TCP port before starting the dev/prod server. HermesDeck is hard-pinned
// to 6118, but this script must not kill arbitrary user processes.
//
// Behavior:
//   - Resolve every PID listening on the requested port (lsof -ti:<port>).
//   - Only clear same-user processes whose cwd/command clearly identifies this
//     HermesDeck checkout or a Next process launched from it.
//   - Refuse and fail loudly for anything else so operators can inspect it.
//   - SIGTERM safe targets, wait briefly, then SIGKILL only those same safe PIDs.
//   - Exit 0 when the port was already free.
//
// Usage: node scripts/free-port.mjs <port>

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

const repoRoot = realpathSync(new URL('..', import.meta.url));

const port = Number(process.argv[2] || 6118);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`[free-port] invalid port: ${process.argv[2]}`);
  process.exit(2);
}

const myUid = typeof process.getuid === 'function' ? process.getuid() : -1;

function listListenPids(p) {
  try {
    const out = execFileSync('lsof', ['-ti', `tcp:${p}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split(/\s+/).map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

function uidOf(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'uid=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return Number(out.trim());
  } catch {
    return -1;
  }
}

function cmdOf(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim();
  } catch {
    return '<unknown>';
  }
}

function cwdOf(pid) {
  try {
    const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = out.split('\n').find((s) => s.startsWith('n'));
    return line ? realpathSync(line.slice(1)) : '';
  } catch {
    return '';
  }
}

function isSafeHermesDeckTarget({ cmd, cwd }) {
  const inRepo = cwd === repoRoot || cwd.startsWith(`${repoRoot}/`);
  const looksLikeNext = /(?:^|\s)(?:node|next)(?:\s|$)|next-server|node_modules\/next/i.test(cmd);
  const looksLikeHermesDeck = /HermesDeck|hermesdeck|dev-with-redirect\.mjs|next start|next dev/i.test(cmd);
  return inRepo && (looksLikeNext || looksLikeHermesDeck);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const initial = listListenPids(port);
if (initial.length === 0) {
  console.log(`[free-port] :${port} is already free.`);
  process.exit(0);
}

console.log(`[free-port] :${port} held by ${initial.length} pid(s) — clearing.`);
const safeTargets = [];
for (const pid of initial) {
  const u = uidOf(pid);
  const cmd = cmdOf(pid);
  const cwd = cwdOf(pid);
  if (myUid !== -1 && u !== -1 && u !== myUid) {
    console.error(`[free-port] refusing to kill pid=${pid} owned by uid=${u} (cmd: ${cmd})`);
    process.exit(1);
  }
  if (!isSafeHermesDeckTarget({ cmd, cwd })) {
    console.error(`[free-port] refusing to kill pid=${pid}; not clearly this HermesDeck/Next process (cwd: ${cwd || '<unknown>'}, cmd: ${cmd})`);
    console.error(`[free-port] stop it manually or choose a different port.`);
    process.exit(1);
  }
  safeTargets.push({ pid, cmd, cwd });
}

for (const { pid, cmd } of safeTargets) {
  console.log(`[free-port] SIGTERM pid=${pid} (${cmd.slice(0, 80)})`);
  try { process.kill(pid, 'SIGTERM'); } catch {}
}

await sleep(500);
let remaining = listListenPids(port);
if (remaining.length > 0) {
  const safePids = new Set(safeTargets.map(({ pid }) => pid));
  for (const pid of remaining) {
    if (!safePids.has(pid)) {
      console.error(`[free-port] refusing to SIGKILL new/unsafe pid=${pid} now holding :${port} (cmd: ${cmdOf(pid)})`);
      process.exit(1);
    }
    console.log(`[free-port] SIGKILL pid=${pid}`);
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  await sleep(250);
  remaining = listListenPids(port);
}

if (remaining.length > 0) {
  console.error(`[free-port] failed to free :${port} (still held by ${remaining.join(', ')})`);
  process.exit(1);
}
console.log(`[free-port] :${port} cleared.`);
