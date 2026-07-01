import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

test('opening a session explicitly reuses hook-level bottom settle', () => {
  const pageSource = read('src/app/chat/page.tsx');
  const hookSource = read('src/app/chat/_hooks/useChatScroll.ts');

  assert.doesNotMatch(pageSource, /requestAnimationFrame\(\(\) => scrollToBottom\(false\)\)/);
  assert.match(pageSource, /const \{ messagesRef, stickToBottomRef, showJumpToBottom, scrollToBottom, settleToBottom \} = useChatScroll/);
  assert.match(pageSource, /const openSessionMobile = useCallback\(\(s: LocalSession\) => \{[\s\S]*?openSession\(s\);[\s\S]*?enterThread\(\);[\s\S]*?settleToBottom\(\);[\s\S]*?\}, \[openSession, enterThread, settleToBottom\]\);/);

  assert.match(hookSource, /const settleToBottom = useCallback\(\(\) => \{[\s\S]*?requestAnimationFrame[\s\S]*?\[60, 200, 500, 900, 1500\][\s\S]*?ResizeObserver[\s\S]*?userScrolledAwayRef\.current[\s\S]*?\}, \[scrollToBottom\]\);/);
  assert.match(hookSource, /useEffect\(\(\) => \{[\s\S]*?const cleanup = settleToBottom\(\);[\s\S]*?\}, \[active, settleToBottom\]\);/);
  assert.match(hookSource, /return \{[\s\S]*?settleToBottom,[\s\S]*?\};/);
});
