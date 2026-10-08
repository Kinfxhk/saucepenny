// SPDX-License-Identifier: AGPL-3.0-or-later
//
// "What if this ingredient's price changes?" — recompute everything with the new price and
// list every recipe and menu item whose cost changes (directly or through sub-recipes).

import type { Ingredient, Project } from '../model/index';
import { eq, sub, type Rational } from '../num/index';
import { costRecipes } from './engine';
import { priceMenu } from './pricing';

export interface ImpactRow {
  kind: 'recipe' | 'menu';
  id: string;
  name: string;
  /** recipe: total cost of one batch; menu: cost per portion */
  before: Rational;
  after: Rational;
  change: Rational;
}

export function withPrice(project: Project, ingredientId: string, price: Rational): Project {
  const ingredients = new Map<string, Ingredient>(project.ingredients);
  const ing = ingredients.get(ingredientId);
  if (!ing) throw new Error(`unknown ingredient ${ingredientId}`);
  ingredients.set(ingredientId, { ...ing, price });
  return { ...project, ingredients };
}

export function priceImpact(
  project: Project,
  ingredientId: string,
  newPrice: Rational,
): ImpactRow[] {
  const after = withPrice(project, ingredientId, newPrice);
  const rb = costRecipes(project);
  const ra = costRecipes(after);
  const rows: ImpactRow[] = [];
  for (const [id, b] of rb) {
    const a = ra.get(id)!;
    if (b.ok && a.ok && !eq(a.total, b.total))
      rows.push({
        kind: 'recipe',
        id,
        name: project.recipes.get(id)!.name,
        before: b.total,
        after: a.total,
        change: sub(a.total, b.total),
      });
  }
  const mb = priceMenu(project, rb);
  const ma = priceMenu(after, ra);
  for (const [id, b] of mb) {
    const a = ma.get(id)!;
    if (b.ok && a.ok && !eq(a.portionCost, b.portionCost))
      rows.push({
        kind: 'menu',
        id,
        name: project.menu.get(id)!.name,
        before: b.portionCost,
        after: a.portionCost,
        change: sub(a.portionCost, b.portionCost),
      });
  }
  return rows;
}
