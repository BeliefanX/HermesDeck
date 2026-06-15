#!/usr/bin/env node
// Wrapper that boots `next dev` (or `next start` with --start) on 6118 AND
// the legacy 6117 redirect helper. Both are children of this process so a
// single Ctrl-C tears them both down — no orphan listeners on either port.
//
// Why not concurrent npm scripts? We want a single foreground process group
// so the launcher (preview, supervisor, raw shell) can supervise it cleanly.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const isStart = process.argv.includes('--start');
const canonicalPort = Number(process.env.CANONICAL_PORT || 6118);
const legacyPort = Number(process.env.LEGACY_PORT || 6117);
const nextHost = process.env.NEXT_HOST || '0.0.0.0';
const canonicalHost = process.env.CANONICAL_HOST || '127.0.0.1';
const localNextBin = fileURLToPath(new URL('../node_modules/.bin/next', import.meta.url));
const localBinDir = fileURLToPath(new URL('../node_modules/.bin', import.meta.url));
const nextBin = existsSync(localNextBin) ? localNextBin : 'next';
const nextArgs = [isStart ? 'start' : 'dev', '-H', nextHost, '-p', String(canonicalPort)];
const childEnv = {
  ...process.env,
  CANONICAL_PORT: String(canonicalPort),
  LEGACY_PORT: String(legacyPort),
  CANONICAL_HOST: canonicalHost,
  PATH: `${localBinDir}:${process.env.PATH || ''}`,
};

const children = [];

function startChild(label, cmd, args, env = process.env) {
  const child = spawn(cmd, args, { stdio: 'inherit', env });
  children.push({ label, child });
  child.on('exit', (code, signal) => {
    console.log(`[dev] ${label} exited (code=${code}, signal=${signal ?? 'none'})`);
    // If next itself died, tear everything down — the redirect alone is useless.
    if (label === 'next') shutdown(code ?? 1);
    if (label === `redirect-${legacyPort}` && code !== 0 && !shuttingDown) {
      console.warn(`[dev] WARNING: legacy :${legacyPort} redirect helper is unavailable; canonical :${canonicalPort} may still work.`);
    }
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
startChild('next', nextBin, nextArgs, childEnv);

// Start the redirect helper. If 6117 is occupied, the helper exits non-zero and
// the parent emits an explicit warning instead of silently reporting success.
startChild(`redirect-${legacyPort}`, process.execPath, ['scripts/redirect-6117.mjs'], childEnv);
