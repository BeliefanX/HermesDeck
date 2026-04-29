import { createRequire } from 'node:module';
const require = createRequire('/Users/fanxuxin/.hermes/hermes-agent/package.json');
const { chromium } = require('playwright');

const url = process.env.URL || 'http://127.0.0.1:6117/chat';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
const result = await page.evaluate(() => {
  const q = (s) => document.querySelector(s);
  const layout = q('.chat-layout');
  const section = q('section.chat-panel');
  const messages = q('.messages');
  const composer = q('.composer');
  const before = {
    viewport: { w: innerWidth, h: innerHeight },
    body: { scrollHeight: document.body.scrollHeight, clientHeight: document.documentElement.clientHeight },
    layout: layout ? { height: getComputedStyle(layout).height, scrollHeight: layout.scrollHeight, clientHeight: layout.clientHeight, overflow: getComputedStyle(layout).overflow } : null,
    section: section ? { height: getComputedStyle(section).height, scrollHeight: section.scrollHeight, clientHeight: section.clientHeight, overflow: getComputedStyle(section).overflow } : null,
    messages: messages ? { height: getComputedStyle(messages).height, scrollHeight: messages.scrollHeight, clientHeight: messages.clientHeight, overflowY: getComputedStyle(messages).overflowY } : null,
    composer: composer ? { position: getComputedStyle(composer).position, bottom: getComputedStyle(composer).bottom } : null,
  };
  if (messages) {
    messages.innerHTML = Array.from({ length: 40 }, (_, i) => `<div class="msg assistant">probe message ${i}<br/>line<br/>line</div>`).join('');
  }
  const after = {
    body: { scrollHeight: document.body.scrollHeight, clientHeight: document.documentElement.clientHeight },
    layout: layout ? { height: getComputedStyle(layout).height, scrollHeight: layout.scrollHeight, clientHeight: layout.clientHeight } : null,
    section: section ? { height: getComputedStyle(section).height, scrollHeight: section.scrollHeight, clientHeight: section.clientHeight } : null,
    messages: messages ? { height: getComputedStyle(messages).height, scrollHeight: messages.scrollHeight, clientHeight: messages.clientHeight, canScroll: messages.scrollHeight > messages.clientHeight + 2 } : null,
  };
  return { before, after };
});
console.log(JSON.stringify(result, null, 2));
await browser.close();
