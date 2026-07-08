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
const api = readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8');
const chatStreamHook = readFileSync(new URL('../src/app/chat/_hooks/useChatStream.ts', import.meta.url), 'utf8');
const chatComposer = readFileSync(new URL('../src/app/chat/_components/ChatComposer.tsx', import.meta.url), 'utf8');
const goalAndQueue = readFileSync(new URL('../src/app/chat/_hooks/useGoalAndQueue.ts', import.meta.url), 'utf8');

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

test('visible message filtering keeps only the projected final assistant after live/projection completion overlap', () => {
  const rows = [
    { id: 'u1', role: 'user', content: 'finish task' },
    { id: 'live-final', role: 'assistant', content: 'done' },
    { id: 'tool-result', role: 'tool', content: 'ok', toolCallId: 'call_1' },
    { id: 'projected-final', role: 'assistant', content: 'done', metadata: { projectionStatus: 'final' } },
  ];

  const hiddenTools = selectVisibleMessages(rows, false, false);
  assert.deepEqual(hiddenTools.map((m) => m.id), ['u1', 'projected-final']);

  const shownTools = selectVisibleMessages(rows, true, false);
  assert.deepEqual(shownTools.map((m) => m.id), ['u1', 'tool-result', 'projected-final']);
});

test('visible message filtering preserves repeated assistant text across user turns', () => {
  const rows = [
    { id: 'u1', role: 'user', content: 'first' },
    { id: 'projected-final', role: 'assistant', content: 'done', metadata: { projectionStatus: 'final' } },
    { id: 'u2', role: 'user', content: 'say it again' },
    { id: 'later-repeat', role: 'assistant', content: 'done' },
  ];

  const visible = selectVisibleMessages(rows, false, false);
  assert.deepEqual(visible.map((m) => m.id), ['u1', 'projected-final', 'u2', 'later-repeat']);
});

test('async delegation completion markers render as visible subagent results, not user rows', () => {
  const rows = [
    { id: 'u1', role: 'user', content: 'delegate this' },
    { id: 'async-done', role: 'user', content: '[ASYNC DELEGATION BATCH COMPLETE — deleg_534ab3bc]\nsubagent result text' },
  ];

  const visible = selectVisibleMessages(rows, false, false);
  assert.equal(visible.length, 2);
  assert.equal(visible[1].role, 'assistant');
  assert.equal(visible[1].toolName, 'delegate_task');
  assert.equal(visible[1].metadata?.projectionKind, 'async-delegation-result');
  assert.match(messageRow, /isAsyncDelegationResultMessage/);
  assert.match(messageRow, /ASYNC_DELEGATION_TOOL_NAME/);
  assert.match(messageRow, /!preview && !parsed\.isJson/);
});

test('delegate_task dispatch acknowledgements use a distinct card title', () => {
  assert.match(messageRow, /function extractSubagentDispatchPreview/);
  assert.match(messageRow, /status !== 'dispatched'/);
  assert.match(messageRow, /title = 'Subagent dispatched'/);
  assert.match(messageRow, /Background subagent/);
});

test('chat tool cards render concrete tool names before generic labels', () => {
  assert.match(messageRow, /const toolNames = calls\.map\(\(c\) => c\.name\)/);
  assert.match(messageRow, /<span className="tool-block-names">\{toolNames\}<\/span>\n\s+<span className="tool-block-title">/);
  assert.match(messageRow, /<span className="tool-block-names">\{toolName \|\| 'tool'\}<\/span>\n\s+<span className="tool-block-title">\{title\}<\/span>/);
  assert.match(messageRow, /runEventDisplay\?\.toolName \|\| resolvedToolName/);
  assert.match(messageRow, /titleOverride=\{runEventDisplay\?\.title\}/);
  assert.match(messageRow, /title: 'Run event'/);
  assert.match(messageRow, /title: 'Tool call'/);
});

test('generic tool-start events use Agent API preview as displayed args fallback', () => {
  assert.match(chatStreamHook, /p\.arguments \?\? p\.args \?\? p\.input \?\? p\.preview/);
  assert.match(projection, /payload\.arguments \?\? payload\.args \?\? payload\.input \?\? payload\.preview/);
});

test('generic tool result events use stable fallbacks and payload content when output is absent', () => {
  assert.match(chatStreamHook, /stableToolFallbackId\(innerType, fallbackName, p, item\)/);
  assert.match(chatStreamHook, /const text = toolResultContent\(output, innerType, p\);/);
  assert.match(projection, /stableToolFallbackId\(innerType, fallbackName, payload, item\)/);
  assert.match(projection, /const content = toolResultContent\(output, innerType, payload\);/);
});

test('attachment-only sends are enabled and clear across new chat/profile switch', () => {
  assert.match(chatComposer, /const canSend = !!input\.trim\(\) \|\| attachments\.some\(\(a\) => a\.status === 'ready'\)/);
  assert.match(chatComposer, /disabled=\{busy \|\| !canSend\}/);
  assert.match(chatStreamHook, /const liveAtts = opts\?\.attachmentsOverride\n\s+\?\? attachments\.filter\(\(a\) => a\.status === 'ready'\)\.map\(attachmentToPayload\);\n\s+if \(\(!text && !liveAtts\.length\) \|\| busy\) return;/);
  assert.match(goalAndQueue, /if \(!raw && !canSendAttachmentsOnly\) return;/);
  assert.match(chatPage, /canSendAttachmentsOnly: attachments\.some\(\(a\) => a\.status === 'ready'\)/);
  assert.match(chatStreamHook, /setAttachments\(\[\]\);\n\s+\}, \[abortRef, profile, setAttachments, setBusy, setMessagesLoading\]\)/);
  assert.match(chatStreamHook, /setActive\(''\);\n\s+setError\(''\);\n\s+setAttachments\(\[\]\);/);
});

test('chat tool-card fold headers are semantic buttons', () => {
  assert.match(messageRow, /<button type="button" className="tool-block-head"/);
  assert.doesNotMatch(messageRow, /className="tool-block-head"[^>]*role="button"/);
});

test('active projected drafts are hydrated from the server and polled to final content', () => {
  assert.match(chatPage, /deckApi\.messages\(active, profile\)/);
  assert.match(chatPage, /if \(busy && cached\?\.length\) \{/);
  assert.match(chatStreamHook, /Refresh can restore a busy local placeholder before the normal page\n\s+\/\/ message loader runs/);
  assert.match(chatStreamHook, /const r = await deckApi\.messages\(liveSid, profile, ac\.signal\)/);
  assert.match(chatPage, /clearStaleActiveSession\(active\)/);
  assert.match(chatPage, /isSessionProfileMismatch\(err\)/);
  assert.match(chatPage, /projectionStatus === 'draft'/);
  assert.match(chatPage, /setInterval\(poll, 3000\)/);
  assert.doesNotMatch(chatPage, /if \(!hydrated \|\| !profile \|\| !active \|\| busy\) return;/);
});

test('active server projection is fetched even over cached local placeholders', () => {
  assert.doesNotMatch(chatPage, /if \(\(messages\[active\] \|\| \[\]\)\.length\) return;/);
  assert.match(chatPage, /setMessages\(\(m\) => \{/);
  assert.match(chatPage, /messagesEqual\(m\[active\], r\.messages\)/);
  assert.match(chatPage, /return \{ \.\.\.m, \[active\]: r\.messages \};/);
  assert.match(messagesRoute, /if \(err instanceof SessionProfileRoutingError\) return NextResponse\.json\(\{ messages: projected \}\);/);
});

test('Deck-origin projected sessions overlay canonical Agent tool history when available', () => {
  assert.match(messagesRoute, /function mergeCanonicalMessages\(apiMessages: DeckMessage\[\], projected: DeckMessage\[\], limit\?: number\): DeckMessage\[\]/);
  assert.match(messagesRoute, /hasCanonicalToolDetails\(apiMessages\)/);
  assert.match(messagesRoute, /mergeCanonicalMessages\(apiMessages, projected, limit\)/);
  assert.match(messagesRoute, /mergeCanonicalMessages\(apiMessages, refreshed, limit\)/);
  assert.match(messagesRoute, /kind === 'run-event' \|\| kind === 'approval'/);
  assert.doesNotMatch(messagesRoute, /if \(!isRecoverableDraft\(projected\)\) return NextResponse\.json\(\{ messages: projected \}\);/);
});

test('API error detail formatting does not append duplicate detail strings', () => {
  assert.match(api, /export function apiErrorDetail/);
  assert.match(api, /!err\.message\.includes\(detail\)/);
  assert.doesNotMatch(chatPage, /function apiErrorDetail/);
});

test('projection polling is bounded by active draft state and avoids whole-message dependency churn', () => {
  assert.match(chatPage, /const hasActiveServerDraft = activeMessages\.some/);
  assert.match(chatPage, /if \(!hasActiveServerDraft\) return;/);
  assert.match(chatPage, /messagesEqual\(m\[active\], r\.messages\)/);
  assert.match(chatPage, /return m;/);
  assert.doesNotMatch(chatPage, /\}, \[active, busy, hydrated, messages, profile, setMessages\]\);/);
  assert.match(chatPage, /\}, \[active, hasActiveServerDraft, hydrated, profile, setMessages\]\);/);
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
  assert.match(messagesRoute, /const viewer = \{ userId: auth\.user\.id, role: auth\.user\.role \}/);
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

test('run-event projection skips delta noise before touching the store', () => {
  assert.match(projection, /function isProjectableRunEvent\(type: string, payload: Record<string, unknown>, item: Record<string, unknown>\): boolean/);
  assert.match(projection, /if \(!isProjectableRunEvent\(innerType, payload, item\)\) return;\n\s+mutateStore\(\(store\) => \{/);
  assert.match(projection, /if \(result === false\) return result;\n\s+writeStore\(store\);/);
  assert.match(projection, /return changed \|\| false;/);
  assert.match(projection, /if \(isNoisyRunEvent\(type\)\) return false;/);
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
  assert.match(projection, /const content = toolResultContent\(output, innerType, payload\);/);
});

test('completed projected sessions hydrate canonical Agent tool rows when available', () => {
  assert.match(messagesRoute, /function hasCanonicalToolDetails\(messages: DeckMessage\[\]\): boolean/);
  assert.match(messagesRoute, /message\.role === 'tool' \|\| \(message\.toolCalls\?\.length \|\| 0\) > 0/);
  assert.match(messagesRoute, /function mergeCanonicalMessages\(apiMessages: DeckMessage\[\], projected: DeckMessage\[\], limit\?: number\): DeckMessage\[\]/);
  assert.match(messagesRoute, /const overlays = projected\.filter\(\(message\) => isProjectedOverlay\(message\) && !ids\.has\(message\.id\)\)/);
  assert.match(messagesRoute, /return kind === 'run-event' \|\| kind === 'approval'/);
  assert.match(messagesRoute, /const canonicalHasToolDetails = hasCanonicalToolDetails\(apiMessages\)/);
  assert.match(messagesRoute, /mergeCanonicalMessages\(apiMessages, projected, limit\)/);
  assert.match(messagesRoute, /mergeCanonicalMessages\(apiMessages, refreshed, limit\)/);
  assert.doesNotMatch(messagesRoute, /if \(!isRecoverableDraft\(projected\)\) return NextResponse\.json\(\{ messages: projected \}\);/);
  assert.match(messagesRoute, /if \(candidateUserIndexes\.length !== 1\) return null/);
});
