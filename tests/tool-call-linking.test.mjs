import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve('src/app/chat/_hooks/useChatStream.ts'), 'utf8');

test('Responses function_call_output links by call_id, not only fc item id', () => {
  assert.match(source, /const callId = String\(\(item\.call_id as string\) \|\| \(item\.tool_call_id as string\) \|\| ''\);/);
  assert.match(source, /return \{ primary: callId \|\| itemId, itemId, callId \};/);
  assert.match(source, /rememberToolSlot\(inf\.toolCalls, itemId, \{[\s\S]*callId: ids\.callId \|\| undefined,[\s\S]*\}\);/);
  assert.match(source, /const tc = getToolSlot\(inf\.toolCalls, itemId\);\n\s+const toolName = tc\?\.name \|\| String\(\(item\.name as string\) \|\| 'tool'\);/);
});

test('tool output arrays from skill_view are rendered as text, not raw card JSON', () => {
  assert.match(source, /function normalizeToolOutput\(output: unknown\): string/);
  assert.match(source, /return typeof rec\.text === 'string' \? rec\.text : '';/);
  assert.match(source, /const text = normalizeToolOutput\(output\);/);
});
