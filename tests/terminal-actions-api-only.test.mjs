import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const terminalSource = readFileSync(resolve('src/lib/server/hermes/terminal.ts'), 'utf8');

function constBlock(name) {
  const start = terminalSource.indexOf(`const ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = terminalSource.indexOf('\n];', start);
  assert.notEqual(end, -1, `${name} should end with ];`);
  return terminalSource.slice(start, end + 3);
}

test('default terminal actions are API-backed and do not advertise Hermes CLI commands', () => {
  const apiBlock = constBlock('apiTerminalActions');
  assert.match(apiBlock, /hermes\.api\.version/);
  assert.match(apiBlock, /hermes\.api\.profiles/);
  assert.match(apiBlock, /diagnostic\.health/);
  assert.doesNotMatch(apiBlock, /file:\s*['"]hermes['"]/);
  assert.doesNotMatch(apiBlock, /commandPreview:\s*['"]hermes\s/);
  assert.doesNotMatch(apiBlock, /hermes\.tools\.list|hermes\.skills\.list|hermes\.profile\.show/);

  const listFn = terminalSource.match(/export function listTerminalActions\(\)[\s\S]*?\n}\n/);
  assert.ok(listFn, 'listTerminalActions should exist');
  assert.match(listFn[0], /availableTerminalActions\(\)/);
  assert.match(listFn[0], /localOnly:\s*_localOnly/);
});

test('Hermes CLI diagnostics are retained only behind explicit local diagnostics opt-in', () => {
  const localBlock = constBlock('localDiagnosticActions');
  assert.match(localBlock, /file:\s*['"]hermes['"]/);
  assert.match(localBlock, /localOnly:\s*true/);
  assert.match(terminalSource, /HERMESDECK_LOCAL_DIAGNOSTICS\s*===\s*['"]1['"]/);
  assert.match(terminalSource, /localDiagnosticsEnabled\(\) \? \[\.\.\.apiTerminalActions, \.\.\.localDiagnosticActions\] : apiTerminalActions/);
});

test('runTerminalAction rejects disabled local CLI actions before execFileAsync can run', () => {
  const runStart = terminalSource.indexOf('export async function runTerminalAction');
  assert.notEqual(runStart, -1, 'runTerminalAction should exist');
  const runBlock = terminalSource.slice(runStart);
  const localReject = runBlock.indexOf('local diagnostics require HERMESDECK_LOCAL_DIAGNOSTICS=1');
  const execCall = runBlock.indexOf('execFileAsync(');
  assert.notEqual(localReject, -1, 'disabled local actions should return a clear error');
  assert.notEqual(execCall, -1, 'local diagnostics may still use execFileAsync when explicitly enabled');
  assert.ok(localReject < execCall, 'disabled local CLI actions must be rejected before any execFileAsync branch');
  assert.match(runBlock, /availableTerminalActions\(\)\.find/);
  assert.doesNotMatch(runBlock.slice(0, execCall), /localDiagnosticsEnabled\(\)\s*\|\|\s*true/);
});
