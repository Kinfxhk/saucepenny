#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Regenerate docs/screenshot.png (the invented cha chaan teng example) against a running
// server or the live site.
// Usage: npm start (in another terminal), then
//   PW_CHROMIUM_PATH=/usr/bin/google-chrome npm run screenshot [-- http://127.0.0.1:4893]
import { chromium } from '@playwright/test';

const base = (process.argv[2] ?? 'http://127.0.0.1:4893').replace(/\/$/, '');
const executablePath = process.env.PW_CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  locale: 'en-US',
});
await page.addInitScript(() => {
  localStorage.setItem(
    'saucepenny-settings',
    JSON.stringify({ lang: 'en', theme: 'light', large: false, tab: 'recipes' }),
  );
  globalThis.indexedDB.deleteDatabase('saucepenny'); // always the bundled example
});
await page.goto(`${base}/`);
await page.locator('body[data-ready="true"]').waitFor();
await page.locator('button[data-recipe="char-siu-rice"]').click();
await page.locator('.sub-row summary').first().click();
await page.locator('#recipe-total').filter({ hasText: /\d/ }).waitFor();
const main = await page.locator('#panel-recipes').boundingBox();
await page.screenshot({
  path: 'docs/screenshot.png',
  clip: { x: 0, y: 0, width: 1280, height: Math.ceil(main.y + main.height + 16) },
});
await browser.close();
console.info('wrote docs/screenshot.png');
