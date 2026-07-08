import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

test('attachment-only turns are durably projected with redacted attachment metadata', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hermesdeck-attachment-only-projection-'));
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  try {
    process.env.HERMESDECK_DATA_DIR = dataDir;
    const projection = await import(`${projectionModule}?case=${Date.now()}-${importNonce++}`);
    const viewer = { userId: 'user_attachment_only_projection', role: 'user' };

    projection.startProjectedTurn({
      sessionId: 'attachment-only-session',
      profileId: 'default',
      ownerUserId: viewer.userId,
      ownerRole: viewer.role,
      message: '',
      attachments: [
        {
          id: 'att_1',
          name: 'private-image.png',
          mime: 'image/png',
          size: 123,
          kind: 'image',
          dataUrl: 'data:image/png;base64,SECRET_BASE64',
          url: 'https://private.example/secret.png',
          text: 'SECRET TEXT',
        },
      ],
    });

    const messages = projection.getProjectedMessages('attachment-only-session', 'default', { viewer });
    assert.ok(messages);
    const user = messages.find((message) => message.role === 'user');
    assert.ok(user);
    assert.equal(user.content, '');
    assert.equal(user.attachments?.[0]?.name, 'private-image.png');
    assert.equal(user.attachments?.[0]?.mime, 'image/png');
    assert.equal(user.attachments?.[0]?.kind, 'image');
    assert.equal('dataUrl' in user.attachments[0], false);
    assert.equal('url' in user.attachments[0], false);
    assert.equal('text' in user.attachments[0], false);
    const snapshot = readFileSync(join(dataDir, 'chat-projection.v1.json'), 'utf8');
    assert.equal(snapshot.includes('SECRET_BASE64'), false);
    assert.equal(snapshot.includes('https://private.example/secret.png'), false);
    assert.equal(snapshot.includes('SECRET TEXT'), false);
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

test('id-less tool completion events without output project as tool results', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hermesdeck-tool-completed-projection-'));
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  try {
    process.env.HERMESDECK_DATA_DIR = dataDir;
    const projection = await import(`${projectionModule}?case=${Date.now()}-${importNonce++}`);
    const viewer = { userId: 'user_tool_completed_projection', role: 'user' };

    projection.startProjectedTurn({
      sessionId: 'tool-completed-no-output-session',
      profileId: 'default',
      ownerUserId: viewer.userId,
      ownerRole: viewer.role,
      message: 'run command',
    });
    projection.recordProjectedRunEvent({
      sessionId: 'tool-completed-no-output-session',
      profileId: 'default',
      viewer,
      type: 'tool.completed',
      payload: { type: 'tool.completed', tool_name: 'terminal', status: 'completed' },
    });

    const messages = projection.getProjectedMessages('tool-completed-no-output-session', 'default', { viewer });
    const result = messages.find((message) => message.metadata?.projectionKind === 'tool-result');
    assert.ok(result);
    assert.equal(result.role, 'tool');
    assert.equal(result.toolName, 'terminal');
    assert.equal(result.toolCallId.startsWith('tool_terminal_'), true);
    assert.match(result.content, /tool\.completed/);
    assert.match(result.content, /completed/);
  } finally {
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('same-name id-less tool completion events do not collide in projection', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hermesdeck-tool-completed-collision-'));
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  try {
    process.env.HERMESDECK_DATA_DIR = dataDir;
    const projection = await import(`${projectionModule}?case=${Date.now()}-${importNonce++}`);
    const viewer = { userId: 'user_tool_completed_collision', role: 'user' };

    projection.startProjectedTurn({
      sessionId: 'tool-completed-collision-session',
      profileId: 'default',
      ownerUserId: viewer.userId,
      ownerRole: viewer.role,
      message: 'run command',
    });
    projection.recordProjectedRunEvent({
      sessionId: 'tool-completed-collision-session',
      profileId: 'default',
      viewer,
      type: 'tool.completed',
      payload: { type: 'tool.completed', tool_name: 'terminal', status: 'completed', output: 'first' },
    });
    projection.recordProjectedRunEvent({
      sessionId: 'tool-completed-collision-session',
      profileId: 'default',
      viewer,
      type: 'tool.completed',
      payload: { type: 'tool.completed', tool_name: 'terminal', status: 'completed', output: 'second' },
    });

    const results = projection.getProjectedMessages('tool-completed-collision-session', 'default', { viewer })
      .filter((message) => message.metadata?.projectionKind === 'tool-result');
    assert.equal(results.length, 2);
    assert.notEqual(results[0].toolCallId, results[1].toolCallId);
    assert.deepEqual(results.map((message) => message.content), ['first', 'second']);
  } finally {
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('projected attachment storage keeps metadata but redacts bodies and private URLs', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hermesdeck-attachment-redaction-'));
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  try {
    process.env.HERMESDECK_DATA_DIR = dataDir;
    const projection = await import(`${projectionModule}?case=${Date.now()}-${importNonce++}`);
    const viewer = { userId: 'user_attachment_redaction', role: 'user' };

    projection.startProjectedTurn({
      sessionId: 'attachment-redaction-session',
      profileId: 'default',
      ownerUserId: viewer.userId,
      ownerRole: viewer.role,
      message: 'see attachment',
      attachments: [{
        id: 'att-secret',
        name: 'secret.txt',
        mime: 'text/plain',
        size: 12,
        kind: 'text',
        text: 'TOP_SECRET_TEXT',
        dataUrl: 'data:text/plain;base64,VE9QX1NFQ1JFVA==',
        url: 'file:///Users/example/private.txt',
      }],
    });
    projection.finalizeProjectedTurn({
      sessionId: 'attachment-redaction-session',
      profileId: 'default',
      viewer,
      content: 'done',
      attachments: [{
        id: 'att-image',
        name: 'private.png',
        mime: 'image/png',
        size: 42,
        kind: 'image',
        dataUrl: 'data:image/png;base64,SECRET_IMAGE',
        url: '/api/private/image.png',
      }],
    });

    const messages = projection.getProjectedMessages('attachment-redaction-session', 'default', { viewer });
    const allAttachments = messages.flatMap((message) => message.attachments || []);
    assert.deepEqual(allAttachments, [
      { id: 'att-secret', name: 'secret.txt', mime: 'text/plain', size: 12, kind: 'text' },
      { id: 'att-image', name: 'private.png', mime: 'image/png', size: 42, kind: 'image' },
    ]);
    const rawStore = readFileSync(join(dataDir, 'chat-projection.v1.json'), 'utf8');
    assert.doesNotMatch(rawStore, /TOP_SECRET_TEXT|VE9QX1NFQ1JFVA|SECRET_IMAGE|file:\/\/|\/api\/private/);
  } finally {
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('generic Agent run events persist as hidden tool-detail rows with 90-day retention', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'hermesdeck-run-event-projection-'));
  const oldDataDir = process.env.HERMESDECK_DATA_DIR;
  try {
    process.env.HERMESDECK_DATA_DIR = dataDir;
    const projection = await import(`${projectionModule}?case=${Date.now()}-${importNonce++}`);
    const viewer = { userId: 'user_run_event_projection', role: 'user' };

    projection.startProjectedTurn({
      sessionId: 'run-event-session',
      profileId: 'default',
      ownerUserId: viewer.userId,
      ownerRole: viewer.role,
      message: 'do work',
    });
    projection.recordProjectedRunEvent({
      sessionId: 'run-event-session',
      profileId: 'default',
      viewer,
      type: 'run.status',
      payload: { type: 'run.status', run_id: 'run_raw_event_1', status: 'queued', detail: { step: 'scheduler' } },
    });
    projection.finalizeProjectedTurn({
      sessionId: 'run-event-session',
      profileId: 'default',
      viewer,
      content: 'done',
    });

    const messages = projection.getProjectedMessages('run-event-session', 'default', { viewer });
    const event = messages.find((message) => message.metadata?.projectionKind === 'run-event');
    assert.ok(event);
    assert.equal(event.role, 'tool');
    assert.equal(event.toolName, 'run.status');
    assert.match(event.content, /run_raw_event_1/);
    assert.match(event.content, /scheduler/);

    projection.recordProjectedRunEvent({
      sessionId: 'run-event-session',
      profileId: 'default',
      viewer,
      type: 'tool.started',
      payload: { event: 'tool.started', run_id: 'run_raw_event_1', tool: 'lcm_grep', preview: '{"query":"docs"}' },
    });
    const afterToolStart = projection.getProjectedMessages('run-event-session', 'default', { viewer });
    const toolCall = afterToolStart.find((message) => message.metadata?.projectionKind === 'tool-call' && message.toolName === 'lcm_grep');
    assert.ok(toolCall);
    assert.equal(toolCall.role, 'assistant');
    assert.equal(toolCall.toolCalls?.[0]?.name, 'lcm_grep');
    assert.equal(toolCall.toolCalls?.[0]?.arguments, '{"query":"docs"}');
    assert.ok(!afterToolStart.some((message) => message.metadata?.projectionKind === 'run-event' && message.metadata?.eventType === 'tool.started'));

    const source = readFileSync(new URL('../src/lib/server/deck-chat-projection.ts', import.meta.url), 'utf8');
    assert.match(source, /const COMPLETED_SESSION_TTL_MS = 90 \* 24 \* 60 \* 60 \* 1000;/);
  } finally {
    if (oldDataDir === undefined) delete process.env.HERMESDECK_DATA_DIR;
    else process.env.HERMESDECK_DATA_DIR = oldDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
