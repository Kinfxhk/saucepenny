// SPDX-License-Identifier: AGPL-3.0-or-later
// v0.3 in a real browser: menu engineering from typed and imported sales counts, and
// supplier price-list import with review, history and remembered matches.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  formatMoney,
  formatPercent,
  readProjectJson,
  verifiedMenuEngineering,
  verifiedProject,
  type StoredProject,
} from '../packages/core/src/index';
import { acceptDialogs, freshStorage, open, typeInto, watch } from './helpers';

test.beforeEach(async ({ page }) => {
  await freshStorage(page);
  acceptDialogs(page);
});

const example = (): StoredProject => {
  const r = readProjectJson(readFileSync('examples/cha-chaan-teng.json', 'utf8'));
  if (!r.ok) throw new Error('example invalid');
  return r.value.stored;
};
function expected(p: StoredProject, sold: Record<string, number>) {
  const r = readProjectJson(JSON.stringify(p));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const v = verifiedMenuEngineering(
    verifiedProject(r.value.project),
    new Map(Object.entries(sold)),
  );
  if (v.status !== 'ok') throw new Error(v.status);
  return v;
}
const QUAD = {
  keep: 'Keep (popular, high margin)',
  'raise-margin': 'Raise margin (popular, low margin)',
  promote: 'Promote (high margin, less popular)',
  rethink: 'Rethink (low margin, less popular)',
} as const;

test('menu engineering: typed counts give the verified groups; nothing is saved', async ({
  page,
  baseURL,
}) => {
  const w = watch(page, baseURL!);
  await open(page);
  await page.locator('#tab-menu').click();
  await expect(page.locator('#eng-summary')).toHaveText('Enter sales counts to see the groups.');
  const sold = {
    'm-char-siu-rice': 320,
    'm-milk-tea': 540,
    'm-iced-lemon-tea': 150,
    'm-char-siu-extra': 40,
  };
  for (const [id, n] of Object.entries(sold))
    await typeInto(page, `[data-sold="${id}"]`, String(n));
  const want = expected(example(), sold);
  for (const row of want.rows) {
    const tr = page.locator(`#eng-table tr[data-eng="${row.id}"]`);
    await expect(tr.locator('.e-group')).toHaveText(QUAD[row.quadrant]);
    await expect(tr.locator('.e-margin')).toHaveText(formatMoney(row.margin));
    await expect(tr.locator('.e-mix')).toHaveText(`${formatPercent(row.mix)}%`);
    await expect(tr.locator('.e-total')).toHaveText(formatMoney(row.totalMargin));
  }
  await expect(page.locator('#eng-summary')).toHaveText(
    `Total sold 1050 · sales-weighted average margin ${formatMoney(want.averageMargin)} · popular from ${formatPercent(want.popularLine)}% of sales`,
  );
  // all four groups appear in this example, so the colours are checked by axe below
  expect(new Set(want.rows.map((r) => r.quadrant)).size).toBeGreaterThan(1);
  await typeInto(page, '[data-sold="m-milk-tea"]', '1.5');
  await expect(page.locator('[data-sold="m-milk-tea"]')).toHaveAttribute('aria-invalid', 'true');
  const r = await new AxeBuilder({ page }).include('#menu-eng').analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await page.locator('#tab-menu').click();
  await expect(page.locator('[data-sold="m-char-siu-rice"]')).toHaveValue('');
  expect(w.external).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('menu engineering: sales CSV import (Chinese headers, merged rows, problems) and export', async ({
  page,
}) => {
  await open(page);
  await page.locator('#tab-menu').click();
  await page.locator('#sales-file').setInputFiles({
    name: 'sales.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      '\uFEFF項目,售出\r\n叉燒飯 Char siu rice,"1,200"\r\n熱奶茶 hot MILK tea,８００\r\n' +
        '凍檸茶 Iced lemon tea,100\r\n凍檸茶 Iced lemon tea,50\r\n炒飯,9\r\nm-char-siu-extra,abc\r\n',
      'utf8',
    ),
  });
  await expect(page.locator('#status')).toContainText('Sales counts read for 3 menu item(s).');
  await expect(page.locator('#status-list')).toContainText('Line 6: no menu item "炒飯"; skipped.');
  await expect(page.locator('#status-list')).toContainText('Line 7: "abc" is not a whole number');
  await expect(page.locator('#status-list')).toContainText('counts were added together');
  await expect(page.locator('[data-sold="m-char-siu-rice"]')).toHaveValue('1200');
  await expect(page.locator('[data-sold="m-milk-tea"]')).toHaveValue('800');
  await expect(page.locator('[data-sold="m-iced-lemon-tea"]')).toHaveValue('150');
  await expect(page.locator('[data-sold="m-char-siu-extra"]')).toHaveValue('');
  const want = expected(example(), {
    'm-char-siu-rice': 1200,
    'm-milk-tea': 800,
    'm-iced-lemon-tea': 150,
  });
  for (const row of want.rows)
    await expect(page.locator(`tr[data-eng="${row.id}"] .e-group`)).toHaveText(QUAD[row.quadrant]);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#eng-export').click(),
  ]);
  const csv = readFileSync((await dl.path())!, 'utf8');
  expect(
    csv.startsWith(
      '\uFEFFMenu item,Sold,Margin per portion,Share of sales,Group,Margin × sold\r\n',
    ),
  ).toBe(true);
  expect(csv).toContain('叉燒飯 Char siu rice,1200,');
  const [sheet] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#sales-template').click(),
  ]);
  expect(readFileSync((await sheet.path())!, 'utf8')).toContain('加叉燒 Extra char siu,0\r\n');
  await page.locator('#lang').selectOption('zh-HK');
  await expect(page.locator('#eng-title')).toHaveText('餐牌分析：哪些菜式值得留下？');
});

test('supplier price list: review, choose a match, apply; history kept; match remembered', async ({
  page,
  baseURL,
}) => {
  const w = watch(page, baseURL!);
  await open(page);
  await page.locator('#tab-impact').click();
  const csv =
    'code,name,pack qty,unit,price,price date\r\n' +
    'S1,砂糖 Sugar,2,kg,28,2026-10-01\r\n' + // 13/kg → 14/kg
    'S2,檸檬 lemon,1,piece,4.5,\r\n' + // same price
    'S3,Evap milk 410g,410,g,12.5,\r\n' + // needs a match
    'S4,菜心 Choi sum,1,kg,30,\r\n'; // catty → kg
  await page.locator('#supplier-file').setInputFiles({
    name: 'supplier.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  await expect(page.locator('#status')).toContainText(
    'Read 4 row(s); 1 need an ingredient chosen.',
  );
  await expect(page.locator('#supplier-notes')).toContainText('Unknown column "code" ignored.');
  const rows = page.locator('#supplier-table tbody tr');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0).locator('.s-change')).toHaveText('+7.7% per unit');
  await expect(rows.nth(1).locator('.s-change')).toHaveText('same price');
  await expect(rows.nth(1).locator('[data-sup-use]')).not.toBeChecked();
  await expect(rows.nth(2).locator('[data-sup-use]')).toBeDisabled();
  await expect(page.locator('#supplier-apply')).toHaveText('Apply 2 change(s)');
  await page.locator('[data-sup-match="2"]').selectOption('evap-milk');
  await expect(page.locator('#supplier-table tbody tr').nth(2).locator('.s-change')).toHaveText(
    '+8.7% per unit',
  );
  await expect(page.locator('#supplier-apply')).toHaveText('Apply 3 change(s)');
  await page.locator('#supplier-apply').click();
  await expect(page.locator('#status')).toContainText('Updated 3 price(s).');
  await expect(page.locator('#supplier-table')).toHaveCount(0);
  // history for sugar: the old 13 / 1 kg, dated with today's date (no earlier date)
  await page.locator('#impact-ingredient').selectOption('sugar');
  await expect(page.locator('#history-table tbody tr')).toHaveCount(1);
  await expect(page.locator('#history-table tbody tr').first()).toContainText('13');
  await page.locator('#tab-ingredients').click();
  await expect(page.locator('[data-key="ing:sugar:price"]')).toHaveValue('28');
  await expect(page.locator('[data-key="ing:sugar:packQty"]')).toHaveValue('2');
  await expect(page.locator('[data-key="ing:greens:packUnit"]')).toHaveValue('kg');
  await expect(page.locator('[data-key="ing:evap-milk:price"]')).toHaveValue('12.5');
  // the match for "Evap milk 410g" is remembered on this device
  await page.locator('#tab-impact').click();
  await page.locator('#supplier-file').setInputFiles({
    name: 'supplier2.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,pack qty,unit,price\r\nEvap milk 410g,410,g,13\r\n', 'utf8'),
  });
  await expect(page.locator('#status')).toContainText(
    'Read 1 row(s); 0 need an ingredient chosen.',
  );
  await expect(page.locator('[data-sup-match="0"]')).toHaveValue('evap-milk');
  await page.locator('#supplier-cancel').click();
  await expect(page.locator('#supplier-table')).toHaveCount(0);
  const r = await new AxeBuilder({ page }).include('#supplier').analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  expect(w.external).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('supplier price list: two rows for one ingredient are refused', async ({ page }) => {
  await open(page);
  await page.locator('#tab-impact').click();
  await page.locator('#supplier-file').setInputFiles({
    name: 's.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('name,pack qty,unit,price\r\n砂糖 Sugar,1,kg,14\r\nSugar B,1,kg,15\r\n'),
  });
  await page.locator('[data-sup-match="1"]').selectOption('sugar');
  await page.locator('#supplier-apply').click();
  await expect(page.locator('#status')).toContainText('Two rows would update 砂糖 Sugar.');
  await page.locator('#tab-ingredients').click();
  await expect(page.locator('[data-key="ing:sugar:price"]')).toHaveValue('13');
});

test('menu engineering groups have enough contrast in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await open(page);
  await page.locator('#tab-menu').click();
  for (const [id, n] of Object.entries({
    'm-char-siu-rice': 320,
    'm-milk-tea': 540,
    'm-iced-lemon-tea': 150,
    'm-char-siu-extra': 400,
  }))
    await typeInto(page, `[data-sold="${id}"]`, String(n));
  await expect(page.locator('[data-quadrant="keep"]').first()).toBeVisible();
  const r = await new AxeBuilder({ page }).include('#menu-eng').analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
});
