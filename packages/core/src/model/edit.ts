// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pure editing helpers for the stored form (v0.2), used by the web UI and tested here:
// recording an ingredient's previous price, duplicating a recipe, and checking whether a
// custom measure is still in use.

import { LIMITS } from './limits';
import type { StoredIngredient, StoredProject, StoredRecipe, UnitRef } from './types';

export interface PriceSnapshot {
  price: string;
  packQty: string;
  packUnit: UnitRef;
  priceDate?: string | undefined;
}

/**
 * After the user changed the price or pack of an ingredient: if the previous values differ
 * from the current ones, add them to the history (dated with the old price date, or `today`
 * if there was none), date the new price `today`, and keep at most LIMITS.priceHistory
 * entries (oldest dropped). Returns a new object; the input is not changed.
 */
export function recordPriceChange(
  ing: StoredIngredient,
  before: PriceSnapshot,
  today: string,
  same: (a: string, b: string) => boolean = (a, b) => a === b,
): StoredIngredient {
  const changed =
    !same(before.price, ing.price) ||
    !same(before.packQty, ing.packQty) ||
    before.packUnit !== ing.packUnit;
  if (!changed || before.price.trim() === '') return ing;
  const history = [...(ing.priceHistory ?? [])];
  history.push({
    date: before.priceDate || today,
    price: before.price,
    packQty: before.packQty,
    packUnit: before.packUnit,
  });
  while (history.length > LIMITS.priceHistory) history.shift();
  return { ...ing, priceDate: today, priceHistory: history };
}

const COPY_SUFFIX = { en: ' (copy)', 'zh-HK': '（副本）' } as const;

/** A copy of a recipe with a new id and "(copy)" added to the name (lines are copied). */
export function duplicateRecipe(
  r: StoredRecipe,
  newId: string,
  lang: keyof typeof COPY_SUFFIX = 'en',
): StoredRecipe {
  const suffix = COPY_SUFFIX[lang];
  const room = LIMITS.nameLength - [...suffix].length;
  const base = [...r.name].slice(0, room).join('');
  const copy: StoredRecipe = JSON.parse(JSON.stringify(r)) as StoredRecipe;
  return { ...copy, id: newId, name: base + suffix };
}

/** Where a custom measure is used (empty when it can be removed safely). */
export function measureUses(p: StoredProject, measureId: string): string[] {
  const ref = `measure:${measureId}`;
  const out: string[] = [];
  for (const g of p.ingredients) {
    if (g.packUnit === ref || g.priceHistory?.some((h) => h.packUnit === ref)) out.push(g.name);
  }
  for (const r of p.recipes)
    if (r.yieldUnit === ref || r.lines.some((l) => l.unit === ref)) out.push(r.name);
  for (const m of p.menu) if (m.portionUnit === ref) out.push(m.name);
  return out;
}
