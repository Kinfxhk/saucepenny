// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Scaling: (a) make a different batch size — every line quantity and the cost scale by the
// same exact factor; (b) "I only have 3 kg of chicken: how much can I make?" — the amount of
// one ingredient needed per yield unit (through sub-recipes, including line losses), and
// the largest yield the available amount allows.

import type { Project, ProjectError, UnitRef } from '../model/index';
import { add, div, isZero, mul, rat, sub, ZERO, type Rational } from '../num/index';
import { analyse, buildGraph } from '../graph/index';
import { ingredientCost } from './engine';
import { resolveUnit, toBaseOf } from './units';

const ONE = rat(1n);

/** Line quantities for a batch of `newYield` instead of the recipe's own yield. */
export function scaledLines(project: Project, recipeId: string, newYield: Rational): Rational[] {
  const r = project.recipes.get(recipeId)!;
  const k = div(newYield, r.yieldQty);
  return r.lines.map((l) => mul(l.qty, k));
}

export type Requirement =
  | {
      ok: true;
      /** ingredient base units (g, ml or piece) per one yield unit */ perYieldUnit: Rational;
    }
  | { ok: false; error: ProjectError };

/** How much of an ingredient (in its base unit) one yield unit of a recipe needs. */
export function requirement(project: Project, recipeId: string, ingredientId: string): Requirement {
  const info = analyse(buildGraph(project.recipes.values()));
  if (info.cyclic.has(recipeId) || info.blockedByCycle.has(recipeId))
    return { ok: false, error: { code: 'cycle', path: `recipes.${recipeId}` } };
  const ing = project.ingredients.get(ingredientId)!;
  const ingDim = ingredientCost(ing, project).dim;
  const memo = new Map<string, Requirement>();
  const perBatch = (id: string): Requirement => {
    const hit = memo.get(id);
    if (hit) return hit;
    const recipe = project.recipes.get(id)!;
    let total = ZERO;
    for (let j = 0; j < recipe.lines.length; j++) {
      const line = recipe.lines[j]!;
      const lp = `recipes.${id}.lines[${j}]`;
      const lu = resolveUnit(line.unit, project.measures);
      const keep = sub(ONE, line.waste);
      if (line.ref.kind === 'ingredient') {
        if (line.ref.id !== ingredientId) continue;
        const q = toBaseOf(
          line.qty,
          lu,
          ingDim,
          { densityGPerMl: ing.density, pieceWeightG: ing.pieceWeight },
          lp,
        );
        if (!q.ok) return { ok: false, error: q.error };
        total = add(total, div(q.value, keep));
      } else {
        const child = project.recipes.get(line.ref.id)!;
        const cy = resolveUnit(child.yieldUnit, project.measures);
        const q = toBaseOf(line.qty, lu, cy.dim, { densityGPerMl: child.density }, lp);
        if (!q.ok) return { ok: false, error: q.error };
        const childBatch = perBatch(child.id);
        if (!childBatch.ok) return childBatch;
        const batches = div(q.value, mul(child.yieldQty, cy.factor));
        total = add(total, div(mul(batches, childBatch.perYieldUnit), keep));
      }
    }
    const res: Requirement = { ok: true, perYieldUnit: total }; // per whole batch here
    memo.set(id, res);
    return res;
  };
  const batch = perBatch(recipeId);
  if (!batch.ok) return batch;
  const r = project.recipes.get(recipeId)!;
  return { ok: true, perYieldUnit: div(batch.perYieldUnit, r.yieldQty) };
}

export type MaxYield =
  | { ok: true; yieldUnits: Rational | null /* null: the recipe does not use it */ }
  | { ok: false; error: ProjectError };

/** Largest yield (in the recipe's yield units) that `qty` `unit` of the ingredient allows. */
export function maxYield(
  project: Project,
  recipeId: string,
  ingredientId: string,
  qty: Rational,
  unit: UnitRef,
): MaxYield {
  const req = requirement(project, recipeId, ingredientId);
  if (!req.ok) return req;
  if (isZero(req.perYieldUnit)) return { ok: true, yieldUnits: null };
  const ing = project.ingredients.get(ingredientId)!;
  const have = toBaseOf(
    qty,
    resolveUnit(unit, project.measures),
    ingredientCost(ing, project).dim,
    { densityGPerMl: ing.density, pieceWeightG: ing.pieceWeight },
    'available',
  );
  if (!have.ok) return { ok: false, error: have.error };
  return { ok: true, yieldUnits: div(have.value, req.perYieldUnit) };
}
