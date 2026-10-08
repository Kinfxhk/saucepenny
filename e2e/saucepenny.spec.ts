// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatUnitMoney,
  menuRows,
  readProjectJson,
  recipeCard,
  verifiedIngredientCosts,
  verifiedProject,
} from '../packages/core/src/index';
import { run } from '../packages/cli/src/main';
import { bigProject } from '../test/bench/big-project';
import { acceptDialogs, freshStorage, open, typeInto, watch } from './helpers';

test.beforeEach(async ({ page }) => {
  await freshStorage(page);
  acceptDialogs(page);
});

const ing = (id: string, field: string) => `tr[data-ing="${id}"] [data-key="ing:${id}:${field}"]`;

async function addIngredient(
  page: Page,
  name: string,
  qty: string,
  unitLabel: string,
  price: string,
  yieldPct?: string,
): Promise<string> {
  await page.locator('#add-ingredient').click();
  const id = await page.locator('#ingredient-table tbody tr').last().getAttribute('data-ing');
  await typeInto(page, ing(id!, 'name'), name);
  await typeInto(page, ing(id!, 'packQty'), qty);
  await page.locator(ing(id!, 'packUnit')).selectOption({ label: unitLabel });
  await typeInto(page, ing(id!, 'price'), price);
  if (yieldPct) await typeInto(page, ing(id!, 'yieldPercent'), yieldPct);
  return id!;
}

async function addLine(
  page: Page,
  recipe: string,
  item: string,
  qty: string,
  unitLabel: string,
  waste?: string,
): Promise<void> {
  await page.locator('#add-line').click();
  const j = (await page.locator('#line-table tbody tr[data-line]').count()) - 1;
  const k = `rec:${recipe}:line:${j}`;
  await page.locator(`[data-key="${k}:item"]`).selectOption({ label: item });
  await typeInto(page, `[data-key="${k}:qty"]`, qty);
  await page.locator(`[data-key="${k}:unit"]`).selectOption({ label: unitLabel });
  if (waste) await typeInto(page, `[data-key="${k}:waste"]`, waste);
}

async function addRecipe(
  page: Page,
  name: string,
  yieldQty: string,
  unitLabel: string,
): Promise<string> {
  await page.locator('#add-recipe').click();
  const id = await page
    .locator('#recipe-list button[aria-current="true"]')
    .getAttribute('data-recipe');
  await typeInto(page, '#recipe-name', name);
  await typeInto(page, '#recipe-yield-qty', yieldQty);
  await page.locator('#recipe-yield-unit').selectOption({ label: unitLabel });
  return id!;
}

test('type 叉燒, 凍檸茶, 斤 and full-width digits → sub-recipe 糖水 → costs match the CLI → impact → print', async ({
  page,
  baseURL,
}) => {
  const w = watch(page, baseURL!);
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => void (window as unknown as { printed: number }).printed++;
  });
  await open(page);
  await page.locator('#tab-data').click();
  await page.locator('#new-project').click();
  await typeInto(page, '#project-name', '測試茶餐廳');

  await page.locator('#tab-ingredients').click();
  const pork = await addIngredient(page, '梅頭肉', '１', 'catty (斤)', '６８', '90');
  await addIngredient(page, '砂糖', '1', 'kg', '12');
  await addIngredient(page, '水', '1', 'L', '0');
  await addIngredient(page, '檸檬', '1', 'piece', '4');
  await addIngredient(page, '紅茶葉', '1', 'lb', '80');
  await expect(page.locator('#ingredient-table tbody tr')).toHaveCount(5);
  await expect(page.locator(ing(pork, 'packQty'))).toHaveValue('1'); // full-width tidied
  await expect(page.locator('#problems')).toBeHidden();

  await page.locator('#tab-recipes').click();
  const syrup = await addRecipe(page, '糖水', '1', 'L');
  await addLine(page, syrup, '砂糖', '500', 'g');
  await addLine(page, syrup, '水', '700', 'ml');
  await expect(page.locator('#recipe-total')).toHaveText('6.00');
  const charsiu = await addRecipe(page, '叉燒', '10', 'portion');
  await addLine(page, charsiu, '梅頭肉', '2', 'catty (斤)');
  await addLine(page, charsiu, '糖水', '200', 'ml');
  await expect(page.locator('#recipe-per-unit')).toHaveText('15.23');
  const tea = await addRecipe(page, '凍檸茶', '1', 'portion');
  await addLine(page, tea, '紅茶葉', '2', 'tael (兩)', '5');
  await addLine(page, tea, '檸檬', '０.５', 'piece');
  await addLine(page, tea, '糖水', '30', 'ml');
  await page.locator('.sub-row summary').first().click();
  await expect(page.locator('.sub-card').first()).toContainText('砂糖');

  await page.locator('#tab-menu').click();
  await page.locator('#add-menu').click();
  const mid = await page.locator('#menu-table tbody tr').last().getAttribute('data-menu');
  await typeInto(page, `[data-key="menu:${mid}:price"]`, '22');
  await page.locator(`[data-key="menu:${mid}:service"]`).check();
  await typeInto(page, `[data-key="menu:${mid}:target"]`, '25');
  const row = page.locator(`tr[data-menu="${mid}"]`);
  await expect(row.locator('.m-food-cost')).toContainText('81.1% · high');
  await expect(row.locator('.m-suggested')).toHaveText('72.00');

  // Save the project and compare every number with the core and the CLI.
  await page.locator('#tab-data').click();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#save-json').click(),
  ]);
  const json = readFileSync((await dl.path())!, 'utf8');
  const r = readProjectJson(json);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const p = r.value.project;
  const v = verifiedProject(p);
  const dir = mkdtempSync(join(tmpdir(), 'saucepenny-e2e-'));
  const file = join(dir, 'project.json');
  writeFileSync(file, json);
  const cli = run(['cost', file]);
  expect(cli.code).toBe(0);
  await page.locator('#tab-recipes').click();
  for (const id of [syrup, charsiu, tea]) {
    await page.locator(`button[data-recipe="${id}"]`).click();
    const card = recipeCard(p, v, id, 'en');
    await expect(page.locator('#recipe-total')).toHaveText(card.total!);
    expect(cli.out).toContain(`total ${card.total} · per`);
  }
  await page.locator('#tab-menu').click();
  const mr = menuRows(p, v, 'en')[0]!;
  await expect(row.locator('.m-cost')).toHaveText(mr.portionCost!);
  expect(cli.out).toContain(`cost ${mr.portionCost}`);
  await page.locator('#tab-ingredients').click();
  const uc = verifiedIngredientCosts(p).get(pork)!;
  if (uc.status !== 'ok') throw new Error('unit cost');
  await expect(page.locator(`[data-out="unit-cost:${pork}"]`)).toHaveText(
    `${formatUnitMoney(uc.cost)} / kg`,
  );

  // Price change: sugar 12 → 15 reaches every recipe and the dish through 糖水.
  await page.locator('#tab-impact').click();
  await page.locator('#impact-ingredient').selectOption({ label: '砂糖 (12 / 1 kg)' });
  await typeInto(page, '#impact-price', '15');
  await expect(page.locator('#impact-table tbody tr')).toHaveCount(4);
  await expect(page.locator(`tr[data-impact="recipe:${charsiu}"]`)).toContainText('+0.30');
  expect(run(['impact', file, '砂糖', '15']).out).toContain('叉燒: 152.31 → 152.61 (+0.30)');

  // Print preview.
  await page.locator('#tab-data').click();
  await page.locator('#print').click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#print-area')).toBeVisible();
  await expect(page.locator('#print-area')).toContainText('叉燒');
  await expect(page.locator('#app')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

  expect(w.external).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('a bad number withholds costs and points at the field', async ({ page, baseURL }) => {
  const w = watch(page, baseURL!);
  await open(page);
  await page.locator('#tab-ingredients').click();
  await typeInto(page, ing('sugar', 'price'), '1e5');
  await expect(page.locator('#problems')).toBeVisible();
  await expect(page.locator('#problems')).toContainText('砂糖 Sugar');
  await expect(page.locator(ing('sugar', 'price'))).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('[data-out="unit-cost:rice"]')).toHaveText('—');
  await typeInto(page, ing('sugar', 'price'), '13');
  await expect(page.locator('#problems')).toBeHidden();
  expect(w.errors).toEqual([]);
});

test('recipes that use each other in a circle are explained, never priced', async ({ page }) => {
  await open(page);
  await page.locator('#tab-recipes').click();
  await page.locator('button[data-recipe="syrup"]').click();
  await page.locator('#add-line').click();
  await page
    .locator('[data-key="rec:syrup:line:2:item"]')
    .selectOption({ label: '叉燒醬 Char siu glaze' });
  await page.locator('[data-key="rec:syrup:line:2:unit"]').selectOption({ label: 'ml' });
  await expect(page.locator('#recipe-problem')).toContainText('circle');
  await expect(page.locator('#recipe-total')).toHaveText('—');
});

test('data survives a reload and the app works offline', async ({ page, context, baseURL }) => {
  const w = watch(page, baseURL!);
  await open(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.locator('#tab-ingredients').click();
  await typeInto(page, ing('sugar', 'price'), '14');
  await page.waitForTimeout(600); // the save is debounced
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator(ing('sugar', 'price'))).toHaveValue('14');
  await page.locator('#tab-recipes').click();
  await page.locator('button[data-recipe="syrup"]').click();
  await expect(page.locator('#recipe-total')).toHaveText('8.40');
  await context.setOffline(false);
  expect(w.external).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('delete all data removes the browser database', async ({ page }) => {
  await open(page);
  await page.locator('#tab-ingredients').click();
  await typeInto(page, ing('sugar', 'price'), '14');
  await page.waitForTimeout(600);
  await page.locator('#tab-data').click();
  await page.locator('#delete-all').click();
  await expect(page.locator('#status')).toContainText('deleted');
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(dbs).not.toContain('saucepenny');
});

test('ingredient CSV import (BOM, 斤, full-width) and neutralised menu CSV export', async ({
  page,
}) => {
  await open(page);
  await page.locator('#tab-ingredients').click();
  await page.locator('#import-ingredients').setInputFiles({
    name: 'ingredients.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      '\uFEFF名稱,包裝數量,單位,價錢\r\n豬扒,１,斤,"1,050"\r\n=evil(),1,kg,1\r\n',
      'utf8',
    ),
  });
  await expect(page.locator('#status')).toContainText('Imported 2 ingredients');
  await expect(page.locator('#ingredient-table tbody tr')).toHaveCount(14);
  await page.locator('#tab-menu').click();
  await typeInto(page, '[data-key="menu:m-milk-tea:name"]', '=HYPERLINK("x")');
  await page.locator('#tab-data').click();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-menu').click(),
  ]);
  const csv = readFileSync((await dl.path())!, 'utf8');
  expect(csv).toContain(`\r\n"'=HYPERLINK(""x"")",`);
});

test('names from a file are shown as text, never as markup', async ({ page }) => {
  await open(page);
  const s = readProjectJson(readFileSync('examples/cha-chaan-teng.json', 'utf8'));
  if (!s.ok) throw new Error();
  const stored = s.value.stored;
  stored.recipes[0]!.name = '<img src=x onerror="window.pwned=1">';
  await page.locator('#tab-data').click();
  await page.locator('#open-file').setInputFiles({
    name: 'x.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(stored)),
  });
  await page.locator('#tab-recipes').click();
  await expect(page.locator('#recipe-list button').first()).toHaveText(
    '<img src=x onerror="window.pwned=1">',
  );
  expect(
    await page.evaluate(() => (window as unknown as { pwned?: number }).pwned),
  ).toBeUndefined();
});

test('Traditional Chinese interface', async ({ page }) => {
  await open(page);
  await page.locator('#lang').selectOption('zh-HK');
  await expect(page.locator('#tab-recipes')).toHaveText('食譜');
  await expect(page.locator('footer')).toContainText('只供估算，並非會計或稅務意見。');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant-HK');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`no serious accessibility problems (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    for (const t of ['ingredients', 'recipes', 'menu', 'impact', 'data']) {
      await page.locator(`#tab-${t}`).click();
      if (t === 'impact') await typeInto(page, '#impact-price', '20');
      const r = await new AxeBuilder({ page }).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(
        bad.map((v) => `${t} ${v.id}: ${v.nodes.length} × ${v.nodes[0]?.target.join(' ')}`),
      ).toEqual([]);
    }
  });
}

test('benchmark: 1,000 ingredients × 500 recipes, editing one line updates in < 200 ms', async ({
  page,
}) => {
  await open(page);
  await page.locator('#tab-data').click();
  await page.locator('#open-file').setInputFiles({
    name: 'big.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bigProject())),
  });
  await expect(page.locator('#status')).toContainText('Project opened');
  await page.locator('#tab-recipes').click();
  await page.locator('button[data-recipe="r499"]').click();
  await expect(page.locator('#recipe-total')).not.toHaveText('—');
  const times: number[] = [];
  for (let i = 0; i < 7; i++) {
    const before = await page.locator('#recipe-total').textContent();
    const ms = await page.evaluate((n) => {
      const el = document.querySelector<HTMLInputElement>('[data-key="rec:r499:line:0:qty"]')!;
      el.value = String(10 + n);
      const t0 = performance.now();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return performance.now() - t0;
    }, i);
    times.push(ms);
    await expect(page.locator('#recipe-total')).not.toHaveText(before!);
  }
  times.sort((a, b) => a - b);
  const median = times[3]!;
  test.info().annotations.push({
    type: 'benchmark',
    description: `edit one line: median ${median.toFixed(1)} ms, max ${times[6]!.toFixed(1)} ms`,
  });
  console.info(
    `[benchmark] 1000 ingredients × 500 recipes: edit one line median ${median.toFixed(1)} ms (max ${times[6]!.toFixed(1)} ms)`,
  );
  expect(median).toBeLessThan(200);
});
