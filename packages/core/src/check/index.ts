// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Independent checker. It must never import the costing engine (cost/), and it uses a
// different method on purpose:
//   - quantities are converted straight into the ingredient's *own pack unit* (not into
//     base units), and costed as "number of packs × pack price ÷ yield";
//   - a recipe is first *expanded* into a flat list "raw ingredient → total packs needed",
//     walking the sub-recipe DAG and multiplying the share of each sub-recipe used along the
//     way (diamonds are walked once per path and added up); only then is money computed;
//   - cycles are found by a plain depth-first search with a path stack.
// The engine's numbers are shown only if they are *exactly* equal to these.

import type { Measure, Project, Recipe, UnitRef } from '../model/index';
import { LIMITS } from '../model/limits';
import {
  add,
  cmp,
  div,
  eq,
  mul,
  rat,
  sub,
  ZERO,
  type PriceRounding,
  type Rational,
} from '../num/index';
import { UNITS, type Dimension } from '../units/table';

type Kind = Dimension | 'portion';
interface Scale {
  kind: Kind;
  /** g, ml, piece or portion per one unit */
  size: Rational;
}

function scaleOf(ref: UnitRef, measures: ReadonlyMap<string, Measure>): Scale {
  if (ref === 'portion') return { kind: 'portion', size: rat(1n) };
  if (ref.startsWith('measure:')) {
    const m = measures.get(ref.slice('measure:'.length))!;
    return { kind: UNITS[m.unit].dimension, size: mul(UNITS[m.unit].factor, m.amount) };
  }
  const u = UNITS[ref as keyof typeof UNITS];
  return { kind: u.dimension, size: u.factor };
}

/** grams in one base unit of a kind, given optional density (g/ml) and piece weight (g). */
function gramsPerBase(kind: Kind, density?: Rational, piece?: Rational): Rational | undefined {
  if (kind === 'mass') return rat(1n);
  if (kind === 'volume') return density;
  if (kind === 'count') return piece;
  return undefined;
}

/** How many `to` units is `qty` `from` units? undefined when it cannot be converted. */
function amountIn(
  qty: Rational,
  from: Scale,
  to: Scale,
  density?: Rational,
  piece?: Rational,
): Rational | undefined {
  if (from.kind === to.kind) return div(mul(qty, from.size), to.size);
  if (from.kind === 'portion' || to.kind === 'portion') return undefined;
  const gf = gramsPerBase(from.kind, density, piece);
  const gt = gramsPerBase(to.kind, density, piece);
  if (!gf || !gt || gf.n <= 0n || gt.n <= 0n) return undefined;
  return div(mul(mul(qty, from.size), gf), mul(to.size, gt));
}

export type CheckFailure = 'cycle' | 'too-deep' | 'units';

export interface RecomputedRecipe {
  total: Rational;
  /** money per one yield *unit* as entered (e.g. per portion, per kg) */
  perYieldUnit: Rational;
  lineCosts: Rational[];
}

export class Checker {
  private readonly cyclic = new Set<string>();
  private readonly packCost = new Map<string, Rational>();

  constructor(private readonly project: Project) {
    this.findCycles();
    for (const ing of project.ingredients.values())
      this.packCost.set(ing.id, div(ing.price, ing.yield)); // money per usable pack
  }

  private findCycles(): void {
    const state = new Map<string, 1 | 2>(); // 1 = on path, 2 = done
    const visit = (id: string, path: string[]) => {
      state.set(id, 1);
      path.push(id);
      for (const l of this.project.recipes.get(id)!.lines) {
        if (l.ref.kind !== 'recipe') continue;
        const s = state.get(l.ref.id);
        if (s === 1) for (const x of path.slice(path.indexOf(l.ref.id))) this.cyclic.add(x);
        else if (s === undefined) visit(l.ref.id, path);
      }
      path.pop();
      state.set(id, 2);
    };
    for (const id of this.project.recipes.keys()) if (!state.has(id)) visit(id, []);
  }

  private touching: Set<string> | undefined;

  /** Is this recipe on, or does it depend on, a cycle? */
  touchesCycle(id: string): boolean {
    if (!this.touching) {
      // Walk backwards from every recipe on a cycle to everything that uses it.
      const usedBy = new Map<string, string[]>();
      for (const r of this.project.recipes.values())
        for (const l of r.lines)
          if (l.ref.kind === 'recipe') {
            const list = usedBy.get(l.ref.id) ?? [];
            list.push(r.id);
            usedBy.set(l.ref.id, list);
          }
      const touching = new Set(this.cyclic);
      const queue = [...this.cyclic];
      while (queue.length) {
        for (const parent of usedBy.get(queue.pop()!) ?? [])
          if (!touching.has(parent)) {
            touching.add(parent);
            queue.push(parent);
          }
      }
      this.touching = touching;
    }
    return this.touching.has(id);
  }

  /** Raw packs needed for ONE whole batch of a recipe, and its nesting height (memoised). */
  private readonly batchMemo = new Map<
    string,
    { packs: Map<string, Rational>; height: number } | CheckFailure
  >();

  /**
   * `physical` = the packs really used (for "how much can I make"); otherwise the packs
   * that are *paid for* in the cost, i.e. each line weighted by its counted share.
   */
  private batchPacks(id: string, physical = false): Map<string, Rational> | CheckFailure {
    const key = `${physical ? 'p' : 'c'}:${id}`;
    let entry = this.batchMemo.get(key);
    if (!entry) {
      const recipe = this.project.recipes.get(id)!;
      const packs = new Map<string, Rational>();
      let height = 0;
      entry = { packs, height };
      for (let j = 0; j < recipe.lines.length; j++) {
        const line = recipe.lines[j]!;
        if (!physical && line.share.n === 0n) continue; // a pinch, not costed
        if (line.ref.kind === 'recipe') {
          const childPacks = this.batchPacks(line.ref.id, physical);
          if (typeof childPacks === 'string') {
            entry = childPacks;
            break;
          }
          const ch = this.batchMemo.get(`${physical ? 'p' : 'c'}:${line.ref.id}`);
          if (ch && typeof ch !== 'string') height = Math.max(height, ch.height + 1);
        }
        const err = this.lineInto(recipe, j, rat(1n), packs, undefined, physical);
        if (err) {
          entry = err;
          break;
        }
      }
      if (typeof entry !== 'string') entry = { packs, height };
      if (typeof entry !== 'string' && height > LIMITS.nestingDepth) entry = 'too-deep';
      this.batchMemo.set(key, entry);
    }
    return typeof entry === 'string' ? entry : entry.packs;
  }

  /**
   * Add the raw packs used by line `j` of `batches` batches of `recipe` into `packs`.
   * A sub-recipe line contributes (its batches) × (the sub-recipe's own batch packs), so a
   * sub-recipe reached along two paths (a diamond) is counted once per path.
   */
  private lineInto(
    recipe: Recipe,
    j: number,
    batches: Rational,
    packs: Map<string, Rational>,
    moneyInto?: { total: Rational },
    physical = false,
  ): CheckFailure | undefined {
    const line = recipe.lines[j]!;
    if (!physical) {
      if (line.share.n === 0n) return undefined; // a pinch, not costed
      batches = mul(batches, line.share); // pay for this share of the line only
    }
    const from = scaleOf(line.unit, this.project.measures);
    const keep = sub(rat(1n), line.waste);
    if (line.ref.kind === 'ingredient') {
      const ing = this.project.ingredients.get(line.ref.id)!;
      const inPackUnits = amountIn(
        line.qty,
        from,
        scaleOf(ing.packUnit, this.project.measures),
        ing.density,
        ing.pieceWeight,
      );
      if (!inPackUnits) return 'units';
      const n = div(div(mul(inPackUnits, batches), ing.packQty), keep);
      packs.set(ing.id, add(packs.get(ing.id) ?? ZERO, n));
      return undefined;
    }
    const child = this.project.recipes.get(line.ref.id)!;
    const inYieldUnits = amountIn(
      line.qty,
      from,
      scaleOf(child.yieldUnit, this.project.measures),
      child.density,
    );
    if (!inYieldUnits) return 'units';
    const childBatches = div(div(mul(inYieldUnits, batches), child.yieldQty), keep);
    if (moneyInto) {
      // Same expansion, priced once per sub-recipe batch (memoised) instead of per line.
      const money = this.batchMoney(child.id);
      if (typeof money === 'string') return money;
      moneyInto.total = add(moneyInto.total, mul(money, childBatches));
      return undefined;
    }
    const childPacks = this.batchPacks(child.id, physical);
    if (typeof childPacks === 'string') return childPacks;
    for (const [id, n] of childPacks)
      packs.set(id, add(packs.get(id) ?? ZERO, mul(n, childBatches)));
    return undefined;
  }

  private readonly moneyMemo = new Map<string, Rational | CheckFailure>();

  /** Money for one whole batch of a recipe: its raw packs, priced (memoised). */
  private batchMoney(id: string): Rational | CheckFailure {
    let m = this.moneyMemo.get(id);
    if (m === undefined) {
      const packs = this.batchPacks(id);
      m = typeof packs === 'string' ? packs : this.price(packs);
      this.moneyMemo.set(id, m);
    }
    return m;
  }

  /** Money for a set of packs. */
  private price(packs: Map<string, Rational>): Rational {
    let total = ZERO;
    for (const [id, n] of packs) total = add(total, mul(n, this.packCost.get(id)!));
    return total;
  }

  /**
   * Raw ingredient packs for `units` yield units of a recipe (used for "price change
   * impact" and for checking the whole menu).
   */
  packsFor(
    recipeId: string,
    yieldUnits: Rational,
    physical = false,
  ): Map<string, Rational> | CheckFailure {
    if (this.touchesCycle(recipeId)) return 'cycle';
    const r = this.project.recipes.get(recipeId)!;
    const batch = this.batchPacks(recipeId, physical);
    if (typeof batch === 'string') return batch;
    const batches = div(yieldUnits, r.yieldQty);
    return new Map([...batch].map(([id, n]) => [id, mul(n, batches)]));
  }

  private readonly recipeMemo = new Map<string, RecomputedRecipe | CheckFailure>();

  recipe(recipeId: string): RecomputedRecipe | CheckFailure {
    let res = this.recipeMemo.get(recipeId);
    if (!res) {
      res = this.recomputeRecipe(recipeId);
      this.recipeMemo.set(recipeId, res);
    }
    return res;
  }

  private recomputeRecipe(recipeId: string): RecomputedRecipe | CheckFailure {
    if (this.touchesCycle(recipeId)) return 'cycle';
    const r = this.project.recipes.get(recipeId)!;
    const lineCosts: Rational[] = [];
    // The whole batch, expanded in one go (not the sum of line costs).
    const all = this.batchPacks(recipeId);
    if (typeof all === 'string') return all;
    for (let j = 0; j < r.lines.length; j++) {
      const packs = new Map<string, Rational>();
      const money = { total: ZERO };
      const err = this.lineInto(r, j, rat(1n), packs, money);
      if (err) return err;
      lineCosts.push(add(money.total, this.price(packs)));
    }
    const total = this.batchMoney(recipeId) as Rational; // = price(all)
    return { total, perYieldUnit: div(total, r.yieldQty), lineCosts };
  }

  /** Money for one `unit` of usable ingredient (e.g. per kg), via its pack. */
  ingredientUnitCost(ingredientId: string, unit: UnitRef): Rational | CheckFailure {
    const ing = this.project.ingredients.get(ingredientId)!;
    const packs = amountIn(
      rat(1n),
      scaleOf(unit, this.project.measures),
      scaleOf(ing.packUnit, this.project.measures),
      ing.density,
      ing.pieceWeight,
    );
    if (!packs) return 'units';
    return mul(div(packs, ing.packQty), this.packCost.get(ing.id)!);
  }

  /** Cost of `qty` `unit` of a recipe (e.g. one portion, or 300 g of soup). */
  amountCost(recipeId: string, qty: Rational, unit: UnitRef): Rational | CheckFailure {
    const rec = this.recipe(recipeId);
    if (typeof rec === 'string') return rec;
    const r = this.project.recipes.get(recipeId)!;
    const units = amountIn(
      qty,
      scaleOf(unit, this.project.measures),
      scaleOf(r.yieldUnit, this.project.measures),
      r.density,
    );
    if (!units) return 'units';
    return mul(units, rec.perYieldUnit);
  }
}

/**
 * Labour and overhead, recomputed another way: everything is first put over 60 (per-minute
 * money) and summed, then the food share is added; no shared code with cost/extras.
 */
export function recomputeExtras(
  r: Recipe,
  food: Rational,
): { labour: Rational; overhead: Rational; full: Rational } {
  const e = r.extras;
  const labour = div(mul(e.labourRate, e.labourMinutes), rat(60n));
  const overheadOnFood = div(mul(food, mul(e.overheadRate, rat(100n))), rat(100n));
  const overhead = add(overheadOnFood, e.overheadFixed);
  return { labour, overhead, full: add(add(labour, overhead), food) };
}

/** Ingredient weight in grams of one batch (lines as entered), or the lines it cannot weigh. */
export function recomputeWeight(
  project: Project,
  r: Recipe,
): { grams: Rational } | { missing: number[] } {
  const gram: Scale = { kind: 'mass', size: rat(1n) };
  const missing: number[] = [];
  let grams = ZERO;
  for (let j = 0; j < r.lines.length; j++) {
    const l = r.lines[j]!;
    const from = scaleOf(l.unit, project.measures);
    let g: Rational | undefined;
    if (l.ref.kind === 'ingredient') {
      const ing = project.ingredients.get(l.ref.id)!;
      g = amountIn(l.qty, from, gram, ing.density, ing.pieceWeight);
    } else g = amountIn(l.qty, from, gram, project.recipes.get(l.ref.id)!.density);
    if (g === undefined) missing.push(j);
    else grams = add(grams, g);
  }
  return missing.length ? { missing } : { grams };
}

export const sameNumber = eq;

export interface RecomputedMenu {
  portionCost: Rational;
  netPrice: Rational;
  foodCost: Rational | null;
  grossProfit: Rational | null;
  band: 'good' | 'watch' | 'high' | null;
  /** the raw (unrounded) listed price that meets the target exactly */
  rawSuggested: Rational;
}

/** Net price (without service charge), computed as price × 1/(1 + s). */
export function netPriceOf(price: Rational, includes: boolean, serviceCharge: Rational): Rational {
  return includes ? mul(price, div(rat(1n), add(rat(1n), serviceCharge))) : price;
}

/**
 * Is `s` an acceptable suggested price for `raw` under `rule`? It must be on the rule's grid,
 * not below `raw`, and less than one grid step above it (so it is the smallest such price).
 * This checks the result instead of repeating the rounding code.
 */
export function isValidSuggestion(s: Rational, raw: Rational, rule: PriceRounding): boolean {
  if (raw.n === 0n) return s.n === 0n;
  if (cmp(s, raw) < 0) return false;
  if (rule === 'ending-8') {
    if (s.d !== 1n || ((s.n % 10n) + 10n) % 10n !== 8n) return false;
    return cmp(sub(s, rat(10n)), raw) < 0;
  }
  const step = { none: rat(1n, 100n), '0.1': rat(1n, 10n), '0.5': rat(1n, 2n), '1': rat(1n) }[rule];
  if (div(s, step).d !== 1n) return false;
  return cmp(sub(s, step), raw) < 0;
}

export function recomputeMenu(
  checker: Checker,
  project: Project,
  itemId: string,
): RecomputedMenu | CheckFailure {
  const item = project.menu.get(itemId)!;
  const portionCost = checker.amountCost(item.recipeId, item.portionQty, item.portionUnit);
  if (typeof portionCost === 'string') return portionCost;
  const sc = project.settings.serviceCharge;
  const netPrice = netPriceOf(item.price, item.priceIncludesService, sc);
  const zero = netPrice.n === 0n;
  const foodCost = zero ? null : div(portionCost, netPrice);
  // Band by cross-multiplication: cost ≤ good × net → good; cost > high × net → high.
  let band: RecomputedMenu['band'] = null;
  if (!zero) {
    if (cmp(portionCost, mul(project.settings.good, netPrice)) <= 0) band = 'good';
    else if (cmp(portionCost, mul(project.settings.high, netPrice)) > 0) band = 'high';
    else band = 'watch';
  }
  const rawSuggested = item.priceIncludesService
    ? div(mul(portionCost, add(rat(1n), sc)), item.target)
    : div(portionCost, item.target);
  return {
    portionCost,
    netPrice,
    foodCost,
    grossProfit: zero ? null : sub(netPrice, portionCost),
    band,
    rawSuggested,
  };
}
