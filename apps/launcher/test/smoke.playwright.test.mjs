// Headless browser smoke test. Skipped when Playwright cannot be required, and when Chromium cannot launch.
// Does not install anything: it uses whatever require('playwright') and the installed browser provide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALLOW, DENY, SESSION, startLauncher, startMockCentral, testConfig } from './helpers.mjs';

const require = createRequire(import.meta.url);
let chromium = null;
let skipReason = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  skipReason = 'playwright is not available (require("playwright") failed)';
}

const SCREENSHOT = process.env.LAUNCHER_SCREENSHOT_PATH ?? join(tmpdir(), 'titan-launcher-mobile.png');

async function startStack() {
  const central = await startMockCentral((req, res) => {
    const url = new URL(req.url, 'http://x');
    const application = url.searchParams.get('application');
    const ok = url.pathname === '/v1/access/check' && req.headers.authorization === `Bearer ${SESSION.accessToken}`;
    const decision = application === 'field' ? ALLOW : application === 'desk' ? DENY : [503, { error: 'access_unavailable' }];
    res.writeHead(ok ? decision[0] : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? decision[1] : { error: 'unauthenticated' }));
  });
  const config = testConfig({ centralOrigin: central.origin, signIn: { applicationId: 'desk' } });
  const launcher = await startLauncher({ config, resolveSession: async () => SESSION });
  return {
    origin: launcher.origin,
    close: async () => { await launcher.close(); await central.close(); },
  };
}

test('launcher renders in a headless browser at phone width, is keyboard operable and does not scroll sideways', { skip: skipReason ?? false }, async (t) => {
  const stack = await startStack();
  let browser;
  try {
    try {
      browser = await chromium.launch();
    } catch (error) {
      return t.skip(`chromium could not launch: ${error.message.split('\n')[0]}`);
    }

    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await page.goto(`${stack.origin}/`);
    assert.equal(await page.locator('h1').innerText(), 'Your products');
    assert.equal(await page.locator('.product').count(), 3);
    assert.equal(await page.locator('.product a.button').count(), 1, 'only the allowed product has a link');

    // Keyboard: the skip link comes first, then the allowed product link must be reachable with Tab.
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
    let reached = false;
    for (let i = 0; i < 12 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement.textContent === 'Open Sorted');
    }
    assert.ok(reached, 'Open Sorted is reachable by keyboard');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `no horizontal scroll at 390px (overflow ${overflow}px)`);

    await page.screenshot({ path: SCREENSHOT, fullPage: true });
    await page.close();

    const narrow = await browser.newPage({ viewport: { width: 320, height: 640 } });
    await narrow.goto(`${stack.origin}/`);
    const narrowOverflow = await narrow.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(narrowOverflow <= 0, `no horizontal scroll at 320px (overflow ${narrowOverflow}px)`);
    await narrow.close();
  } finally {
    if (browser) await browser.close();
    await stack.close();
  }
});
