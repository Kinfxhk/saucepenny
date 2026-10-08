// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Main costing engine (calculation rules 1–4 in docs/calculation-rules.md):
//   1. ingredient cost per base unit = price ÷ (pack quantity in base units × yield)
//   2. line cost = quantity in base units × cost per base unit ÷ (1 − line waste)
//   3. recipe total = Σ line costs; cost per yield unit = total ÷ yield
//   4. a sub-recipe line costs quantity × the sub-recipe's cost per yield unit
// Recursion over the sub-recipe graph with memoisation by recipe id. Everything is exact.

import { analyse, buildGraph } from '../graph/index';
import {
  LIMITS,
  type Ingredient,
  type Project,
  type ProjectError,
  type Recipe,
} from '../model/index';
import { add, div, mul, rat, sub, ZERO, type Rational } from '../num/index';
import { resolveUnit, toBaseOf, type Dim } from './units';

export interface IngredientCost {
  dim: Dim;
  /** money per base unit (g, ml or piece) of usable ingredient */
  perBase: Rational;
}

export type RecipeCost =
  | {
      ok: true;
      total: Rational;
      yieldDim: Dim;
      yieldBase: Rational;
      /** money per base unit of yield */
      perYieldBase: Rational;
      /** cost of each line, in line order */
      lines: Rational[];
      depth: number;
    }
  | { ok: false; error: ProjectError };

export function ingredientCost(ing: Ingredient, project: Project): IngredientCost {
  const u = resolveUnit(ing.packUnit, project.measures);
  const usableBase = mul(mul(ing.packQty, u.factor), ing.yield);
  return { dim: u.dim, perBase: div(ing.price, usableBase) };
}

const ONE = rat(1n);

export function costRecipes(project: Project): Map<string, RecipeCost> {
  const graph = buildGraph(project.recipes.values());
  const info = analyse(graph);
  const memo = new Map<string, RecipeCost>();
  const ingMemo = new Map<string, IngredientCost>();
  const nameOf = (id: string) => project.recipes.get(id)?.name ?? id;

  for (const [id, cycle] of info.cyclic)
    memo.set(id, {
      ok: false,
      error: {
        code: 'cycle',
        path: `recipes.${id}`,
        params: { cycle: cycle.map(nameOf).join(' → ') },
      },
    });

  const costOf = (id: string): RecipeCost => {
    const hit = memo.get(id);
    if (hit) return hit;
    const recipe = project.recipes.get(id)!;
    const result = compute(recipe);
    memo.set(id, result);
    return result;
  };

  const compute = (recipe: Recipe): RecipeCost => {
    const path = `recipes.${recipe.id}`;
    if (info.blockedByCycle.has(recipe.id)) {
      const bad = recipe.lines.find(
        (l) =>
          l.ref.kind === 'recipe' &&
          (info.cyclic.has(l.ref.id) || info.blockedByCycle.has(l.ref.id)),
      )!;
      return {
        ok: false,
        error: { code: 'recipe-error', path, params: { recipe: nameOf(bad.ref.id) } },
      };
    }
    const depth = info.depth.get(recipe.id) ?? 0;
    if (depth > LIMITS.nestingDepth)
      return {
        ok: false,
        error: { code: 'too-deep-nesting', path, params: { max: LIMITS.nestingDepth } },
      };
    const yieldUnit = resolveUnit(recipe.yieldUnit, project.measures);
    const yieldBase = mul(recipe.yieldQty, yieldUnit.factor);
    const lines: Rational[] = [];
    let total = ZERO;
    for (let j = 0; j < recipe.lines.length; j++) {
      const line = recipe.lines[j]!;
      const lp = `${path}.lines[${j}]`;
      const lu = resolveUnit(line.unit, project.measures);
      let unitCost: Rational;
      let qtyBase: Rational;
      if (line.ref.kind === 'ingredient') {
        const ing = project.ingredients.get(line.ref.id)!;
        let ic = ingMemo.get(ing.id);
        if (!ic) {
          ic = ingredientCost(ing, project);
          ingMemo.set(ing.id, ic);
        }
        const q = toBaseOf(
          line.qty,
          lu,
          ic.dim,
          { densityGPerMl: ing.density, pieceWeightG: ing.pieceWeight },
          lp,
        );
        if (!q.ok)
          return {
            ok: false,
            error: { ...q.error, params: { ...q.error.params, item: ing.name } },
          };
        qtyBase = q.value;
        unitCost = ic.perBase;
      } else {
        const child = project.recipes.get(line.ref.id)!;
        const cc = costOf(child.id);
        if (!cc.ok)
          return {
            ok: false,
            error: { code: 'recipe-error', path: lp, params: { recipe: child.name } },
          };
        const q = toBaseOf(line.qty, lu, cc.yieldDim, { densityGPerMl: child.density }, lp);
        if (!q.ok)
          return {
            ok: false,
            error: { ...q.error, params: { ...q.error.params, item: child.name } },
          };
        qtyBase = q.value;
        unitCost = cc.perYieldBase;
      }
      const cost = div(mul(qtyBase, unitCost), sub(ONE, line.waste));
      lines.push(cost);
      total = add(total, cost);
    }
    return {
      ok: true,
      total,
      yieldDim: yieldUnit.dim,
      yieldBase,
      perYieldBase: div(total, yieldBase),
      lines,
      depth,
    };
  };

  for (const id of project.recipes.keys()) costOf(id);
  return memo;
}

/** Share of the recipe total for each line (0 when the total is 0). */
export function lineShares(rc: Extract<RecipeCost, { ok: true }>): Rational[] {
  return rc.lines.map((c) => (rc.total.n === 0n ? ZERO : div(c, rc.total)));
}
