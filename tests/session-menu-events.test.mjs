import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

test('session menu pointer actions execute before synthetic row click can navigate', () => {
  const source = read('src/components/SessionMenu.tsx');

  assert.match(source, /const runPointerAction = \(e: React\.PointerEvent<HTMLButtonElement>, run: \(\) => void\) => \{/);
  assert.match(source, /typeof e\.button === 'number' && e\.button !== 0[\s\S]*?e\.stopPropagation\(\);[\s\S]*?return;/);
  assert.match(source, /runPointerAction[\s\S]*?e\.preventDefault\(\);[\s\S]*?e\.stopPropagation\(\);[\s\S]*?run\(\);/);
  assert.match(source, /onPointerDown=\{\(e\) => runPointerAction\(e, run\)\}/);
  assert.match(source, /onClick=\{stopClick\}/);
  assert.match(source, /onKeyDown=\{\(e\) => runKeyboardAction\(e, run\)\}/);
});

test('session row action island blocks bubbling into openSession', () => {
  const source = read('src/app/chat/_components/SessionsSidebar.tsx');

  assert.match(source, /className="session-actions"[\s\S]*?onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}[\s\S]*?onClick=\{\(e\) => e\.stopPropagation\(\)\}[\s\S]*?onKeyDown=\{\(e\) => \{[\s\S]*?e\.key === 'Enter'[\s\S]*?e\.stopPropagation\(\)/);
  assert.match(source, /className="session-kebab"[\s\S]*?onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}[\s\S]*?onKeyDown=\{\(e\) => \{[\s\S]*?e\.key === 'Enter'[\s\S]*?e\.stopPropagation\(\)/);
});
