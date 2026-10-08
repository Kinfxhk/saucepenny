// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The only entry point the UI and CLI use for numbers. Every engine result is recomputed
// by the independent checker; a number is marked verified only when both agree *exactly*.
// If they ever disagree, the number is withheld and an internal error is shown instead.

import { Checker, isValidSuggestion, netPriceOf, recomputeMenu } from './check/index';
import {
  costRecipes,
  maxYield,
  priceImpact,
  priceMenu,
  withPrice,
  type ImpactRow,
  type MenuCost,
  type RecipeCost,
} from './cost/index';
import { resolveUnit, toBaseOf } from './cost/units';
import type { Project, ProjectError, UnitRef } from './model/index';
import { cmp, div, eq, mul, rat, type Rational } from './num/index';

export type VerifiedRecipe =
  | {
      status: 'ok';
      total: Rational;
      /** money per one yield unit as entered (per portion, per kg, …) */
      perYieldUnit: Rational;
      lines: Rational[];
      depth: number;
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
  return {
    status: 'ok',
    total: engine.total,
    perYieldUnit,
    lines: engine.lines,
    depth: engine.depth,
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

/** Cost and price everything, verified. This is what the UI and CLI display. */
export function verifiedProject(project: Project): VerifiedProject {
  const engine = costRecipes(project);
  const checker = new Checker(project);
  const recipes = new Map<string, VerifiedRecipe>();
  for (const id of project.recipes.keys())
    recipes.set(id, verifyRecipe(project, id, engine.get(id)!, checker));
  const menuCosts = priceMenu(project, engine);
  const menu = new Map<string, VerifiedMenu>();
  for (const id of project.menu.keys())
    menu.set(id, verifyMenuItem(project, id, menuCosts.get(id)!, checker));
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
  const packs = new Checker(project).packsFor(recipeId, rat(1n));
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
