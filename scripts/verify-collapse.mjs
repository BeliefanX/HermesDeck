// Verify: sidebar collapse/expand + chat panel toggles + tighter layout.
import { chromium } from '/Users/fanxuxin/.hermes/hermes-agent/node_modules/playwright/index.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:6117';
const OUT = '/tmp/hermesdeck-shots';

async function main() {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1500, height: 900 },
      colorScheme: 'dark',
    });
    const page = await ctx.newPage();

    // Home — sidebar expanded
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${OUT}/v2-home-expanded.png`, fullPage: false });

    // Click collapse
    await page.click('.sidebar-toggle');
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}/v2-home-collapsed.png`, fullPage: false });

    // Re-expand
    await page.click('.sidebar-toggle');
    await page.waitForTimeout(450);

    // Chat — three panels at 1500
    await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${OUT}/v2-chat-3panels.png`, fullPage: false });

    // Hide right (timeline)
    await page.click('.panel-toggle-right');
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}/v2-chat-no-timeline.png`, fullPage: false });

    // Hide left (sessions)
    await page.click('.panel-toggle-left');
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}/v2-chat-no-both.png`, fullPage: false });

    // Restore left
    await page.click('.panel-toggle-left');
    await page.waitForTimeout(450);

    // Combine: collapse sidebar AND hide timeline (room for chat focus)
    // Need a sidebar present on chat page — collapse it
    await page.click('.sidebar-toggle');
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}/v2-chat-sidebar-collapsed.png`, fullPage: false });

    // Compute layout metrics
    const metrics = await page.evaluate(() => {
      const layout = document.querySelector('.chat-layout');
      const sidebar = document.querySelector('.sidebar');
      const sessions = document.querySelector('.chat-panel.sessions-panel');
      const right = document.querySelector('.chat-panel.right-panel');
      return {
        sidebarWidth: sidebar?.getBoundingClientRect().width,
        layoutCols: getComputedStyle(layout).gridTemplateColumns,
        gap: getComputedStyle(layout).gap,
        sessionsW: sessions?.getBoundingClientRect().width,
        rightW: right?.getBoundingClientRect().width,
      };
    });
    console.log('metrics:', JSON.stringify(metrics, null, 2));

    // Mobile chat — should keep working as before, no toggles
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${OUT}/v2-chat-mobile.png`, fullPage: false });

    // Light theme home
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
      try { localStorage.setItem('hermesdeck-theme', 'light'); } catch {}
    });
    await page.click('.sidebar-toggle');
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}/v2-home-collapsed-light.png`, fullPage: false });

    console.log('OK');
  } finally {
    await browser.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
