import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectionModule = pathToFileURL(new URL('../src/lib/server/deck-chat-projection.ts', import.meta.url).pathname).href;
let importNonce = 0;

test('pending approval terminal tool results project to approval cards', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hermesdeck-approval-projection-'));
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  try {
    process.env.HERMESDECK_DATA_DIR = dataDir;
    const projection = await import(`${projectionModule}?case=${Date.now()}-${importNonce++}`);
    const viewer = { userId: 'user_approval_projection', role: 'user' };

    projection.startProjectedTurn({
      sessionId: 'approval-tool-result-session',
      profileId: 'default',
      ownerUserId: viewer.userId,
      ownerRole: viewer.role,
      message: 'run command',
    });
    projection.recordProjectedRunEvent({
      sessionId: 'approval-tool-result-session',
      profileId: 'default',
      viewer,
      type: 'tool.result',
      payload: {
        type: 'tool.result',
        run_id: 'run_tool_result_approval',
        call_id: 'call_terminal_approval',
        tool_name: 'terminal',
        output: JSON.stringify({
          output: '',
          exit_code: -1,
          error: '',
          status: 'pending_approval',
          approval_pending: true,
          command: 'rm -rf /tmp/example',
        }),
      },
    });

    const messages = projection.getProjectedMessages('approval-tool-result-session', 'default', { viewer });
    const approval = messages.find((message) => message.metadata?.projectionKind === 'approval');
    assert.ok(approval);
    assert.equal(approval.metadata.approvalStatus, 'pending');
    assert.equal(approval.metadata.runId, 'run_tool_result_approval');
    assert.notEqual(approval.metadata.actionUnavailable, true);
    assert.deepEqual(approval.metadata.choices, ['once', 'session', 'always', 'deny']);
    assert.match(approval.content, /rm -rf \/tmp\/example/);
    assert.equal(projection.hasPendingProjectedApproval({
      sessionId: 'approval-tool-result-session',
      profileId: 'default',
      runId: 'run_tool_result_approval',
      viewer,
    }), true);
  } finally {
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('pending approval tool results without an API run id are projected as unavailable', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hermesdeck-approval-projection-unavailable-'));
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  try {
    process.env.HERMESDECK_DATA_DIR = dataDir;
    const projection = await import(`${projectionModule}?case=${Date.now()}-${importNonce++}`);
    const viewer = { userId: 'user_approval_projection_unavailable', role: 'user' };

    projection.startProjectedTurn({
      sessionId: 'approval-tool-result-unavailable-session',
      profileId: 'default',
      ownerUserId: viewer.userId,
      ownerRole: viewer.role,
      message: 'run command',
    });
    projection.recordProjectedRunEvent({
      sessionId: 'approval-tool-result-unavailable-session',
      profileId: 'default',
      viewer,
      type: 'tool.result',
      payload: {
        type: 'tool.result',
        call_id: 'call_terminal_approval',
        tool_name: 'terminal',
        output: JSON.stringify({
          output: '',
          exit_code: -1,
          error: '',
          status: 'pending_approval',
          approval_pending: true,
          command: 'rm -rf /tmp/example',
        }),
      },
    });

    const messages = projection.getProjectedMessages('approval-tool-result-unavailable-session', 'default', { viewer });
    const approval = messages.find((message) => message.metadata?.projectionKind === 'approval');
    assert.ok(approval);
    assert.equal(approval.metadata.runId, 'tool_call_terminal_approval');
    assert.equal(approval.metadata.actionUnavailable, true);
    assert.deepEqual(approval.metadata.choices, []);
  } finally {
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
