import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const visibleMessages = readFileSync(new URL('../src/app/chat/_hooks/useVisibleMessages.ts', import.meta.url), 'utf8');
const { selectVisibleMessages } = await import('../src/app/chat/_hooks/useVisibleMessages.ts');
const messageRow = readFileSync(new URL('../src/app/chat/_components/MessageRow.tsx', import.meta.url), 'utf8');
const chatPage = readFileSync(new URL('../src/app/chat/page.tsx', import.meta.url), 'utf8');
const projection = readFileSync(new URL('../src/lib/server/deck-chat-projection.ts', import.meta.url), 'utf8');
const deckSessionList = readFileSync(new URL('../src/lib/server/deck-session-list.ts', import.meta.url), 'utf8');
const sessionsRoute = readFileSync(new URL('../src/app/api/deck/sessions/route.ts', import.meta.url), 'utf8');
const messagesRoute = readFileSync(new URL('../src/app/api/deck/sessions/[id]/messages/route.ts', import.meta.url), 'utf8');

test('server-projected draft assistant rows survive refresh as visible typing placeholders', () => {
  assert.match(visibleMessages, /export function isProjectedDraftMessage/);
  assert.match(visibleMessages, /projectionStatus === 'draft'/);
  assert.match(visibleMessages, /latestTypingTargetIndex/);
  assert.match(visibleMessages, /return idx === typingTargetIdx/);
  assert.match(messageRow, /busy \|\| isProjectedDraftMessage\(m\)/);
});

test('visible message filtering keeps only the latest empty assistant typing target', () => {
  const rows = [
    { id: 'u1', role: 'user', content: 'run tools' },
    { id: 'old-draft', role: 'assistant', content: '', metadata: { projectionStatus: 'draft' } },
    { id: 'tool-call', role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'delegate_task' }] },
    { id: 'latest-empty', role: 'assistant', content: '' },
  ];

  const visible = selectVisibleMessages(rows, true, true);
  assert.deepEqual(visible.map((m) => m.id), ['u1', 'tool-call', 'latest-empty']);
});

test('active projected drafts are hydrated from the server and polled to final content', () => {
  assert.match(chatPage, /deckApi\.messages\(active, profile\)/);
  assert.match(chatPage, /projectionStatus === 'draft'/);
  assert.match(chatPage, /setInterval\(poll, 3000\)/);
});

test('active server projection is fetched even over cached local placeholders', () => {
  assert.doesNotMatch(chatPage, /if \(\(messages\[active\] \|\| \[\]\)\.length\) return;/);
  assert.match(chatPage, /setMessages\(\(m\) => \{/);
  assert.match(chatPage, /messagesEqual\(m\[active\], r\.messages\)/);
  assert.match(chatPage, /return \{ \.\.\.m, \[active\]: r\.messages \};/);
});

test('projection polling is bounded by active draft state and avoids whole-message dependency churn', () => {
  assert.match(chatPage, /const hasActiveServerDraft = activeMessages\.some/);
  assert.match(chatPage, /if \(!hasActiveServerDraft\) return;/);
  assert.match(chatPage, /messagesEqual\(m\[active\], r\.messages\)/);
  assert.match(chatPage, /return m;/);
  assert.doesNotMatch(chatPage, /\}, \[active, busy, hydrated, messages, profile, setMessages\]\);/);
  assert.match(chatPage, /\}, \[active, busy, hasActiveServerDraft, hydrated, profile, setMessages\]\);/);
});

test('Deck chat projection reads are profile-scoped for shared assigned agents', () => {
  assert.match(projection, /export type ProjectionViewer/);
  assert.match(projection, /canViewProjectedSession/);
  assert.match(projection, /canWriteProjectedSession/);
  assert.match(projection, /canWriteProjectedSession\(session, viewer\)/);
  assert.match(projection, /hasProjectedSession\(sessionId: string, profileId: string, viewer\?: ProjectionViewer\)/);
  assert.match(projection, /projectedResponseIdMatches\(sessionId: string, profileId: string, responseId: string, viewer\?: ProjectionViewer\)/);
  assert.doesNotMatch(projection, /return !session\.ownerUserId \|\| session\.ownerUserId === viewer\.userId/);
  assert.match(deckSessionList, /listProjectedSessions\(profile, viewer\)/);
  assert.match(sessionsRoute, /listDeckSessionsForProfile\(profile, \{ userId: auth\.user\.id, role: auth\.user\.role \}\)/);
  assert.match(messagesRoute, /viewer: \{ userId: auth\.user\.id, role: auth\.user\.role \}/);
});

test('Deck stats projection reads are owner scoped for authenticated viewers', () => {
  const statsRoute = readFileSync(new URL('../src/app/api/deck/stats/route.ts', import.meta.url), 'utf8');
  assert.match(statsRoute, /const viewer = \{ userId: auth\.user\.id, role: auth\.user\.role \}/);
  assert.match(statsRoute, /projectedOrApiStats\(profileId, viewer\)/);
  assert.match(statsRoute, /projectionAndApiStats\(profile, viewer\)/);
  assert.match(statsRoute, /listProjectedSessions\(profile, viewer\)/);
  assert.doesNotMatch(statsRoute, /listProjectedSessions\('default'\)/);
});

test('server draft polling is single-flight guarded', () => {
  assert.match(chatPage, /const draftPollInFlightRef = useRef\(false\)/);
  assert.match(chatPage, /if \(draftPollInFlightRef\.current\) return;/);
  assert.match(chatPage, /draftPollInFlightRef\.current = true;/);
  assert.match(chatPage, /draftPollInFlightRef\.current = false;/);
});

test('server projection persists tool call and result rows for refresh hydration', () => {
  const streamRoute = readFileSync(new URL('../src/app/api/deck/chat/stream/route.ts', import.meta.url), 'utf8');
  const chatStream = readFileSync(new URL('../src/lib/server/hermes/chat-stream.ts', import.meta.url), 'utf8');
  assert.match(chatStream, /onRunEvent\?: \(input: \{ sessionId: string; profileId: string; type: string; payload: unknown \}\) => void/);
  assert.match(chatStream, /hooks\?\.onRunEvent\?\.\(\{/);
  assert.match(streamRoute, /recordProjectedRunEvent\(\{ sessionId, profileId: projectedProfileId, viewer: projectionViewer, type, payload \}\)/);
  assert.match(projection, /export function recordProjectedRunEvent/);
  assert.match(projection, /upsertToolCallMessage/);
  assert.match(projection, /insertToolResultMessage/);
  assert.match(projection, /projectionKind: 'tool-call'/);
  assert.match(projection, /projectionKind: 'tool-result'/);
});

test('run-event projection skips non-tool stream events before touching the store', () => {
  assert.match(projection, /function isProjectableRunEvent\(type: string, payload: Record<string, unknown>, item: Record<string, unknown>\): boolean/);
  assert.match(projection, /if \(!isProjectableRunEvent\(innerType, payload, item\)\) return;\n\s+mutateStore\(\(store\) => \{/);
  assert.match(projection, /if \(result === false\) return result;\n\s+writeStore\(store\);/);
  assert.match(projection, /return changed \|\| false;/);
  assert.match(projection, /if \(isToolArgsDelta\(type\)\) return false;/);
  assert.doesNotMatch(projection, /else if \(isToolArgsDelta\(innerType\)\)/);
  assert.doesNotMatch(projection, /const item = safeRecord\(payload\.item\) \|\| \{\};\n\s+mutateStore\(\(store\) => \{/);
});


test('server projection preserves function-call aliases and normalizes tool output arrays', () => {
  assert.match(projection, /const callId = String\(\(item\.call_id as string\) \|\| \(item\.tool_call_id as string\) \|\| ''\);/);
  assert.match(projection, /return \{ primary: callId \|\| itemId, itemId, callId \};/);
  assert.match(projection, /toolItemId: input\.itemId/);
  assert.match(projection, /toolCallId: input\.callId \|\| visibleId/);
  assert.match(projection, /function normalizeToolOutput\(output: unknown\): string/);
  assert.match(projection, /return typeof rec\.text === 'string' \? rec\.text : '';/);
  assert.match(projection, /content: normalizeToolOutput\(output\)/);
});
