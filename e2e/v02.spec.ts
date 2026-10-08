// SPDX-License-Identifier: AGPL-3.0-or-later
// v0.2 in a real browser: fractions, duplicate recipe, labour/overhead, custom measures,
// price history, ingredient weight, persistent storage status and the backup reminder.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  readProjectJson,
  recipeCard,
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
function card(p: StoredProject, id: string) {
  const r = readProjectJson(JSON.stringify(p));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return recipeCard(r.value.project, verifiedProject(r.value.project), id, 'en');
}

async function openRecipe(page: Page, id: string): Promise<void> {
  await page.locator('#tab-recipes').click();
  await page.locator(`[data-recipe="${id}"]`).click();
  await expect(page.locator('#recipe-name')).toBeVisible();
}

test('fractions: 1 1/2 and full-width １／２ cost exactly like 1.5 and 0.5', async ({
  page,
  baseURL,
}) => {
  const w = watch(page, baseURL!);
  await open(page);
  await openRecipe(page, 'char-siu');
  await typeInto(page, '[data-key="rec:char-siu:line:0:qty"]', '1 1/2');
  await typeInto(page, '[data-key="rec:char-siu:line:1:qty"]', '２５０');
  await expect(page.locator('#problems')).toBeHidden();
  const p = example();
  p.recipes.find((r) => r.id === 'char-siu')!.lines[0]!.qty = '1.5';
  await expect(page.locator('#recipe-total')).toHaveText(card(p, 'char-siu').total!);
  await typeInto(page, '[data-key="rec:char-siu:line:0:qty"]', '１／２');
  await expect(page.locator('[data-key="rec:char-siu:line:0:qty"]')).toHaveValue('1/2');
  p.recipes.find((r) => r.id === 'char-siu')!.lines[0]!.qty = '0.5';
  await expect(page.locator('#recipe-total')).toHaveText(card(p, 'char-siu').total!);
  await typeInto(page, '[data-key="rec:char-siu:line:0:qty"]', '1 3/2');
  await expect(page.locator('#problems')).toContainText('1 1/2');
  expect(w.external).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('duplicate recipe makes an independent copy', async ({ page }) => {
  await open(page);
  await openRecipe(page, 'char-siu');
  const total = await page.locator('#recipe-total').textContent();
  const before = await page.locator('#recipe-list li').count();
  await page.locator('#duplicate-recipe').click();
  await expect(page.locator('#recipe-list li')).toHaveCount(before + 1);
  await expect(page.locator('#recipe-name')).toHaveValue('叉燒 Char siu (copy)');
  await expect(page.locator('#recipe-total')).toHaveText(total!);
  const copyId = await page
    .locator('[aria-current="true"][data-recipe]')
    .getAttribute('data-recipe');
  await typeInto(page, `[data-key="rec:${copyId}:line:0:qty"]`, '6');
  await page.locator('[data-recipe="char-siu"]').click();
  await expect(page.locator('#recipe-total')).toHaveText(total!);
});

test('labour and overhead give a full cost; food cost is unchanged', async ({ page }) => {
  await open(page);
  await openRecipe(page, 'char-siu');
  const food = await page.locator('#recipe-total').textContent();
  await page.locator('#extras summary').click();
  await typeInto(page, '#recipe-labourMinutes', '90');
  await typeInto(page, '#recipe-labourRate', '64');
  await typeInto(page, '#recipe-overheadFixed', '12');
  await typeInto(page, '#recipe-overheadPercent', '10');
  const p = example();
  Object.assign(
    p.recipes.find((r) => r.id === 'char-siu')!,
    {
      labourMinutes: '90',
      labourRate: '64',
      overheadFixed: '12',
      overheadPercent: '10',
    },
  );
  const c = card(p, 'char-siu');
  await expect(page.locator('#recipe-labour')).toHaveText('96.00');
  await expect(page.locator('#recipe-overhead')).toHaveText(c.extras!.overhead);
  await expect(page.locator('#recipe-full')).toHaveText(c.extras!.full);
  await expect(page.locator('#recipe-full-per-unit')).toHaveText(c.extras!.fullPerUnit);
  await expect(page.locator('#recipe-total')).toHaveText(food!);
  // kept after a reload
  // (saved within a second while typing, 250 ms after it stops)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string>((res) => {
            const r = indexedDB.open('saucepenny');
            r.onsuccess = () => {
              const g = r.result.transaction('kv').objectStore('kv').get('current');
              g.onsuccess = () =>
                res(
                  String(
                    (g.result as StoredProject | undefined)?.recipes.find(
                      (x) => x.id === 'char-siu',
                    )?.overheadPercent,
                  ),
                );
            };
          }),
      ),
    )
    .toBe('10');
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await openRecipe(page, 'char-siu');
  await expect(page.locator('#recipe-labourMinutes')).toHaveValue('90');
  await expect(page.locator('#recipe-full')).toHaveText(c.extras!.full);
});

test('ingredient weight is shown, or what is missing for it', async ({ page }) => {
  await open(page);
  await openRecipe(page, 'char-siu');
  const c = card(example(), 'char-siu');
  const want =
    c.weight?.status === 'ok'
      ? c.weight.perPortion
        ? `${c.weight.total} · ${c.weight.perPortion} per portion`
        : c.weight.total
      : `needs a weight for: ${c.weight?.lines.join('、')}`;
  await expect(page.locator('#recipe-weight')).toHaveText(want);
});

test('custom measures can be added, used, and are protected while in use', async ({ page }) => {
  await open(page);
  await page.locator('#tab-data').click();
  await page.locator('#add-measure').click();
  const row = page.locator('#measure-table tbody tr').last();
  const id = await row.getAttribute('data-measure');
  await typeInto(page, `[data-key="measure:${id}:name"]`, 'bowl');
  await typeInto(page, `[data-key="measure:${id}:amount"]`, '1/3');
  await page.locator(`[data-key="measure:${id}:unit"]`).selectOption('l');
  await expect(page.locator('#problems')).toBeHidden();
  await openRecipe(page, 'char-siu');
  await page.locator('[data-key="rec:char-siu:line:1:unit"]').selectOption({ label: 'bowl' });
  await typeInto(page, '[data-key="rec:char-siu:line:1:qty"]', '3/4');
  const p = example();
  p.measures.push({ id: id!, name: 'bowl', amount: '1/3', unit: 'l' });
  Object.assign(p.recipes.find((r) => r.id === 'char-siu')!.lines[1]!, {
    unit: `measure:${id}`,
    qty: '3/4',
  });
  await expect(page.locator('#recipe-total')).toHaveText(card(p, 'char-siu').total!);
  await page.locator('#tab-data').click();
  await page.locator(`[data-remove-measure="${id}"]`).click();
  await expect(page.locator('#status')).toContainText('叉燒 Char siu');
  await expect(page.locator(`tr[data-measure="${id}"]`)).toHaveCount(1);
});

test('price history: old price kept, change shown, usable in "what if"', async ({ page }) => {
  await open(page);
  await page.locator('#tab-ingredients').click();
  await typeInto(page, '[data-key="ing:sugar:price"]', '15.6');
  await expect(page.locator('[data-out="price-trend:sugar"]')).toHaveText(
    /↑ 20\.0% since \d{4}-\d{2}-\d{2}/,
  );
  await page.locator('#tab-impact').click();
  await page.locator('#impact-ingredient').selectOption('sugar');
  const rows = page.locator('#history-table tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('13');
  await rows.first().locator('[data-use-price]').click();
  await expect(page.locator('#impact-price')).toHaveValue('13');
  await expect(page.locator('#impact-table tbody tr').first()).toBeVisible();
  // kept in the saved project file
  await page.locator('#tab-data').click();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#save-json').click(),
  ]);
  const saved = JSON.parse(readFileSync((await dl.path())!, 'utf8')) as StoredProject;
  expect(saved.version).toBe(2);
  expect(saved.ingredients.find((i) => i.id === 'sugar')!.priceHistory).toEqual([
    expect.objectContaining({ price: '13', packQty: '1', packUnit: 'kg' }),
  ]);
  // and it can be removed
  await page.locator('#tab-impact').click();
  await page.locator('[data-remove-history="0"]').click();
  await expect(page.locator('#history-table')).toHaveCount(0);
});

test('persistent storage: granted', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', {
      value: { persisted: async () => false, persist: async () => true },
    });
  });
  await open(page);
  await page.locator('#tab-data').click();
  await typeInto(page, '#project-name', 'My shop');
  await expect(page.locator('#persist-status')).toHaveAttribute('data-status', 'persisted');
  await expect(page.locator('#persist-again')).toBeHidden();
});

test('persistent storage: refused, then asked again', async ({ page }) => {
  await page.addInitScript(() => {
    let n = 0;
    Object.defineProperty(navigator, 'storage', {
      value: { persisted: async () => false, persist: async () => ++n > 1 },
    });
  });
  await open(page);
  await page.locator('#tab-data').click();
  await typeInto(page, '#project-name', 'My shop');
  await expect(page.locator('#persist-status')).toHaveAttribute('data-status', 'not-persisted');
  await expect(page.locator('#persist-status')).toContainText('.json');
  await page.locator('#persist-again').click();
  await expect(page.locator('#persist-status')).toHaveAttribute('data-status', 'persisted');
});

test('persistent storage: unsupported browser still works', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', { value: undefined });
  });
  await open(page);
  await page.locator('#tab-data').click();
  await typeInto(page, '#project-name', 'My shop');
  await expect(page.locator('#persist-status')).toHaveAttribute('data-status', 'unsupported');
});

test('backup reminder: shows after many changes, "Not now" hides it, a backup clears it', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-backup')) {
      sessionStorage.setItem('e2e-backup', '1');
      localStorage.setItem(
        'saucepenny-backup',
        JSON.stringify({
          lastAt: '',
          changes: 25,
          firstChangeAt: new Date().toISOString(),
          snoozedAt: '',
          snoozedChanges: 0,
        }),
      );
    }
  });
  await open(page);
  await expect(page.locator('#reminder')).toBeVisible();
  await expect(page.locator('#reminder')).toContainText('25');
  await page.locator('#reminder-later').click();
  await expect(page.locator('#reminder')).toBeHidden();
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator('#reminder')).toBeHidden();
  // many more changes bring it back; saving a backup clears it for good
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('saucepenny-backup')!);
    s.changes += 30;
    localStorage.setItem('saucepenny-backup', JSON.stringify(s));
  });
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator('#reminder')).toBeVisible();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#reminder-backup').click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/\.json$/);
  await expect(page.locator('#reminder')).toBeHidden();
  await page.locator('#tab-data').click();
  await expect(page.locator('#last-backup')).toContainText(/\d{4}-\d{2}-\d{2}/);
});

test('a line counted at 0% is a pinch: no cost, marked in the share column', async ({ page }) => {
  await open(page);
  await openRecipe(page, 'char-siu-glaze');
  await typeInto(page, '[data-key="rec:char-siu-glaze:line:2:counted"]', '0');
  await page.locator('[data-key="rec:char-siu-glaze:line:2:unit"]').selectOption('piece');
  await expect(page.locator('#problems')).toBeHidden();
  const p = example();
  Object.assign(p.recipes.find((r) => r.id === 'char-siu-glaze')!.lines[2]!, {
    costPercent: '0',
    unit: 'piece',
  });
  const c = card(p, 'char-siu-glaze');
  await expect(page.locator('#recipe-total')).toHaveText(c.total!);
  await expect(page.locator('#line-table tbody tr[data-line="2"] .line-cost')).toHaveText('0.00');
  await expect(page.locator('#line-table tbody tr[data-line="2"] .line-share')).toContainText(
    'pinch, not costed',
  );
});
