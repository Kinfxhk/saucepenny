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
import { add, div, eq, mul, rat, sub, ZERO, type Rational } from '../num/index';
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

  /** Is this recipe on, or does it depend on, a cycle? */
  touchesCycle(id: string, seen = new Set<string>()): boolean {
    if (this.cyclic.has(id)) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return this.project.recipes
      .get(id)!
      .lines.some((l) => l.ref.kind === 'recipe' && this.touchesCycle(l.ref.id, seen));
  }

  /** Raw packs needed for ONE whole batch of a recipe, and its nesting height (memoised). */
  private readonly batchMemo = new Map<
    string,
    { packs: Map<string, Rational>; height: number } | CheckFailure
  >();

  private batchPacks(id: string): Map<string, Rational> | CheckFailure {
    let entry = this.batchMemo.get(id);
    if (!entry) {
      const recipe = this.project.recipes.get(id)!;
      const packs = new Map<string, Rational>();
      let height = 0;
      entry = { packs, height };
      for (let j = 0; j < recipe.lines.length; j++) {
        const line = recipe.lines[j]!;
        if (line.ref.kind === 'recipe') {
          const childPacks = this.batchPacks(line.ref.id);
          if (typeof childPacks === 'string') {
            entry = childPacks;
            break;
          }
          const ch = this.batchMemo.get(line.ref.id);
          if (ch && typeof ch !== 'string') height = Math.max(height, ch.height + 1);
        }
        const err = this.lineInto(recipe, j, rat(1n), packs);
        if (err) {
          entry = err;
          break;
        }
      }
      if (typeof entry !== 'string') entry = { packs, height };
      if (typeof entry !== 'string' && height > LIMITS.nestingDepth) entry = 'too-deep';
      this.batchMemo.set(id, entry);
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
  ): CheckFailure | undefined {
    const line = recipe.lines[j]!;
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
    const childPacks = this.batchPacks(child.id);
    if (typeof childPacks === 'string') return childPacks;
    for (const [id, n] of childPacks)
      packs.set(id, add(packs.get(id) ?? ZERO, mul(n, childBatches)));
    return undefined;
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
  packsFor(recipeId: string, yieldUnits: Rational): Map<string, Rational> | CheckFailure {
    if (this.touchesCycle(recipeId)) return 'cycle';
    const r = this.project.recipes.get(recipeId)!;
    const batch = this.batchPacks(recipeId);
    if (typeof batch === 'string') return batch;
    const batches = div(yieldUnits, r.yieldQty);
    return new Map([...batch].map(([id, n]) => [id, mul(n, batches)]));
  }

  recipe(recipeId: string): RecomputedRecipe | CheckFailure {
    if (this.touchesCycle(recipeId)) return 'cycle';
    const r = this.project.recipes.get(recipeId)!;
    const lineCosts: Rational[] = [];
    // The whole batch, expanded in one go (not the sum of line costs).
    const all = this.batchPacks(recipeId);
    if (typeof all === 'string') return all;
    for (let j = 0; j < r.lines.length; j++) {
      const packs = new Map<string, Rational>();
      const err = this.lineInto(r, j, rat(1n), packs);
      if (err) return err;
      lineCosts.push(this.price(packs));
    }
    const total = this.price(all);
    return { total, perYieldUnit: div(total, r.yieldQty), lineCosts };
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

export const sameNumber = eq;
