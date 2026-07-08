import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('bilingual UI controls and translations are wired into major HermesDeck surfaces', () => {
  const i18n = read('src/lib/i18n.tsx');
  assert.match(i18n, /export type Lang = 'zh' \| 'en'/);
  assert.match(i18n, /localizeError/);
  assert.match(i18n, /Cross-origin request rejected/);
  assert.match(i18n, /const DEFAULT_LANG: Lang = 'en'/);

  const shell = read('src/components/AppShell.tsx');
  assert.match(shell, /toggleLang/);
  assert.match(shell, /navHome:\s+\{ label: '主页'/);
  assert.match(shell, /navHome:\s+\{ label: 'Home'/);
  assert.match(shell, /navTerminal:\s+\{ label: '终端'/);
  assert.match(shell, /navTerminal:\s+\{ label: 'Terminal'/);

  const login = read('src/app/login/page.tsx');
  assert.match(login, /LanguageToggle/);
  assert.match(login, /localizeError/);
  assert.match(login, /subtitle: '登录以访问控制台'/);
  assert.match(login, /subtitle: 'Sign in to access the deck'/);

  const register = read('src/app/register/page.tsx');
  assert.match(register, /LanguageToggle/);
  assert.match(register, /提交注册/);
  assert.match(register, /Request account/);

  const pending = read('src/app/pending/page.tsx');
  assert.match(pending, /LanguageToggle/);
  assert.match(pending, /账户待批准/);
  assert.match(pending, /Account pending approval/);

  const settings = read('src/app/settings/page.tsx');
  assert.match(settings, /setLang\('zh'\)/);
  assert.match(settings, /setLang\('en'\)/);
  assert.match(settings, /用户名与密码/);
  assert.match(settings, /Username & password/);

  const admin = read('src/components/AdminUsersPanel.tsx');
  assert.match(admin, /用户审批与 Agent 分配/);
  assert.match(admin, /User approvals & Agent assignments/);
  assert.match(admin, /localizeError/);

  const chat = read('src/app/chat/_lib/i18n.ts');
  assert.match(chat, /composerPlaceholder: '向 Hermes 提问/);
  assert.match(chat, /composerPlaceholder: 'Ask Hermes/);

  const sw = read('public/sw.js');
  assert.match(sw, /const CACHE_VERSION = 'hermesdeck-pwa-v\d+'/);
  assert.match(sw, /const SHELL_CACHE = `\$\{CACHE_VERSION\}-shell`/);
  assert.match(sw, /const RUNTIME_CACHE = `\$\{CACHE_VERSION\}-runtime`/);
});

test('dashboard and tools copy matches current Agent API data paths', () => {
  const tools = read('src/app/tools/page.tsx');
  assert.doesNotMatch(tools, /Hermes CLI/);
  assert.match(tools, /Hermes Agent API/);
  assert.match(tools, /Deck BFF/);

  const dashboard = read('src/app/page.tsx');
  assert.doesNotMatch(dashboard, /All data sourced from Hermes-native/);
  assert.doesNotMatch(dashboard, /<Kbd>state\.db<\/Kbd>/);
  assert.doesNotMatch(dashboard, /~\/\.hermes\/state\.db/);
  assert.doesNotMatch(dashboard, /Safe terminal/);
  assert.doesNotMatch(dashboard, /allow-listed cmds/);
  assert.match(dashboard, /Hermes Agent API · Deck projection · local metadata/);
  assert.match(dashboard, /Hermes Agent API · Deck 投影 · 本地元数据/);

  const manifest = read('src/app/manifest.ts');
  assert.doesNotMatch(manifest, /Safe terminal/);
  assert.doesNotMatch(manifest, /profile switching/);
  assert.match(manifest, /Live Terminal/);

  const handoffCopy = [
    read('docs/design-handoff/ui_kits/webui/Dashboard.jsx'),
    read('docs/design-handoff/ui_kits/webui/Pages.jsx'),
    read('docs/design-handoff/ui_kits/webui/Terminal.jsx'),
    read('docs/design-handoff/ui_kits/webui/ChatView.jsx'),
    read('docs/design-handoff/preview/type-mono.html'),
    read('docs/design-handoff/preview/type-body.html'),
    read('docs/design-handoff/preview/components-card.html'),
    read('docs/design-handoff/preview/components-tags.html'),
  ].join('\n');
  assert.doesNotMatch(handoffCopy, /Safe terminal|safe terminal|安全终端|允许列表命令|Hermes CLI|state\.db|Terminal allowlist|allowlisted actions|allowlist|shell:false|hermes auth list|timeout 60s|truncate 4 KB|future versions will edit it/);
  assert.match(handoffCopy, /Hermes Agent API/);
  assert.match(handoffCopy, /Live Terminal/);
});
