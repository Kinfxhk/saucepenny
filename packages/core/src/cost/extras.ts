// SPDX-License-Identifier: AGPL-3.0-or-later
//
// v0.2 engine additions (calculation rules 13–14 in docs/calculation-rules.md):
//   13. labour = minutes ÷ 60 × hourly rate; overhead = fixed amount + food cost × overhead %;
//      full cost = food cost + labour + overhead. Food cost % never includes labour or
//      overhead, and a sub-recipe's own labour/overhead is not carried into recipes that
//      use it (enter the time on the recipe you actually cost).
//   14. ingredient weight of a batch = Σ line quantities converted to grams (as entered,
//      before line waste and cooking loss). Lines that cannot be weighed are listed.

import type { Project, Recipe } from '../model/index';
import { add, div, mul, rat, ZERO, type Rational } from '../num/index';
import { resolveUnit, toBaseOf } from './units';

export interface ExtrasCost {
  labour: Rational;
  overhead: Rational;
  /** food + labour + overhead for one batch */
  full: Rational;
}

const SIXTY = rat(60n);

export function recipeExtras(recipe: Recipe, food: Rational): ExtrasCost {
  const e = recipe.extras;
  const labour = mul(div(e.labourMinutes, SIXTY), e.labourRate);
  const overhead = add(e.overheadFixed, mul(food, e.overheadRate));
  return { labour, overhead, full: add(add(food, labour), overhead) };
}

/** True when the recipe has any labour or overhead entered (non-zero). */
export function hasExtras(recipe: Recipe): boolean {
  const e = recipe.extras;
  return (
    (e.labourMinutes.n !== 0n && e.labourRate.n !== 0n) ||
    e.overheadFixed.n !== 0n ||
    e.overheadRate.n !== 0n
  );
}

export type WeightResult = { ok: true; grams: Rational } | { ok: false; missing: number[] };

export function recipeWeight(project: Project, recipe: Recipe): WeightResult {
  let grams = ZERO;
  const missing: number[] = [];
  recipe.lines.forEach((line, j) => {
    const lu = resolveUnit(line.unit, project.measures);
    const info =
      line.ref.kind === 'ingredient'
        ? (() => {
            const ing = project.ingredients.get(line.ref.id)!;
            return { densityGPerMl: ing.density, pieceWeightG: ing.pieceWeight };
          })()
        : { densityGPerMl: project.recipes.get(line.ref.id)!.density };
    const q = toBaseOf(line.qty, lu, 'mass', info, '');
    if (q.ok) grams = add(grams, q.value);
    else missing.push(j);
  });
  return missing.length ? { ok: false, missing } : { ok: true, grams };
}
