import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPromptTemplate,
  extractSlashQuery,
  filterCommands,
  parseSlashSubmit,
  resolveSlashSubmit,
} from '../src/lib/slash-core.ts';

const catalog = [
  { kind: 'local', key: 'new', label: 'New chat', description: 'local action', category: 'local', action: 'new' },
  { kind: 'local', key: 'stop', label: 'Stop', description: 'local action', category: 'local', action: 'stop' },
  { kind: 'control', key: 'model', label: 'Model', description: 'composer control', category: 'control', control: 'model', argHint: '<model-id>' },
  { kind: 'control', key: 'reasoning', aliases: ['think'], label: 'Reasoning', description: 'composer control', category: 'control', control: 'reasoning', argHint: '<level>' },
  { kind: 'unsupported', key: 'help', label: 'Help', description: 'Telegram command', category: 'telegram', unsupportedMode: 'telegram' },
  { kind: 'unsupported', key: 'restart', label: 'Restart', description: 'Gateway command', category: 'telegram', unsupportedMode: 'telegram' },
  { kind: 'snippet', key: 'deck', label: 'HermesDeck overview', description: 'Prompt snippet', category: 'Prompt snippet', template: 'Describe HermesDeck. {cursor}' },
];

test('slash query triggers only at line-leading slash and filters Telegram-like commands', () => {
  assert.deepEqual(extractSlashQuery('/', 1), { start: 0, end: 1, query: '' });
  assert.deepEqual(extractSlashQuery('/rea', 4), { start: 0, end: 4, query: 'rea' });
  assert.equal(extractSlashQuery('hello /rea', 10), null);
  assert.deepEqual(filterCommands(catalog, 'rea').map((c) => c.key), ['reasoning']);
  assert.deepEqual(filterCommands(catalog, 'think').map((c) => c.key), ['reasoning']);
});

test('parser recognizes single-line commands and leaves ordinary slash text alone', () => {
  assert.deepEqual(parseSlashSubmit('/reasoning high'), { raw: '/reasoning high', key: 'reasoning', args: 'high', commandText: '/reasoning high' });
  assert.equal(parseSlashSubmit('please explain /reasoning high'), null);
  assert.equal(parseSlashSubmit('/reasoning high\nand continue'), null);
});

test('/reasoning and /model resolve as composer control, not prompt text', () => {
  assert.deepEqual(resolveSlashSubmit('/reasoning high', catalog, { reasoningLevels: ['low', 'medium', 'high'], defaultReasoning: 'medium' }), {
    handled: true,
    type: 'reasoning',
    value: 'high',
  });
  assert.deepEqual(resolveSlashSubmit('/reasoning reset', catalog, { defaultReasoning: 'medium' }), {
    handled: true,
    type: 'reasoning',
    mode: 'reset',
    value: 'medium',
  });
  assert.deepEqual(resolveSlashSubmit('/model gpt-5.5', catalog, { modelIds: ['gpt-5.5', 'claude-opus'] }), {
    handled: true,
    type: 'model',
    value: 'gpt-5.5',
  });
  assert.equal(resolveSlashSubmit('/model unknown', catalog, { modelIds: ['gpt-5.5'] }).handled, true);
  assert.equal(resolveSlashSubmit('/model unknown', catalog, { modelIds: ['gpt-5.5'] }).type, 'model');
});

test('recognized unsupported commands are intercepted instead of sent to LLM', () => {
  const help = resolveSlashSubmit('/help', catalog);
  assert.equal(help.handled, true);
  assert.equal(help.type, 'unsupported');
  assert.match(help.message, /HermesDeck does not support/);
  const restart = resolveSlashSubmit('/restart now', catalog);
  assert.equal(restart.handled, true);
  assert.equal(restart.type, 'unsupported');
});

test('prompt snippets are explicit snippets and separate from model/reasoning controls', () => {
  const snippet = resolveSlashSubmit('/deck', catalog);
  assert.equal(snippet.handled, true);
  assert.equal(snippet.type, 'snippet');
  assert.match(snippet.text, /^Describe HermesDeck/);
  assert.deepEqual(applyPromptTemplate('/deck', 0, 5, 'A {cursor} B'), { text: 'A  B', caret: 2 });
});
