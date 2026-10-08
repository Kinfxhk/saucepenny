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
