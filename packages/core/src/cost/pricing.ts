// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Menu pricing (calculation rules 5–7): cost per portion, net price without service
// charge, food cost %, gross profit, suggested price rounded UP, and the real food cost %
// at that suggested price.

import type { MenuItem, Project, ProjectError } from '../model/index';
import {
  add,
  div,
  gt,
  isZero,
  le,
  mul,
  rat,
  roundPriceUp,
  sub,
  ZERO,
  type Rational,
} from '../num/index';
import type { RecipeCost } from './engine';
import { resolveUnit, toBaseOf } from './units';

export type Band = 'good' | 'watch' | 'high';

export type MenuCost =
  | {
      ok: true;
      portionCost: Rational;
      /** price without service charge */
      netPrice: Rational;
      /** portion cost ÷ net price; null when the price is 0 */
      foodCost: Rational | null;
      /** net price − portion cost; null when the price is 0 */
      grossProfit: Rational | null;
      band: Band | null;
      suggestedPrice: Rational;
      /** food cost at the suggested price (never above target) */
      suggestedFoodCost: Rational;
    }
  | { ok: false; error: ProjectError };

const ONE = rat(1n);

export function netOf(
  price: Rational,
  includesService: boolean,
  serviceCharge: Rational,
): Rational {
  return includesService ? div(price, add(ONE, serviceCharge)) : price;
}

export function bandOf(foodCost: Rational, good: Rational, high: Rational): Band {
  if (le(foodCost, good)) return 'good';
  if (gt(foodCost, high)) return 'high';
  return 'watch';
}

export function priceItem(
  item: MenuItem,
  project: Project,
  recipeCosts: ReadonlyMap<string, RecipeCost>,
): MenuCost {
  const path = `menu.${item.id}`;
  const rc = recipeCosts.get(item.recipeId);
  const recipe = project.recipes.get(item.recipeId)!;
  if (!rc || !rc.ok)
    return { ok: false, error: { code: 'recipe-error', path, params: { recipe: recipe.name } } };
  const q = toBaseOf(
    item.portionQty,
    resolveUnit(item.portionUnit, project.measures),
    rc.yieldDim,
    { densityGPerMl: recipe.density },
    `${path}.portionQty`,
  );
  if (!q.ok) return { ok: false, error: q.error };
  const portionCost = mul(q.value, rc.perYieldBase);
  const sc = project.settings.serviceCharge;
  const netPrice = netOf(item.price, item.priceIncludesService, sc);
  const foodCost = isZero(netPrice) ? null : div(portionCost, netPrice);
  const grossProfit = isZero(netPrice) ? null : sub(netPrice, portionCost);
  const band =
    foodCost === null ? null : bandOf(foodCost, project.settings.good, project.settings.high);
  let suggestedPrice = ZERO;
  let suggestedFoodCost = ZERO;
  if (!isZero(portionCost)) {
    const netNeeded = div(portionCost, item.target);
    const listed = item.priceIncludesService ? mul(netNeeded, add(ONE, sc)) : netNeeded;
    suggestedPrice = roundPriceUp(listed, item.rounding);
    suggestedFoodCost = div(portionCost, netOf(suggestedPrice, item.priceIncludesService, sc));
  }
  return {
    ok: true,
    portionCost,
    netPrice,
    foodCost,
    grossProfit,
    band,
    suggestedPrice,
    suggestedFoodCost,
  };
}

export function priceMenu(
  project: Project,
  recipeCosts: ReadonlyMap<string, RecipeCost>,
): Map<string, MenuCost> {
  const out = new Map<string, MenuCost>();
  for (const item of project.menu.values()) out.set(item.id, priceItem(item, project, recipeCosts));
  return out;
}
