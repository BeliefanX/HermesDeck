import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const scratch = mkdtempSync(join(tmpdir(), 'lcm-adapter-test-'));

function transpileTs(src) {
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function writeRunnableLcmModule() {
  writeFileSync(join(scratch, 'core.js'), transpileTs(readFileSync(resolve('src/lib/server/hermes/core.ts'), 'utf8')));
  const lcmSource = readFileSync(resolve('src/lib/server/hermes/lcm.ts'), 'utf8').replace("from './core'", "from './core.js'");
  writeFileSync(join(scratch, 'lcm.js'), transpileTs(lcmSource));
  return pathToFileURL(join(scratch, 'lcm.js')).href;
}

function makeHermesHome() {
  const root = mkdtempSync(join(tmpdir(), 'hermes-home-lcm-'));
  mkdirSync(join(root, 'plugins', 'hermes-lcm'), { recursive: true });
  writeFileSync(join(root, 'plugins', 'hermes-lcm', 'plugin.yaml'), [
    'name: hermes-lcm',
    'version: 0.18.0',
    'description: "Lossless Context Management"',
    'author: "Hermes Community"',
    'provides_tools:',
    '  - lcm_status',
    '  - lcm_grep',
    '',
  ].join('\n'));
  execFileSync('python3', ['-c', `
import sqlite3, sys
con = sqlite3.connect(sys.argv[1])
con.executescript('''
create table messages (store_id integer primary key autoincrement, session_id text not null, source text default '', role text not null, content text, tool_call_id text, tool_calls text, tool_name text, timestamp real not null, token_estimate integer default 0, pinned integer default 0);
create table summary_nodes (node_id integer primary key autoincrement, session_id text not null, depth integer not null default 0, summary text not null, token_count integer default 0, source_token_count integer default 0, source_ids text not null default '[]', source_type text not null default 'messages', created_at real not null, earliest_at real, latest_at real, expand_hint text default '');
create table lcm_lifecycle_state (conversation_id text primary key, debt_kind text, debt_size_estimate integer not null default 0, last_finalized_at real, last_rollover_at real, last_maintenance_attempt_at real);
insert into messages(session_id, source, role, content, timestamp, token_estimate, pinned) values ('s1', 'chat', 'user', 'hello', 1700000000, 2, 1), ('s1', 'chat', 'assistant', 'world', 1700000001, 3, 0);
insert into summary_nodes(session_id, depth, summary, token_count, created_at) values ('s1', 1, 'sum', 5, 1700000002);
insert into lcm_lifecycle_state(conversation_id, debt_kind, debt_size_estimate, last_finalized_at) values ('c1', 'rollover', 7, 1700000003);
''')
con.commit()
`, join(root, 'lcm.db')]);
  return root;
}

test('LCM adapter is Deck-owned and does not call invented plugin dashboard API', () => {
  const source = readFileSync(resolve('src/lib/server/hermes/lcm.ts'), 'utf8');
  assert.doesNotMatch(source, /\/api\/plugins\/hermes-lcm\/dashboard|\/api\/lcm/);
  assert.match(source, /read-only adapter over hermes-lcm's existing on-disk SQLite state/);
});

test('LCM adapter reads existing hermes-lcm DB state with redacted paths', async () => {
  const root = makeHermesHome();
  const oldHome = process.env.HERMES_HOME;
  process.env.HERMES_HOME = root;
  try {
    const mod = await import(`${writeRunnableLcmModule()}?t=${Date.now()}-${Math.random()}`);
    const result = await mod.getLcmDashboard();
    assert.equal(result.plugin.installed, true);
    assert.equal(result.plugin.version, '0.18.0');
    assert.deepEqual(result.plugin.toolsProvided, ['lcm_status', 'lcm_grep']);
    assert.equal(result.profiles.length, 1);
    assert.equal(result.profiles[0].profile, 'default');
    assert.equal(result.profiles[0].dbPath, '~/.hermes/lcm.db');
    assert.equal(result.profiles[0].rows, 2);
    assert.equal(result.profiles[0].tokens, 5);
    assert.equal(result.profiles[0].summaryNodes, 1);
    assert.equal(result.profiles[0].lifecycle.totalDebt, 7);
    assert.equal(result.totals.rows, 2);
    assert.equal(JSON.stringify(result).includes(root), false);
  } finally {
    if (oldHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = oldHome;
  }
});
