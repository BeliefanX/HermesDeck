import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('chat slash menu exposes the complete command catalog and quick-start prompts', () => {
  const prompts = read('src/lib/prompts.ts');
  const commandKeys = [...prompts.matchAll(/key:\s*'([^']+)'/g)].map((m) => m[1]);

  assert.deepEqual(commandKeys, [
    'new', 'clear', 'regen', 'stop',
    'summarize', 'translate-en', 'translate-zh', 'explain', 'fix', 'test',
    'refactor', 'docstring', 'improve', 'brainstorm', 'plan',
    'deck', 'profile', 'readme',
  ]);

  // The last three mirror the empty-state quick actions so those prompts are
  // discoverable after the welcome screen is gone too.
  assert.match(prompts, /deckTpl: '请介绍一下 HermesDeck 现在能做些什么。\{cursor\}'/);
  assert.match(prompts, /profileTpl: '请列出当前 Profile 的模型与工具集。\{cursor\}'/);
  assert.match(prompts, /readmeTpl: '请为本次会话起草一段 README 描述。\{cursor\}'/);
});

test('slash menu popover is sized for discoverability, not a four-row clipped list', () => {
  const menu = read('src/components/SlashCommandMenu.tsx');
  assert.match(menu, /slash-count/);
  assert.match(menu, /slash-list/);

  const css = read('src/app/globals.css');
  assert.match(css, /\.slash-menu\{[\s\S]*max-height:min\(70vh, 640px\)/);
  assert.match(css, /@media \(max-width:880px\)\{[\s\S]*\.slash-menu\{max-height:min\(82vh, 720px\)\}/);
  assert.match(css, /@media \(max-width:880px\)\{[\s\S]*\.slash-desc\{display:none\}/);
  assert.match(css, /\.slash-list\{display:grid/);
  assert.match(css, /@media \(min-width:560px\)\{[\s\S]*\.slash-list\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(css, /\.slash-menu\{[\s\S]{0,180}max-height:300px/);
});
