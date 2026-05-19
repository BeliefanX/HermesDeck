#!/usr/bin/env node
// Wrapper that boots `next dev` (or `next start` with --start) on 6118 AND
// the legacy 6117 redirect helper. Both are children of this process so a
// single Ctrl-C tears them both down — no orphan listeners on either port.
//
// Why not concurrent npm scripts? We want a single foreground process group
// so the launcher (preview, supervisor, raw shell) can supervise it cleanly.

import { spawn } from 'node:child_process';

const isStart = process.argv.includes('--start');
const nextBin = 'next';
const nextArgs = [isStart ? 'start' : 'dev', '-H', '0.0.0.0', '-p', '6118'];

const children = [];

function startChild(label, cmd, args, env = process.env) {
  const child = spawn(cmd, args, { stdio: 'inherit', env });
  children.push({ label, child });
  child.on('exit', (code, signal) => {
    console.log(`[dev] ${label} exited (code=${code}, signal=${signal ?? 'none'})`);
    // If next itself died, tear everything down — the redirect alone is useless.
    if (label === 'next') shutdown(code ?? 1);
  });
  child.on('error', (err) => {
    console.error(`[dev] ${label} failed to start:`, err);
    if (label === 'next') shutdown(1);
  });
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    try { if (!child.killed) child.kill('SIGTERM'); } catch {}
  }
  // Give children a moment to exit cleanly, then hard-quit.
  setTimeout(() => process.exit(code), 800).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// Start Next first; it's the load-bearing process.
startChild('next', nextBin, nextArgs);

// Start the redirect helper. If 6117 is occupied, the helper exits 0 and we
// just continue without the legacy redirect — Next on 6118 still works.
startChild('redirect-6117', process.execPath, ['scripts/redirect-6117.mjs']);
