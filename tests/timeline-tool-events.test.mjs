import test from 'node:test';
import assert from 'node:assert/strict';

const { interpret } = await import('../src/lib/timeline.ts');

test('Agent API tool events use generic payload.tool names', () => {
  const started = interpret({
    type: 'tool.started',
    ts: 1,
    payload: { event: 'tool.started', run_id: 'run_1', tool: 'lcm_grep', preview: 'grep docs' },
  }).item;
  assert.equal(started?.kind, 'tool');
  assert.equal(started?.title, 'call · lcm_grep');
  assert.equal(started?.summary, 'grep docs');

  const completed = interpret({
    type: 'tool.completed',
    ts: 2,
    payload: { event: 'tool.completed', run_id: 'run_1', tool: 'hindsight_recall', preview: '2 memories', duration: 42 },
  }).item;
  assert.equal(completed?.kind, 'tool');
  assert.equal(completed?.title, 'done · hindsight_recall');
  assert.equal(completed?.summary, '2 memories · 42s');

  const failed = interpret({
    type: 'tool.completed',
    ts: 3,
    payload: { event: 'tool.completed', run_id: 'run_1', tool: 'hindsight_recall', error: true, duration: 1.25 },
  }).item;
  assert.equal(failed?.title, 'failed · hindsight_recall');
  assert.equal(failed?.summary, 'error · failed');
});
