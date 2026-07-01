import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chatStream = readFileSync(new URL('../src/lib/server/hermes/chat-stream.ts', import.meta.url), 'utf8');
const projection = readFileSync(new URL('../src/lib/server/deck-chat-projection.ts', import.meta.url), 'utf8');
const messageRow = readFileSync(new URL('../src/app/chat/_components/MessageRow.tsx', import.meta.url), 'utf8');
const visibleMessages = readFileSync(new URL('../src/app/chat/_hooks/useVisibleMessages.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const approvalRoute = readFileSync(new URL('../src/app/api/deck/chat/approval/route.ts', import.meta.url), 'utf8');
const { selectVisibleMessages } = await import('../src/app/chat/_hooks/useVisibleMessages.ts');

test('chat stream uses approval-capable /v1/runs protocol', () => {
  assert.match(chatStream, /\/v1\/runs`/);
  assert.match(chatStream, /\/v1\/runs\/\$\{encodeURIComponent\(runId\)\}\/events/);
  assert.match(chatStream, /apiBody\.session_id = clientSessionId/);
  assert.doesNotMatch(chatStream, /fetch\(`\$\{[^`]+\}\/v1\/responses/);
});

test('approval events project to visible pending assistant messages and resolve', () => {
  assert.match(projection, /type === 'approval\.request'/);
  assert.match(projection, /upsertApprovalMessage/);
  assert.match(projection, /projectionKind: 'approval'/);
  assert.match(projection, /approvalStatus: 'pending'/);
  assert.match(projection, /resolveApprovalMessage/);
  assert.match(visibleMessages, /isPendingApprovalMessage/);
});

test('pending approval suppresses ordinary typing placeholders', () => {
  const rows = [
    { id: 'u', role: 'user', content: 'run' },
    { id: 'draft', role: 'assistant', content: '', metadata: { projectionStatus: 'draft' } },
    { id: 'approval', role: 'assistant', content: 'Approval required', metadata: { projectionKind: 'approval', approvalStatus: 'pending', runId: 'run_1' } },
  ];
  assert.deepEqual(selectVisibleMessages(rows, false, true).map((m) => m.id), ['u', 'approval']);
});

test('approval UI calls a protected Deck BFF route with all four choices', () => {
  assert.match(messageRow, /ApprovalBlock/);
  for (const label of ['Approve once', 'Session', 'Always', 'Deny']) assert.match(messageRow, new RegExp(label));
  assert.match(messageRow, /sessionId/);
  assert.match(messageRow, /metadata\?\.choices/);
  assert.match(api, /chatApproval/);
  assert.match(api, /sessionId: string/);
  assert.match(approvalRoute, /guardMutating/);
  assert.match(approvalRoute, /requireActiveUser/);
  assert.match(approvalRoute, /requireProfileAccess/);
  assert.match(approvalRoute, /hasPendingProjectedApproval/);
  assert.match(approvalRoute, /resolvePendingProjectedApproval/);
  assert.match(approvalRoute, /\/v1\/runs\/\$\{encodeURIComponent\(runId\)\}\/approval/);
  assert.doesNotMatch(approvalRoute, /resolve_all/);
  assert.doesNotMatch(approvalRoute, /all === true/);
});
