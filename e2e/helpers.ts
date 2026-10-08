// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Page } from '@playwright/test';

/** Collect requests to other origins, console errors and page errors (incl. CSP). */
export function watch(page: Page, baseURL: string): { external: string[]; errors: string[] } {
  const external: string[] = [];
  const errors: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(baseURL) && !url.startsWith('data:') && !url.startsWith('blob:'))
      external.push(url);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return { external, errors };
}

export async function open(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await page.locator('body[data-ready="true"]').waitFor();
}

/** Accept confirm() dialogs automatically. */
export function acceptDialogs(page: Page): void {
  page.on('dialog', (d) => void d.accept());
}

/** Start every test with empty storage (but keep it across reloads inside a test). */
export async function freshStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      sessionStorage.setItem('e2e-init', '1');
      localStorage.clear();
      indexedDB.deleteDatabase('saucepenny');
    }
  });
}

/** Clear a field and type into it with the keyboard (works for Chinese text too). */
export async function typeInto(page: Page, selector: string, text: string): Promise<void> {
  const el = page.locator(selector);
  await el.click();
  await el.press('ControlOrMeta+a');
  await el.press('Delete');
  await page.keyboard.type(text);
  await el.press('Tab');
}
