// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A large invented project for the performance benchmark: N ingredients, M recipes (each
// with up to 8 lines, some using earlier recipes, nesting kept below the limit), K menu
// items. Deterministic (no randomness) so timings are comparable run to run.
import type { StoredProject } from '../../packages/core/src/model/index';

export function bigProject(nIng = 1000, nRec = 500, nMenu = 300): StoredProject {
  const units = ['g', 'kg', 'catty', 'tael', 'lb', 'ml', 'l', 'piece'] as const;
  const p: StoredProject = {
    schema: 'saucepenny/project',
    version: 2,
    name: 'benchmark',
    settings: {
      currency: 'HKD',
      serviceChargePercent: '10',
      goodPercent: '30',
      highPercent: '35',
    },
    measures: [],
    ingredients: [],
    recipes: [],
    menu: [],
  } as unknown as StoredProject;
  for (let i = 0; i < nIng; i++)
    p.ingredients.push({
      id: `i${i}`,
      name: `食材 ${i}`,
      packQty: String(1 + (i % 7)),
      packUnit: units[i % units.length]!,
      price: `${10 + (i % 90)}.${String(i % 100).padStart(2, '0')}`,
      yieldPercent: String(60 + (i % 41)),
      density: '1.05',
      pieceWeight: '50',
    });
  for (let r = 0; r < nRec; r++) {
    const lines: StoredProject['recipes'][number]['lines'] = [];
    for (let j = 0; j < 8; j++) {
      const useRecipe = r > 0 && j % 4 === 3;
      if (useRecipe) {
        // a recent earlier recipe, keeping nesting depth bounded
        const child = r - 1 - ((r * 7 + j) % Math.min(r, 15));
        if (Math.floor(child / 25) === Math.floor(r / 25) || child < r - 25) {
          lines.push({ ref: { kind: 'recipe', id: `r${child}` }, qty: '100', unit: 'g' });
          continue;
        }
      }
      const ing = (r * 13 + j * 101) % nIng;
      lines.push({
        ref: { kind: 'ingredient', id: `i${ing}` },
        qty: `${1 + ((r + j) % 300)}`,
        unit: (['g', 'ml', 'piece', 'tael'] as const)[(r + j) % 4]!,
        wastePercent: String((r + j) % 10),
      });
    }
    p.recipes.push({
      id: `r${r}`,
      name: `食譜 ${r}`,
      yieldQty: '1',
      yieldUnit: 'kg',
      lines,
    });
  }
  for (let m = 0; m < nMenu; m++)
    p.menu.push({
      id: `m${m}`,
      name: `菜式 ${m}`,
      recipeId: `r${(m * 3) % nRec}`,
      portionQty: '250',
      portionUnit: 'g',
      price: String(30 + (m % 70)),
      priceIncludesService: m % 2 === 0,
      targetPercent: '30',
      rounding: 'ending-8',
    });
  return p;
}
