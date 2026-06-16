import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve('src/lib/server/hermes/models.ts'), 'utf8');

test('Hermes /v1/models profile-id placeholder is not exposed as a selectable composer model', () => {
  assert.match(source, /function isHermesAgentPlaceholder\([^)]*profile = ''/);
  assert.match(source, /normalizedModel === profile\.trim\(\)\.toLowerCase\(\)/);
  assert.match(source, /filter\(\(item\) => !isHermesAgentPlaceholder\(item\.provider \|\| 'hermes', item\.id, profile\)\)/);
});

test('empty selectable model catalog is explicit success, not a 502 fallback path', () => {
  assert.match(source, /if \(!modelItems\.length\) \{\s*return \{\s*providers: \[\],\s*orphanModels: \[\],\s*reasoningEffort: 'auto'/s);
});

test('OpenAI-compatible owned_by is treated as provider metadata', () => {
  assert.match(source, /typeof row\.owned_by === 'string'/);
  assert.match(source, /\? row\.owned_by\.trim\(\)/);
});
