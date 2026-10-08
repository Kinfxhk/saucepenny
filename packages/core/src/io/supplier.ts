// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Supplier price lists: a CSV with the same columns as the ingredient list (name, pack qty,
// unit, price, optional price date; extra columns such as a supplier code are ignored). Each
// row is matched to one of the user's existing ingredients — by a match remembered from an
// earlier import, else by identical name — and the user confirms before anything changes.
// Applying goes through recordPriceChange, so old prices land in the price history.

import type { Ingredient, Measure, StoredIngredient, StoredProject } from '../model/index';
import { recordPriceChange } from '../model/edit';
import {
  cmp,
  div,
  eq,
  mul,
  parseDecimal,
  parseQuantity,
  sub,
  rat,
  type Rational,
} from '../num/index';
import { resolveUnit } from '../cost/units';
import { importIngredientsCsv, type ImportProblem } from './ingredients';
import { nameKey } from './sales';

export interface SupplierRow {
  line: number;
  name: string;
  price: string;
  packQty: string;
  packUnit: StoredIngredient['packUnit'];
  priceDate?: string | undefined;
  /** matched ingredient id, or null when the user must choose */
  match: string | null;
  matchedBy: 'saved' | 'name' | null;
}

export interface SupplierImport {
  rows: SupplierRow[];
  problems: ImportProblem[];
}

/**
 * Read a supplier CSV. `saved` maps nameKey(supplier name) → ingredient id from earlier
 * imports; a saved match wins over a name match, and is ignored if that ingredient is gone.
 */
export function readSupplierCsv(
  text: string,
  ingredients: readonly StoredIngredient[],
  saved: Readonly<Record<string, string>> = {},
): SupplierImport {
  const res = importIngredientsCsv(text);
  const ids = new Set(ingredients.map((i) => i.id));
  const byName = new Map<string, string | null>();
  for (const i of ingredients) {
    const k = nameKey(i.name);
    byName.set(k, byName.has(k) ? null : i.id);
  }
  const rows = res.ingredients.map((g, k): SupplierRow => {
    const key = nameKey(g.name);
    const remembered = Object.prototype.hasOwnProperty.call(saved, key) ? saved[key] : undefined;
    const byN = byName.get(key) ?? null;
    const match = remembered && ids.has(remembered) ? remembered : byN;
    return {
      line: res.lines?.[k] ?? 0,
      name: g.name,
      price: g.price,
      packQty: g.packQty,
      packUnit: g.packUnit,
      priceDate: g.priceDate,
      match,
      matchedBy: match === null ? null : match === remembered ? 'saved' : 'name',
    };
  });
  return { rows, problems: res.problems };
}

export type UnitPriceChange =
  | {
      status: 'ok';
      /** price per base unit (g, ml or piece) before and after */
      before: Rational;
      after: Rational;
      /** relative change, e.g. 1/10 for +10%; null when the old price was 0 */
      change: Rational | null;
    }
  /** different kinds of unit (e.g. kg before, pieces now), or a price that does not parse */
  | { status: 'not-comparable' }
  | { status: 'mismatch' };

/**
 * Compare the cost per base unit of an ingredient with a supplier row: price ÷ (pack qty ×
 * unit size). Cross-checked by computing the ratio in one step.
 */
export function unitPriceChange(
  ing: Pick<Ingredient, 'price' | 'packQty' | 'packUnit'>,
  row: Pick<SupplierRow, 'price' | 'packQty' | 'packUnit'>,
  measures: ReadonlyMap<string, Measure>,
): UnitPriceChange {
  const p = parseDecimal(row.price);
  const q = parseQuantity(row.packQty);
  if (!p.ok || !q.ok || q.value.n === 0n) return { status: 'not-comparable' };
  let a, b;
  try {
    a = resolveUnit(ing.packUnit, measures);
    b = resolveUnit(row.packUnit, measures);
  } catch {
    return { status: 'not-comparable' };
  }
  if (a.dim !== b.dim || ing.packQty.n === 0n) return { status: 'not-comparable' };
  const before = div(ing.price, mul(ing.packQty, a.factor));
  const after = div(p.value, mul(q.value, b.factor));
  if (ing.price.n === 0n) return { status: 'ok', before, after, change: null };
  const change = div(sub(after, before), before);
  // one-step ratio: new price × old pack ÷ (old price × new pack) − 1
  const check = sub(
    div(mul(p.value, mul(ing.packQty, a.factor)), mul(ing.price, mul(q.value, b.factor))),
    rat(1n),
  );
  if (!eq(change, check)) return { status: 'mismatch' };
  return { status: 'ok', before, after, change };
}

export interface SupplierPick {
  ingredientId: string;
  row: Pick<SupplierRow, 'price' | 'packQty' | 'packUnit' | 'priceDate'>;
}

export type ApplySupplier =
  | { ok: true; project: StoredProject; changed: string[]; unchanged: string[] }
  | { ok: false; code: 'unknown-ingredient' | 'duplicate-target'; ingredientId: string };

/**
 * Apply the chosen rows to a copy of the project. The previous price of each changed
 * ingredient goes into its history; the new price is dated with the row's date or `today`.
 * Validate the returned project before using it.
 */
export function applySupplierPrices(
  project: StoredProject,
  picks: readonly SupplierPick[],
  today: string,
): ApplySupplier {
  const seen = new Set<string>();
  const index = new Map(project.ingredients.map((g, i) => [g.id, i]));
  for (const pick of picks) {
    if (!index.has(pick.ingredientId))
      return { ok: false, code: 'unknown-ingredient', ingredientId: pick.ingredientId };
    if (seen.has(pick.ingredientId))
      return { ok: false, code: 'duplicate-target', ingredientId: pick.ingredientId };
    seen.add(pick.ingredientId);
  }
  const ingredients = project.ingredients.map((g) => ({ ...g }));
  const changed: string[] = [];
  const unchanged: string[] = [];
  for (const pick of picks) {
    const i = index.get(pick.ingredientId)!;
    const old = ingredients[i]!;
    const updated: StoredIngredient = {
      ...old,
      price: pick.row.price,
      packQty: pick.row.packQty,
      packUnit: pick.row.packUnit,
    };
    if (samePrice(old, updated)) {
      unchanged.push(old.id);
      continue;
    }
    const oldPrice = parseDecimal(old.price);
    // an empty or 0 price is a placeholder, not a price worth keeping in the history
    const next =
      !oldPrice.ok || oldPrice.value.n === 0n
        ? updated
        : recordPriceChange(
            updated,
            {
              price: old.price,
              packQty: old.packQty,
              packUnit: old.packUnit,
              priceDate: old.priceDate,
            },
            today,
            sameNumber,
          );
    ingredients[i] = { ...next, priceDate: pick.row.priceDate || today };
    changed.push(old.id);
  }
  return { ok: true, project: { ...project, ingredients }, changed, unchanged };
}

function sameNumber(a: string, b: string): boolean {
  const x = parseQuantity(a);
  const y = parseQuantity(b);
  return x.ok && y.ok ? cmp(x.value, y.value) === 0 : a === b;
}

const samePrice = (a: StoredIngredient, b: StoredIngredient) =>
  sameNumber(a.price, b.price) && sameNumber(a.packQty, b.packQty) && a.packUnit === b.packUnit;
