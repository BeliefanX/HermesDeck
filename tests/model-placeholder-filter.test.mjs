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

test('empty selectable model catalog leaves missing/auto reasoning unresolved', () => {
  assert.doesNotMatch(source, /const DEFAULT_REASONING_EFFORT = 'medium'/);
  assert.match(source, /if \(!raw \|\| raw === 'auto'\) return undefined/);
  assert.match(source, /reasoningEffort,\s*\n\s*reasoningLevels,/);
});

test('profile runtime model is used when the OpenAI-compatible model list only advertises the Hermes placeholder', () => {
  assert.match(source, /async function fetchProfileRuntime\(profile = 'default'\)/);
  assert.match(source, /const resolvedModel = profileRuntime\?\.model\?\.trim\(\)/);
  assert.match(source, /const hasUsableResolvedModel = Boolean\(resolvedModel\)[\s\S]*!isHermesAgentPlaceholder\(resolvedProvider, resolvedModel, profile\)/);
  assert.match(source, /if \(hasUsableResolvedModel && resolvedModel && !modelItems\.some\(\(item\) => item\.id === resolvedModel\)\)/);
  assert.match(source, /modelItems\.push\(\{ id: resolvedModel, provider: resolvedProvider, isDefault: true \}\)/);
  assert.match(source, /resolvedModel \? modelItems\.find\(\(item\) => item\.id === resolvedModel\)/);
});

test('OpenAI-compatible owned_by is treated as provider metadata', () => {
  assert.match(source, /typeof row\.owned_by === 'string'/);
  assert.match(source, /\? row\.owned_by\.trim\(\)/);
});
