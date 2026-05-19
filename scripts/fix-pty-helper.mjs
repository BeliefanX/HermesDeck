#!/usr/bin/env node
// node-pty's prebuilt spawn-helper sometimes ships without the executable bit
// (or with a quarantine xattr on macOS). Without +x, pty.fork → posix_spawnp
// fails and the live terminal goes dark. Run after every install.
import { existsSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const candidates = [
  ['darwin-arm64'],
  ['darwin-x64'],
  ['linux-arm64'],
  ['linux-x64'],
].map(([p]) => join(root, 'node_modules/node-pty/prebuilds', p, 'spawn-helper'));

for (const f of candidates) {
  if (!existsSync(f)) continue;
  try { chmodSync(f, 0o755); } catch {}
  if (process.platform === 'darwin') {
    try { execFileSync('xattr', ['-d', 'com.apple.provenance', f], { stdio: 'ignore' }); } catch {}
    try { execFileSync('xattr', ['-d', 'com.apple.quarantine', f], { stdio: 'ignore' }); } catch {}
  }
}
