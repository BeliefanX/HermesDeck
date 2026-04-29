import { existsSync, readFileSync } from 'node:fs';
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
if (!ok) process.exit(1);
console.log('PWA checks passed');
