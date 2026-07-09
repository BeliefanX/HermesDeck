import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const checks = [
  ['src/app/manifest.ts', 'PWA manifest route'],
  ['public/sw.js', 'service worker'],
  ['src/components/PWARegister.tsx', 'service worker registrar'],
  ['public/icons/icon-192.png', '192px icon'],
  ['public/icons/icon-512.png', '512px icon'],
  ['public/icons/maskable-512.png', 'maskable icon'],
  ['public/icons/apple-touch-icon.png', 'Apple touch icon'],
  ['src/app/offline/page.tsx', 'offline page'],
];
let ok = true;
for (const [file, label] of checks) {
  if (!existsSync(join(root, file))) {
    console.error(`missing ${label}: ${file}`);
    ok = false;
  }
}
const layout = existsSync(join(root, 'src/app/layout.tsx')) ? readFileSync(join(root, 'src/app/layout.tsx'), 'utf8') : '';
for (const token of ['manifest', 'appleWebApp', 'export const viewport', '<PWARegister']) {
  if (!layout.includes(token)) {
    console.error(`layout missing ${token}`);
    ok = false;
  }
}
const css = existsSync(join(root, 'src/app/globals.css')) ? readFileSync(join(root, 'src/app/globals.css'), 'utf8') : '';
for (const token of ['--safe-bottom', '.mobile-nav', '100dvh']) {
  if (!css.includes(token)) {
    console.error(`css missing ${token}`);
    ok = false;
  }
}
if (!/@media\s*\(max-width:\s*\d{3}px\)/.test(css)) {
  console.error('css missing mobile breakpoint @media (max-width: …px)');
  ok = false;
}
const registrar = existsSync(join(root, 'src/components/PWARegister.tsx')) ? readFileSync(join(root, 'src/components/PWARegister.tsx'), 'utf8') : '';
for (const token of ['registration.waiting !== worker', 'pendingWorker.current', 'setUpdateReady(false)']) {
  if (!registrar.includes(token)) {
    console.error(`PWARegister missing stale waiting-worker guard token: ${token}`);
    ok = false;
  }
}
const sw = existsSync(join(root, 'public/sw.js')) ? readFileSync(join(root, 'public/sw.js'), 'utf8') : '';
const appShellMatch = sw.match(/const\s+APP_SHELL\s*=\s*\[([\s\S]*?)\];/);
if (!appShellMatch) {
  console.error('service worker missing APP_SHELL declaration');
  ok = false;
} else {
  const appShellLiteral = appShellMatch[1];
  const protectedRoutes = ['/', '/chat', '/chat?source=pwa', '/cron', '/tools', '/terminal', '/config', '/lcm', '/settings'];
  for (const route of protectedRoutes) {
    const quoted = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`['\"]${quoted}['\"]`).test(appShellLiteral)) {
      console.error(`service worker APP_SHELL must not precache protected route: ${route}`);
      ok = false;
    }
  }
}
const navigateMatch = sw.match(/if\s*\(req\.mode\s*===\s*['"]navigate['"]\)\s*\{([\s\S]*?)\n\s*\}\n\s*\n\s*\/\/ Static assets/);
if (!navigateMatch) {
  console.error('service worker missing navigation fetch block');
  ok = false;
} else {
  const navigateBlock = navigateMatch[1];
  if (/putWithTrim|RUNTIME_CACHE|caches\.match\(req\)|chatHit|\/chat\?source=pwa/.test(navigateBlock)) {
    console.error('service worker navigation block must not runtime-cache arbitrary protected HTML or use chat-specific fallback');
    ok = false;
  }
  if (!/caches\.match\(['"]\/offline['"]\)/.test(navigateBlock)) {
    console.error('service worker navigation block must fall back to /offline');
    ok = false;
  }
}
if (!/!res\.redirected[\s\S]*putWithTrim\(RUNTIME_CACHE/.test(sw)) {
  console.error('service worker static runtime cache must skip redirected responses');
  ok = false;
}
try {
  const changed = execSync('git diff --name-only HEAD -- public/sw.js', { encoding: 'utf8' }).trim();
  if (changed) {
    const versionChanged = execSync('git diff HEAD -- public/sw.js', { encoding: 'utf8' });
    if (!/[-+]const CACHE_VERSION = /.test(versionChanged)) {
      console.error('public/sw.js changed without a CACHE_VERSION bump');
      ok = false;
    }
  }
} catch {}
if (!ok) process.exit(1);
console.log('PWA checks passed');
