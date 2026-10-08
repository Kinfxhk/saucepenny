// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The only entry point the UI and CLI use for numbers. Every engine result is recomputed
// by the independent checker; a number is marked verified only when both agree *exactly*.
// If they ever disagree, the number is withheld and an internal error is shown instead.

import { Checker } from './check/index';
import { costRecipes, type RecipeCost } from './cost/index';
import { resolveUnit } from './cost/units';
import type { Project, ProjectError } from './model/index';
import { eq, mul, type Rational } from './num/index';

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
