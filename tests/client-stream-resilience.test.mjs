import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  isRecoverableStreamTransportError,
  shouldApplyStreamRecoveryUpdate,
  streamErrorMessage,
  STREAM_RECOVERY_FAILED_MESSAGE,
  STREAM_RECONNECTING_MESSAGE,
} from '../src/lib/chat-stream-resilience.ts';

const root = process.cwd();
const useChatStream = fs.readFileSync(path.join(root, 'src/app/chat/_hooks/useChatStream.ts'), 'utf8');
const chatLayoutView = fs.readFileSync(path.join(root, 'src/app/chat/_components/ChatLayoutView.tsx'), 'utf8');

test('mobile WebKit fetch failures are recoverable stream transport drops unless explicitly aborted', () => {
  assert.equal(isRecoverableStreamTransportError(new TypeError('Load failed'), false), true);
  assert.equal(isRecoverableStreamTransportError(new TypeError('Failed to fetch'), false), true);
  assert.equal(isRecoverableStreamTransportError(new TypeError('fetch failed'), false), true);
  assert.equal(isRecoverableStreamTransportError(new DOMException('The operation was aborted.', 'AbortError'), false), true);
  assert.equal(isRecoverableStreamTransportError(new TypeError('Load failed'), true), false);
  assert.equal(isRecoverableStreamTransportError(new Error('401 Unauthorized'), false), false);
});

test('server non-OK Error bodies that mention fetch/network stay non-recoverable', () => {
  const serverError = new Error('{"error":"upstream fetch failed while calling provider"}');
  assert.equal(isRecoverableStreamTransportError(serverError, false), false);
  assert.equal(streamErrorMessage(serverError, { explicitAbort: false }), serverError.message);
  assert.notEqual(streamErrorMessage(serverError, { explicitAbort: false }), STREAM_RECONNECTING_MESSAGE);
  assert.equal(isRecoverableStreamTransportError(new Error('network error from API: 500'), false), false);
});

test('recoverable stream errors normalize away raw Load failed text', () => {
  assert.equal(streamErrorMessage(new TypeError('Load failed'), { explicitAbort: false }), STREAM_RECONNECTING_MESSAGE);
  assert.equal(streamErrorMessage(new TypeError('Failed to fetch'), { explicitAbort: false, recoveryFailed: true }), STREAM_RECOVERY_FAILED_MESSAGE);
  assert.doesNotMatch(streamErrorMessage(new TypeError('Load failed'), { explicitAbort: false }), /Load failed/i);
  assert.equal(streamErrorMessage(new TypeError('Load failed'), { explicitAbort: true }), 'Load failed');
});

test('recovery update guard rejects explicit aborts and superseded streams', () => {
  const active = { streamId: 10, profile: 'default', sessionId: 's1' };
  assert.equal(shouldApplyStreamRecoveryUpdate(active, { streamId: 10, profile: 'default' }, false), true);
  assert.equal(shouldApplyStreamRecoveryUpdate(active, { streamId: 11, profile: 'default' }, false), false);
  assert.equal(shouldApplyStreamRecoveryUpdate(active, { streamId: 10, profile: 'other' }, false), false);
  assert.equal(shouldApplyStreamRecoveryUpdate(active, { streamId: 10, profile: 'default' }, true), false);
});

test('useChatStream attempts hub resume before bounded projection polling on recoverable drops', () => {
  assert.match(useChatStream, /isRecoverableStreamTransportError\(e, ac\.signal\.aborted\)/);
  assert.match(useChatStream, /recoverTransportDrop\(\{/);
  assert.match(useChatStream, /resumeChatStreamClient\(/);
  assert.match(useChatStream, /deckApi\.messages\(sid, init\.profile, init\.signal\)/);
  assert.match(useChatStream, /for \(let attempt = 0; attempt < 8; attempt \+= 1\)/);
  assert.match(useChatStream, /shouldApplyStreamRecoveryUpdate\(/);
});

test('recoverable send path resumes with immutable original hub key after session reconcile', () => {
  assert.match(useChatStream, /const originalHubKey = sid;/);
  assert.match(useChatStream, /hubKey: originalHubKey,/);
  assert.match(useChatStream, /const recoveryHubKey = inf && inf\.streamId === streamId \? inf\.hubKey : originalHubKey;/);
  assert.match(useChatStream, /recoverTransportDrop\(\{\s*hubKey: recoveryHubKey,/s);
});

test('terminal transport failures converge only the current stream row from running to failed', () => {
  assert.match(useChatStream, /const failCurrentStream = useCallback\([\s\S]*!inf \|\| inf\.sessionId !== sid[\s\S]*shouldApplyStreamRecoveryUpdate\([\s\S]*x\.id === sid && x\.profileId === owner\.profile[\s\S]*chatStatus: 'failed'/);
  assert.match(useChatStream, /const recovered = await recoverTransportDrop\([\s\S]*if \(!recovered && !ac\.signal\.aborted && !isAbortedRef\.current\) \{[\s\S]*failCurrentStream\(\{ streamId, profile \}, sid\);/);
  assert.match(useChatStream, /else if \(!ac\.signal\.aborted\) \{[\s\S]*failCurrentStream\(\{ streamId, profile \}, sid\);/);
  assert.match(useChatStream, /if \(!fetchedTerminalProjection\) failCurrentStream\(\{ streamId, profile \}, liveSid\);/);
});

test('recovering transport drops do not render as terminal red Request failed / Load failed card', () => {
  assert.match(chatLayoutView, /p\.error === STREAM_RECONNECTING_MESSAGE/);
  assert.match(chatLayoutView, /isRecoveringStream \? '正在恢复连接' : p\.t\.requestFailed/);
  assert.match(chatLayoutView, /isRecoveringStream \? 'var\(--surface-bg\)' : 'var\(--status-red-bg\)'/);
});
