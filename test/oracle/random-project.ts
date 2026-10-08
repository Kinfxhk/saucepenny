// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Random valid projects for property tests: ingredients in every unit family (each with a
// density and a weight per piece, so every conversion is possible), recipes that use
// earlier recipes only (a DAG, with many diamonds), nesting depth capped.
import fc from 'fast-check';
import type { StoredProject, UnitRef } from '../../packages/core/src/model/index';
import type { UnitId } from '../../packages/core/src/units/index';

const MASS: UnitId[] = ['mg', 'g', 'kg', 'oz', 'lb', 'catty', 'tael'];
const VOLUME: UnitId[] = ['ml', 'l', 'tsp', 'tbsp', 'cup', 'floz'];
const ANY: UnitId[] = [...MASS, ...VOLUME, 'piece'];

const decimal = (maxInt: number, maxDp: number, min = 0) =>
  fc
    .tuple(fc.integer({ min, max: maxInt }), fc.integer({ min: 0, max: 10 ** maxDp - 1 }))
    .map(([i, f]) => (maxDp ? `${i}.${String(f).padStart(maxDp, '0')}` : `${i}`))
    .filter((s) => Number(s) > 0 || min === 0);

export interface RandomOptions {
  maxIngredients?: number;
  maxRecipes?: number;
  maxDepth?: number;
  maxLines?: number;
}

export function projectArb(opts: RandomOptions = {}): fc.Arbitrary<StoredProject> {
  const { maxIngredients = 6, maxRecipes = 8, maxDepth = 20, maxLines = 5 } = opts;
  return fc
    .record({
      ings: fc.array(
        fc.record({
          unit: fc.constantFrom(...ANY),
          packQty: decimal(50, 2, 1),
          price: decimal(500, 2),
          yieldPercent: fc.integer({ min: 1, max: 100 }).map(String),
          density: decimal(3, 3, 1),
          pieceWeight: decimal(300, 1, 1),
        }),
        { minLength: 1, maxLength: maxIngredients },
      ),
      recipes: fc.array(
        fc.record({
          yieldKind: fc.constantFrom('portion', 'mass', 'volume', 'piece'),
          yieldUnitPick: fc.nat(),
          yieldQty: decimal(40, 2, 1),
          density: decimal(3, 3, 1),
          lines: fc.array(
            fc.record({
              pick: fc.nat(),
              useRecipe: fc.boolean(),
              qty: decimal(30, 3),
              unitPick: fc.nat(),
              waste: fc.integer({ min: 0, max: 60 }).map(String),
            }),
            { maxLength: maxLines },
          ),
        }),
        { minLength: 1, maxLength: maxRecipes },
      ),
    })
    .map(({ ings, recipes }) => {
      const depth: number[] = [];
      const yieldKinds: string[] = [];
      const p: StoredProject = {
        schema: 'saucepenny/project',
        version: 2,
        name: 'Random',
        settings: {
          currency: 'HKD',
          serviceChargePercent: '10',
          goodPercent: '30',
          highPercent: '35',
        },
        measures: [],
        ingredients: ings.map((g, i) => ({
          id: `i${i}`,
          name: `Ingredient ${i}`,
          packQty: g.packQty,
          packUnit: g.unit,
          price: g.price,
          yieldPercent: g.yieldPercent,
          density: g.density,
          pieceWeight: g.pieceWeight,
        })),
        recipes: [],
        menu: [],
      };
      recipes.forEach((r, ri) => {
        let d = 0;
        const lines = r.lines.map((l) => {
          const candidates = [...Array(ri).keys()].filter((j) => depth[j]! < maxDepth);
          if (l.useRecipe && candidates.length) {
            const j = candidates[l.pick % candidates.length]!;
            d = Math.max(d, depth[j]! + 1);
            const k = yieldKinds[j]!;
            const unit: UnitRef =
              k === 'portion'
                ? 'portion'
                : k === 'piece'
                  ? 'piece'
                  : [...MASS, ...VOLUME][l.unitPick % (MASS.length + VOLUME.length)]!;
            return {
              ref: { kind: 'recipe' as const, id: `r${j}` },
              qty: l.qty,
              unit,
              wastePercent: l.waste,
            };
          }
          const i = l.pick % ings.length;
          return {
            ref: { kind: 'ingredient' as const, id: `i${i}` },
            qty: l.qty,
            unit: ANY[l.unitPick % ANY.length]!,
            wastePercent: l.waste,
          };
        });
        depth.push(d);
        yieldKinds.push(r.yieldKind);
        const yieldUnit: UnitRef =
          r.yieldKind === 'portion'
            ? 'portion'
            : r.yieldKind === 'piece'
              ? 'piece'
              : r.yieldKind === 'mass'
                ? MASS[r.yieldUnitPick % MASS.length]!
                : VOLUME[r.yieldUnitPick % VOLUME.length]!;
        p.recipes.push({
          id: `r${ri}`,
          name: `Recipe ${ri}`,
          yieldQty: r.yieldQty,
          yieldUnit,
          density: r.density,
          lines,
        });
      });
      return p;
    });
}
