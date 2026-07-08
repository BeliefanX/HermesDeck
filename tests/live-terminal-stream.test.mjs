import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve('src/app/api/deck/term/sessions/[id]/stream/route.ts'), 'utf8');

test('live terminal stream unregisters subscribers when the client stream closes', () => {
  const cleanupStart = source.indexOf('const cleanup = () => {');
  assert.notEqual(cleanupStart, -1, 'stream route should have one cleanup path');
  const cleanupBlock = source.slice(cleanupStart, source.indexOf('const enqueue', cleanupStart));
  assert.match(cleanupBlock, /if \(keepalive\) clearInterval\(keepalive\)/);
  assert.match(cleanupBlock, /unsubscribe\?\.\(\)/);
  assert.match(cleanupBlock, /controller\.close\(\)/);

  const assign = source.indexOf('unsubscribe = sub.unsubscribe');
  const ready = source.indexOf("send('ready'");
  assert.ok(assign > -1 && ready > -1 && assign < ready, 'subscriber must be unregisterable before replay starts');

  assert.match(source, /catch \{ cleanup\(\); \}/);
  assert.match(source, /cancel\(\) \{[\s\S]*unsubscribe\(\)/);
});
