#!/usr/bin/env node
// Free a TCP port before starting the dev/prod server. HermesDeck is hard-pinned
// to 6118 — if something is already bound there (a stale npm run dev, a previous
// crash that left an orphan node process, the preview tooling, etc.) we'd rather
// kill the squatter than silently flip to a different port and confuse the LAN
// clients pointing at http://<host>:6118/.
//
// Behavior:
//   - Resolve every PID listening on the requested port (lsof -ti:<port>).
//   - Skip PIDs that are NOT us (different uid) — better to fail loudly than
//     SIGKILL someone else's process.
//   - SIGTERM each owned PID, wait briefly, then SIGKILL anything still holding
//     the port.
//   - Exit 0 even when the port was already free.
//
// Usage: node scripts/free-port.mjs <port>

import { execFileSync } from 'node:child_process';

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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const initial = listListenPids(port);
if (initial.length === 0) {
  console.log(`[free-port] :${port} is already free.`);
  process.exit(0);
}

console.log(`[free-port] :${port} held by ${initial.length} pid(s) — clearing.`);
const ours = [];
for (const pid of initial) {
  const u = uidOf(pid);
  const cmd = cmdOf(pid);
  if (myUid !== -1 && u !== -1 && u !== myUid) {
    console.error(`[free-port] refusing to kill pid=${pid} owned by uid=${u} (cmd: ${cmd})`);
    process.exit(1);
  }
  ours.push({ pid, cmd });
}

for (const { pid, cmd } of ours) {
  console.log(`[free-port] SIGTERM pid=${pid} (${cmd.slice(0, 80)})`);
  try { process.kill(pid, 'SIGTERM'); } catch {}
}

await sleep(500);
let remaining = listListenPids(port);
if (remaining.length > 0) {
  for (const pid of remaining) {
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
