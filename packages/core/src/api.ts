// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The only entry point the UI and CLI use for numbers. Every engine result is recomputed
// by the independent checker; a number is marked verified only when both agree *exactly*.
// If they ever disagree, the number is withheld and an internal error is shown instead.

import {
  Checker,
  isValidSuggestion,
  netPriceOf,
  recomputeExtras,
  recomputeMenu,
  recomputeMenuEngineering,
  recomputeWeight,
} from './check/index';
import {
  costRecipes,
  hasExtras,
  ingredientCost,
  maxYield,
  menuEngineering,
  priceImpact,
  priceItem,
  recipeExtras,
  recipeWeight,
  withPrice,
  type MenuEngInput,
  type MenuEngResult,
  type ImpactRow,
  type MenuCost,
  type RecipeCost,
} from './cost/index';
import { resolveUnit, toBaseOf } from './cost/units';
import type { Ingredient, PricePoint, Project, ProjectError, UnitRef } from './model/index';
import { add, cmp, div, eq, mul, rat, sub, type Rational } from './num/index';
import { UNITS, type UnitId } from './units/index';

export type VerifiedRecipe =
  | {
      status: 'ok';
      total: Rational;
      /** money per one yield unit as entered (per portion, per kg, …) */
      perYieldUnit: Rational;
      lines: Rational[];
      depth: number;
      /** labour and overhead (v0.2); null when the recipe has none entered */
      extras: {
        labour: Rational;
        overhead: Rational;
        /** food + labour + overhead per batch */
        full: Rational;
        fullPerYieldUnit: Rational;
      } | null;
    }
  | { status: 'error'; error: ProjectError }
  | { status: 'mismatch'; detail: string };

export function verifyRecipe(
  project: Project,
  id: string,
  engine: RecipeCost,
  checker: Checker,
): VerifiedRecipe {
  if (!engine.ok) return { status: 'error', error: engine.error };
  const recipe = project.recipes.get(id)!;
  const perYieldUnit = mul(
    engine.perYieldBase,
    resolveUnit(recipe.yieldUnit, project.measures).factor,
  );
  const chk = checker.recipe(id);
  if (typeof chk === 'string') return { status: 'mismatch', detail: `checker: ${chk}` };
  if (!eq(chk.total, engine.total)) return { status: 'mismatch', detail: 'total' };
  if (!eq(chk.perYieldUnit, perYieldUnit)) return { status: 'mismatch', detail: 'per yield unit' };
  if (chk.lineCosts.length !== engine.lines.length) return { status: 'mismatch', detail: 'lines' };
  for (let j = 0; j < engine.lines.length; j++)
    if (!eq(chk.lineCosts[j]!, engine.lines[j]!))
      return { status: 'mismatch', detail: `line ${j + 1}` };
  let extras: Extract<VerifiedRecipe, { status: 'ok' }>['extras'] = null;
  if (hasExtras(recipe)) {
    const e = recipeExtras(recipe, engine.total);
    const c = recomputeExtras(recipe, chk.total);
    if (!eq(e.labour, c.labour)) return { status: 'mismatch', detail: 'labour' };
    if (!eq(e.overhead, c.overhead)) return { status: 'mismatch', detail: 'overhead' };
    if (!eq(e.full, c.full)) return { status: 'mismatch', detail: 'full cost' };
    const fullPerYieldUnit = div(e.full, recipe.yieldQty);
    const checkPer = add(chk.perYieldUnit, div(add(c.labour, c.overhead), recipe.yieldQty));
    if (!eq(fullPerYieldUnit, checkPer))
      return { status: 'mismatch', detail: 'full cost per yield unit' };
    extras = { ...e, fullPerYieldUnit };
  }
  return {
    status: 'ok',
    total: engine.total,
    perYieldUnit,
    lines: engine.lines,
    depth: engine.depth,
    extras,
  };
}

export type VerifiedWeight =
  | {
      status: 'ok';
      grams: Rational;
      /** grams per portion when the recipe yields portions */ perPortion: Rational | null;
    }
  | { status: 'missing'; lines: number[] }
  | { status: 'mismatch'; detail: string };

/** Ingredient weight of one batch, engine and checker agreeing exactly. */
export function verifiedWeight(project: Project, id: string): VerifiedWeight {
  const recipe = project.recipes.get(id)!;
  const e = recipeWeight(project, recipe);
  const c = recomputeWeight(project, recipe);
  if (!e.ok) {
    if ('grams' in c || c.missing.join() !== e.missing.join())
      return { status: 'mismatch', detail: 'weight lines' };
    return { status: 'missing', lines: e.missing };
  }
  if (!('grams' in c) || !eq(c.grams, e.grams)) return { status: 'mismatch', detail: 'weight' };
  return {
    status: 'ok',
    grams: e.grams,
    perPortion: recipe.yieldUnit === 'portion' ? div(e.grams, recipe.yieldQty) : null,
  };
}

export function verifiedRecipes(project: Project): Map<string, VerifiedRecipe> {
  const engine = costRecipes(project);
  const checker = new Checker(project);
  const out = new Map<string, VerifiedRecipe>();
  for (const id of project.recipes.keys())
    out.set(id, verifyRecipe(project, id, engine.get(id)!, checker));
  return out;
}

// ---- Ingredient unit cost ------------------------------------------------------------

export type VerifiedUnitCost =
  { status: 'ok'; unit: UnitId; cost: Rational } | { status: 'mismatch'; detail: string };

const DISPLAY_UNIT = { mass: 'kg', volume: 'l', count: 'piece' } as const;

/** Usable cost per kg, per litre or per piece of each ingredient (yield % included). */
export function verifiedIngredientCosts(
  project: Project,
  only?: Iterable<string>,
): Map<string, VerifiedUnitCost> {
  const checker = new Checker(project);
  const out = new Map<string, VerifiedUnitCost>();
  for (const id of only ?? project.ingredients.keys()) {
    const ing = project.ingredients.get(id)!;
    const e = ingredientCost(ing, project);
    if (e.dim === 'portion') {
      out.set(id, { status: 'mismatch', detail: 'portion' });
      continue;
    }
    const unit: UnitId = DISPLAY_UNIT[e.dim];
    const cost = mul(e.perBase, UNITS[unit].factor);
    const chk = checker.ingredientUnitCost(id, unit);
    out.set(
      id,
      typeof chk !== 'string' && eq(chk, cost)
        ? { status: 'ok', unit, cost }
        : { status: 'mismatch', detail: 'unit cost' },
    );
  }
  return out;
}

// ---- Menu -----------------------------------------------------------------------------

export type VerifiedMenu =
  | ({ status: 'ok' } & Omit<Extract<MenuCost, { ok: true }>, 'ok'>)
  | { status: 'error'; error: ProjectError }
  | { status: 'mismatch'; detail: string };

export interface CheckerMenuDeps {
  recomputeMenu: typeof recomputeMenu;
  isValidSuggestion: typeof isValidSuggestion;
  netPriceOf: typeof netPriceOf;
}

const eqOrNull = (a: Rational | null, b: Rational | null) =>
  a === null || b === null ? a === b : eq(a, b);

export function verifyMenuItem(
  project: Project,
  id: string,
  engine: MenuCost,
  checker: Checker,
  /** injectable for mutation tests of the checker */
  deps: CheckerMenuDeps = { recomputeMenu, isValidSuggestion, netPriceOf },
): VerifiedMenu {
  const { recomputeMenu, isValidSuggestion, netPriceOf } = deps;
  if (!engine.ok) return { status: 'error', error: engine.error };
  const chk = recomputeMenu(checker, project, id);
  if (typeof chk === 'string') return { status: 'mismatch', detail: `checker: ${chk}` };
  if (!eq(chk.portionCost, engine.portionCost))
    return { status: 'mismatch', detail: 'portion cost' };
  if (!eq(chk.netPrice, engine.netPrice)) return { status: 'mismatch', detail: 'net price' };
  if (!eqOrNull(chk.foodCost, engine.foodCost)) return { status: 'mismatch', detail: 'food cost' };
  if (!eqOrNull(chk.grossProfit, engine.grossProfit))
    return { status: 'mismatch', detail: 'gross profit' };
  if (chk.band !== engine.band) return { status: 'mismatch', detail: 'band' };
  const item = project.menu.get(id)!;
  if (!isValidSuggestion(engine.suggestedPrice, chk.rawSuggested, item.rounding))
    return { status: 'mismatch', detail: 'suggested price' };
  const net = netPriceOf(
    engine.suggestedPrice,
    item.priceIncludesService,
    project.settings.serviceCharge,
  );
  const actual = net.n === 0n ? rat(0n) : div(chk.portionCost, net);
  if (!eq(actual, engine.suggestedFoodCost))
    return { status: 'mismatch', detail: 'suggested food cost' };
  if (cmp(actual, item.target) > 0) return { status: 'mismatch', detail: 'suggested above target' };
  const { ok: _ok, ...rest } = engine;
  void _ok;
  return { status: 'ok', ...rest };
}

export interface VerifiedProject {
  recipes: Map<string, VerifiedRecipe>;
  menu: Map<string, VerifiedMenu>;
}

export interface Subset {
  recipes?: Iterable<string>;
  menu?: Iterable<string>;
}

/**
 * Cost and price everything (or just a subset, for a fast UI update), verified. This is
 * what the UI and CLI display.
 */
export function verifiedProject(project: Project, only?: Subset): VerifiedProject {
  const recipeIds = only ? [...(only.recipes ?? [])] : [...project.recipes.keys()];
  const menuIds = only ? [...(only.menu ?? [])] : [...project.menu.keys()];
  const needed = new Set(recipeIds);
  for (const id of menuIds) needed.add(project.menu.get(id)!.recipeId);
  const engine = costRecipes(project, needed);
  const checker = new Checker(project);
  const recipes = new Map<string, VerifiedRecipe>();
  for (const id of recipeIds) recipes.set(id, verifyRecipe(project, id, engine.get(id)!, checker));
  const menu = new Map<string, VerifiedMenu>();
  for (const id of menuIds) {
    const item = project.menu.get(id)!;
    menu.set(id, verifyMenuItem(project, id, priceItem(item, project, engine), checker));
  }
  return { recipes, menu };
}

// ---- Price change impact -------------------------------------------------------------

export type VerifiedImpact =
  { status: 'ok'; rows: ImpactRow[] } | { status: 'mismatch'; detail: string };

/**
 * Engine impact list, checked against the checker: the list must contain exactly the
 * recipes and menu items whose checker-recomputed cost differs, with identical numbers.
 */
export function verifiedImpact(
  project: Project,
  ingredientId: string,
  newPrice: Rational,
): VerifiedImpact {
  const rows = priceImpact(project, ingredientId, newPrice);
  const after = withPrice(project, ingredientId, newPrice);
  const cb = new Checker(project);
  const ca = new Checker(after);
  const expected = new Map<string, [Rational, Rational]>();
  for (const id of project.recipes.keys()) {
    const b = cb.recipe(id);
    const a = ca.recipe(id);
    if (typeof a !== 'string' && typeof b !== 'string' && !eq(a.total, b.total))
      expected.set(`recipe:${id}`, [b.total, a.total]);
  }
  for (const id of project.menu.keys()) {
    const b = recomputeMenu(cb, project, id);
    const a = recomputeMenu(ca, after, id);
    if (typeof a !== 'string' && typeof b !== 'string' && !eq(a.portionCost, b.portionCost))
      expected.set(`menu:${id}`, [b.portionCost, a.portionCost]);
  }
  if (expected.size !== rows.length) return { status: 'mismatch', detail: 'rows' };
  for (const r of rows) {
    const e = expected.get(`${r.kind}:${r.id}`);
    if (!e || !eq(e[0], r.before) || !eq(e[1], r.after))
      return { status: 'mismatch', detail: r.id };
  }
  return { status: 'ok', rows };
}

// ---- Scaling: how much can I make with what I have? ------------------------------------

export type VerifiedMaxYield =
  | { status: 'ok'; yieldUnits: Rational | null }
  | { status: 'error'; error: ProjectError }
  | { status: 'mismatch'; detail: string };

export function verifiedMaxYield(
  project: Project,
  recipeId: string,
  ingredientId: string,
  qty: Rational,
  unit: UnitRef,
): VerifiedMaxYield {
  const res = maxYield(project, recipeId, ingredientId, qty, unit);
  if (!res.ok) return { status: 'error', error: res.error };
  const packs = new Checker(project).packsFor(recipeId, rat(1n), true);
  if (typeof packs === 'string') return { status: 'mismatch', detail: packs };
  const ing = project.ingredients.get(ingredientId)!;
  const packsPerUnit = packs.get(ingredientId) ?? rat(0n);
  if (packsPerUnit.n === 0n)
    return res.yieldUnits === null
      ? { status: 'ok', yieldUnits: null }
      : { status: 'mismatch', detail: 'unused' };
  // available amount in packs ÷ packs per yield unit
  const have = toBaseOf(
    qty,
    resolveUnit(unit, project.measures),
    resolveUnit(ing.packUnit, project.measures).dim,
    { densityGPerMl: ing.density, pieceWeightG: ing.pieceWeight },
    'available',
  );
  if (!have.ok) return { status: 'error', error: have.error };
  const packBase = mul(ing.packQty, resolveUnit(ing.packUnit, project.measures).factor);
  const expected = div(div(have.value, packBase), packsPerUnit);
  if (res.yieldUnits === null || !eq(res.yieldUnits, expected))
    return { status: 'mismatch', detail: 'max yield' };
  return { status: 'ok', yieldUnits: res.yieldUnits };
}

// ---- Price history (v0.2) ------------------------------------------------------------

export type VerifiedPriceChange =
  | {
      status: 'ok';
      from: PricePoint;
      /** relative change, e.g. 1/10 for +10%; null when the earlier price was 0 */
      change: Rational | null;
    }
  /** the pack size or unit changed, so prices are not compared */
  | { status: 'pack-changed'; from: PricePoint }
  | { status: 'mismatch'; detail: string };

/** Change from the most recent earlier price to the current one; null without history. */
export function verifiedPriceChange(ing: Ingredient): VerifiedPriceChange | null {
  const from = ing.priceHistory[ing.priceHistory.length - 1];
  if (!from) return null;
  if (from.packUnit !== ing.packUnit || !eq(from.packQty, ing.packQty))
    return { status: 'pack-changed', from };
  if (from.price.n === 0n) return { status: 'ok', from, change: null };
  const engine = div(sub(ing.price, from.price), from.price);
  const check = sub(div(ing.price, from.price), rat(1n));
  if (!eq(engine, check)) return { status: 'mismatch', detail: 'price change' };
  return { status: 'ok', from, change: engine };
}

// ---- Menu engineering (v0.3) -----------------------------------------------------------

export type MenuEngExcluded = { id: string; reason: 'no-price' | 'not-costed' };

export type VerifiedMenuEng =
  | (Extract<MenuEngResult, { ok: true }> & { status: 'ok'; excluded: MenuEngExcluded[] })
  | { status: 'empty'; reason: 'no-items' | 'no-sales'; excluded: MenuEngExcluded[] }
  | { status: 'mismatch'; detail: string };

/**
 * Menu engineering over the verified menu: items whose cost could not be verified, or with
 * no price, are left out (and listed). Items without a sales count count as 0 sold.
 * The quadrants and the average margin are recomputed by the checker without division.
 */
export function verifiedMenuEngineering(
  verified: VerifiedProject,
  sold: ReadonlyMap<string, number>,
  /** injectable for mutation tests */
  engine: typeof menuEngineering = menuEngineering,
): VerifiedMenuEng {
  const items: MenuEngInput[] = [];
  const excluded: MenuEngExcluded[] = [];
  for (const [id, v] of verified.menu) {
    if (v.status !== 'ok') excluded.push({ id, reason: 'not-costed' });
    else if (v.grossProfit === null) excluded.push({ id, reason: 'no-price' });
    else {
      const n = sold.get(id) ?? 0;
      if (!Number.isSafeInteger(n) || n < 0) return { status: 'mismatch', detail: `sold ${id}` };
      items.push({ id, sold: n, margin: v.grossProfit });
    }
  }
  const res = engine(items);
  const chk = recomputeMenuEngineering(items);
  if (!res.ok) {
    if (chk !== null) return { status: 'mismatch', detail: 'empty' };
    return { status: 'empty', reason: res.reason, excluded };
  }
  if (chk === null) return { status: 'mismatch', detail: 'not empty' };
  if (BigInt(res.totalSold) !== chk.totalSold) return { status: 'mismatch', detail: 'total sold' };
  if (!eq(res.totalMargin, chk.marginSum)) return { status: 'mismatch', detail: 'total margin' };
  if (!eq(mul(res.averageMargin, rat(chk.totalSold)), chk.marginSum))
    return { status: 'mismatch', detail: 'average margin' };
  if (res.rows.length !== items.length) return { status: 'mismatch', detail: 'rows' };
  for (const [k, r] of res.rows.entries()) {
    const x = items[k]!;
    if (r.id !== x.id || r.sold !== x.sold || !eq(r.margin, x.margin))
      return { status: 'mismatch', detail: `row ${x.id}` };
    if (chk.quadrants.get(r.id) !== r.quadrant) return { status: 'mismatch', detail: r.id };
    if (!eq(mul(r.mix, rat(chk.totalSold)), rat(BigInt(r.sold))))
      return { status: 'mismatch', detail: `mix ${r.id}` };
    if (!eq(r.totalMargin, mul(rat(BigInt(r.sold)), r.margin)))
      return { status: 'mismatch', detail: `total ${r.id}` };
  }
  return { status: 'ok', ...res, excluded };
}
