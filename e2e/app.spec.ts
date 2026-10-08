// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test } from '@playwright/test';
import { open, watch } from './helpers';

test('page loads with the source link, licence and no external requests', async ({
  page,
  baseURL,
}) => {
  const w = watch(page, baseURL!);
  await open(page);
  await expect(page.locator('h1')).toContainText('Saucepenny');
  await expect(page.locator('#source-link')).toHaveAttribute(
    'href',
    /^https:\/\/github\.com\/Kinfxhk\/saucepenny\/tree\/v\d+\.\d+\.\d+$/,
  );
  const licence = await page.request.get('/licenses/Saucepenny-LICENSE.txt');
  expect(licence.status()).toBe(200);
  expect(await licence.text()).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
  expect(w.external).toEqual([]);
  expect(w.errors).toEqual([]);
});
