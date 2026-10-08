// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { projectArb } from '../../../test/oracle/random-project';
import {
  verifiedImpact,
  verifiedMaxYield,
  verifiedProject,
  verifyMenuItem,
  type VerifiedMenu,
} from '../src/api';
import type * as check from '../src/check/index';
import type { Checker } from '../src/check/index';
import { isValidSuggestion } from '../src/check/index';
import * as cost from '../src/cost/index';
import { costRecipes, priceMenu } from '../src/cost/index';
import {
  emptyProject,
  validateProject,
  type Project,
  type StoredMenuItem,
  type StoredProject,
} from '../src/model/index';
import {
  add,
  dec,
  div,
  eq,
  le,
  mul,
  rat,
  sub,
  toFraction,
  type PriceRounding,
  type Rational,
} from '../src/num/index';
import { sampleStored } from './helpers/fixtures';
import { cleanupMutants, loadMutant, occurrences, type Mutant } from './helpers/mutate';

afterAll(cleanupMutants);

const runs = Number(process.env.SAUCEPENNY_PROPERTY_RUNS ?? 1000);

function compile(p: StoredProject): Project {
  const r = validateProject(p);
  if (!r.ok) throw new Error(JSON.stringify(r.errors.slice(0, 3)));
  return r.value.project;
}

/** fraction text such as "11/40" or "3" → Rational */
const fr = (s: string): Rational => {
  const [n, d = '1'] = s.split('/');
  return div(dec(n!), dec(d));
};

/** A one-dish project: a portion costs exactly `cost` (one piece of a $cost ingredient). */
function dish(
  costText: string,
  price: string,
  includes: boolean,
  servicePercent: string,
  targetPercent: string,
  rounding: PriceRounding,
): StoredProject {
  const p = emptyProject('golden');
  p.settings.serviceChargePercent = servicePercent;
  p.ingredients = [{ id: 'i', name: 'x', packQty: '1', packUnit: 'piece', price: costText }];
  p.recipes = [
    {
      id: 'r',
      name: 'dish',
      yieldQty: '1',
      yieldUnit: 'portion',
      lines: [{ ref: { kind: 'ingredient', id: 'i' }, qty: '1', unit: 'piece' }],
    },
  ];
  p.menu = [
    {
      id: 'm',
      name: 'dish',
      recipeId: 'r',
      portionQty: '1',
      portionUnit: 'portion',
      price,
      priceIncludesService: includes,
      targetPercent,
      rounding,
    },
  ];
  return p;
}

// cost, price, price includes service?, service %, target %, rounding,
//   → net price, food cost (null = price is 0), suggested price, food cost at suggested price
// Every row was worked out by hand; see docs/calculation-rules.md rules 5–7.
type Row = [
  string,
  string,
  boolean,
  string,
  string,
  PriceRounding,
  string,
  string | null,
  string,
  string,
];
export const PRICING_GOLDEN: Row[] = [
  ['10', '40', false, '10', '30', '1', '40', '1/4', '34', '5/17'],
  ['10', '40', true, '10', '30', '1', '400/11', '11/40', '37', '11/37'],
  ['12', '48', false, '10', '30', 'ending-8', '48', '1/4', '48', '1/4'],
  ['12', '48', false, '10', '25', 'ending-8', '48', '1/4', '48', '1/4'],
  ['12.01', '48', false, '10', '25', 'ending-8', '48', '1201/4800', '58', '1201/5800'],
  ['9', '30', false, '10', '30', '0.5', '30', '3/10', '30', '3/10'],
  ['9.01', '30', false, '10', '30', '0.5', '30', '901/3000', '30.5', '901/3050'],
  ['7', '20', false, '10', '35', '0.1', '20', '7/20', '20', '7/20'],
  ['7', '20', false, '10', '33', '0.1', '20', '7/20', '21.3', '70/213'],
  ['7', '20', false, '10', '33', 'none', '20', '7/20', '21.22', '350/1061'],
  ['0', '20', false, '10', '30', '1', '20', '0', '0', '0'],
  ['0', '20', false, '10', '30', 'ending-8', '20', '0', '0', '0'],
  ['5', '0', false, '10', '30', '1', '0', null, '17', '5/17'],
  ['10', '10', false, '10', '100', '1', '10', '1', '10', '1'],
  ['10', '5', false, '10', '100', '1', '5', '2', '10', '1'],
  ['10', '44', true, '10', '25', '1', '40', '1/4', '44', '1/4'],
  ['10', '44', true, '0', '25', '1', '44', '5/22', '40', '1/4'],
  ['3.33', '10', false, '10', '33.3', 'none', '10', '333/1000', '10', '333/1000'],
  ['1', '3', false, '10', '30', 'none', '3', '1/3', '3.34', '50/167'],
  ['1', '3', false, '10', '30', '0.1', '3', '1/3', '3.4', '5/17'],
  ['1', '3', false, '10', '30', '0.5', '3', '1/3', '3.5', '2/7'],
  ['1', '3', false, '10', '30', '1', '3', '1/3', '4', '1/4'],
  ['1', '3', false, '10', '30', 'ending-8', '3', '1/3', '8', '1/8'],
  ['2.4', '8', false, '10', '30', 'ending-8', '8', '3/10', '8', '3/10'],
  ['2.41', '8', false, '10', '30', 'ending-8', '8', '241/800', '18', '241/1800'],
  ['30', '98', false, '10', '30', 'ending-8', '98', '15/49', '108', '5/18'],
  ['30', '108', true, '10', '30', 'ending-8', '1080/11', '11/36', '118', '33/118'],
  ['30', '110', true, '10', '30', '1', '100', '3/10', '110', '3/10'],
  ['0.01', '1', false, '10', '30', 'none', '1', '1/100', '0.04', '1/4'],
  ['0.01', '1', false, '10', '30', 'ending-8', '1', '1/100', '8', '1/800'],
  ['100', '300', true, '15', '30', '1', '6000/23', '23/60', '384', '115/384'],
  ['100', '300', true, '15', '30', '0.5', '6000/23', '23/60', '383.5', '230/767'],
  ['100', '300', true, '15', '30', 'none', '6000/23', '23/60', '383.34', '5750/19167'],
  ['100', '300', true, '15', '30', 'ending-8', '6000/23', '23/60', '388', '115/388'],
  ['4.5', '15', false, '10', '30', '0.5', '15', '3/10', '15', '3/10'],
  ['4.5', '15', true, '10', '30', '0.5', '150/11', '33/100', '16.5', '3/10'],
  ['4.5', '15', true, '10', '30', '1', '150/11', '33/100', '17', '99/340'],
  ['6', '20', false, '10', '0.5', 'none', '20', '3/10', '1200', '1/200'],
  ['6', '19.99', false, '10', '30', '0.1', '19.99', '600/1999', '20', '3/10'],
  ['6', '20.01', false, '10', '30', '1', '20.01', '600/2001', '20', '3/10'],
  ['0', '0', false, '10', '30', '1', '0', null, '0', '0'],
  ['2.5', '10', true, '10', '100', '1', '100/11', '11/40', '3', '11/12'],
  ['12', '50', false, '10', '30', '0.5', '50', '6/25', '40', '3/10'],
];

export function runPricingGolden(engine: typeof cost): string[] {
  const fails: string[] = [];
  const same = (name: string, got: Rational | null | undefined, want: Rational | null) => {
    const g = got === undefined ? 'missing' : got === null ? 'null' : toFraction(got);
    const w = want === null ? 'null' : toFraction(want);
    if (g !== w) fails.push(`${name}: ${g} != ${w}`);
  };
  for (const [i, row] of PRICING_GOLDEN.entries()) {
    const [c, price, inc, sc, target, rounding, net, fc, sug, actual] = row;
    try {
      const p = compile(dish(c, price, inc, sc, target, rounding));
      const m = engine.priceMenu(p, engine.costRecipes(p)).get('m')!;
      if (!m.ok) {
        fails.push(`row ${i}: error ${m.error.code}`);
        continue;
      }
      same(`row ${i} portion`, m.portionCost, dec(c));
      same(`row ${i} net`, m.netPrice, fr(net));
      same(`row ${i} food cost`, m.foodCost, fc === null ? null : fr(fc));
      same(`row ${i} gross profit`, m.grossProfit, fc === null ? null : sub(fr(net), dec(c)));
      same(`row ${i} suggested`, m.suggestedPrice, dec(sug));
      same(`row ${i} actual`, m.suggestedFoodCost, fr(actual));
    } catch (e) {
      fails.push(`row ${i} threw ${String(e)}`);
    }
  }
  // Bands at the default 30 / 35 boundaries.
  const bands: [string, string, string][] = [
    ['30', '100', 'good'],
    ['30.01', '100', 'watch'],
    ['35', '100', 'watch'],
    ['35.01', '100', 'high'],
    ['1', '0', 'none'],
  ];
  for (const [c, price, want] of bands) {
    const p = compile(dish(c, price, false, '10', '30', '1'));
    const m = engine.priceMenu(p, engine.costRecipes(p)).get('m')!;
    const got = m.ok ? (m.band ?? 'none') : 'error';
    if (got !== want) fails.push(`band ${c}/${price}: ${got} != ${want}`);
  }
  // A 250 ml portion of a 1 l syrup ($6 per litre) costs 1.5.
  const s = sampleStored();
  s.menu.push({
    ...s.menu[0]!,
    id: 'm3',
    recipeId: 'syrup',
    portionQty: '250',
    portionUnit: 'ml',
    price: '5',
  });
  const sp = compile(s);
  const m3 = engine.priceMenu(sp, engine.costRecipes(sp)).get('m3');
  same('250 ml syrup portion', m3 && m3.ok ? m3.portionCost : undefined, dec('1.5'));
  same('250 ml syrup food cost', m3 && m3.ok ? m3.foodCost : undefined, dec('0.3'));
  return fails;
}

describe('menu pricing: hand-worked golden table', () => {
  it(`has at least 40 rows`, () => expect(PRICING_GOLDEN.length).toBeGreaterThanOrEqual(40));
  it('engine matches every row, band and the ml portion', () => {
    expect(runPricingGolden(cost)).toEqual([]);
  });
  it('the verified API agrees on every row (checker recomputes independently)', () => {
    for (const row of PRICING_GOLDEN) {
      const p = compile(
        dish(...(row.slice(0, 6) as [string, string, boolean, string, string, PriceRounding])),
      );
      const v = verifiedProject(p).menu.get('m')!;
      expect(v.status, JSON.stringify(row)).toBe('ok');
    }
  });
  it('sample menu: 叉燒飯 and 凍檸茶 are verified', () => {
    const v = verifiedProject(compile(sampleStored()));
    expect([...v.menu.values()].map((m) => m.status)).toEqual(['ok', 'ok']);
    const m1 = v.menu.get('m1') as Extract<VerifiedMenu, { status: 'ok' }>;
    const charsiu = v.recipes.get('charsiu');
    if (charsiu?.status !== 'ok') throw new Error('charsiu');
    expect(eq(m1.portionCost, div(charsiu.total, rat(10n)))).toBe(true);
  });
});

describe('targets and errors', () => {
  const target = (t: string) => validateProject(dish('1', '10', false, '10', t, '1'));
  it('target 0% is rejected, 100% accepted, above 100% rejected', () => {
    expect(target('0').ok).toBe(false);
    expect(target('-1').ok).toBe(false);
    expect(target('100').ok).toBe(true);
    expect(target('100.01').ok).toBe(false);
    expect(target('0.01').ok).toBe(true);
  });
  it('a menu item of a recipe in a cycle is an error, never a number', () => {
    const s = sampleStored();
    s.recipes[0]!.lines.push({ ref: { kind: 'recipe', id: 'charsiu' }, qty: '1', unit: 'portion' });
    const v = verifiedProject(compile(s));
    for (const m of v.menu.values()) expect(m.status).toBe('error');
  });
  it('a portion in the wrong unit family is an explicit error', () => {
    const s = sampleStored();
    s.menu[0]!.portionUnit = 'ml';
    const v = verifiedProject(compile(s)).menu.get('m1')!;
    expect(v.status).toBe('error');
    if (v.status === 'error') expect(v.error.code).toBe('incompatible-units');
  });
});

// [suggested, raw, rule, acceptable?]
const SUGGESTION_GOLDEN: [string, string, PriceRounding, boolean][] = [
  ['34', '33.34', '1', true],
  ['35', '33.34', '1', false],
  ['33', '33.34', '1', false],
  ['33.5', '33.34', '1', false],
  ['33.5', '33.34', '0.5', true],
  ['34', '33.34', '0.5', false],
  ['33.4', '33.34', '0.1', true],
  ['33.5', '33.34', '0.1', false],
  ['33.34', '33.34', 'none', true],
  ['33.35', '33.34', 'none', false],
  ['38', '33.34', 'ending-8', true],
  ['48', '33.34', 'ending-8', false],
  ['37', '33.34', 'ending-8', false],
  ['0', '0', 'ending-8', true],
  ['8', '0', 'ending-8', false],
];

export function runSuggestionGolden(fn: typeof isValidSuggestion): string[] {
  return SUGGESTION_GOLDEN.filter(
    ([s, raw, rule, want]) => fn(dec(s), dec(raw), rule) !== want,
  ).map((r) => r.join(' '));
}

describe('the checker rejects wrong suggestions', () => {
  it('one step too high, off the grid, below the raw price, or not ending in 8', () => {
    expect(runSuggestionGolden(isValidSuggestion)).toEqual([]);
  });
});

// ---- Properties ------------------------------------------------------------------------

const money = fc
  .tuple(fc.integer({ min: 0, max: 2000 }), fc.integer({ min: 0, max: 99 }))
  .map(([a, b]) => `${a}.${String(b).padStart(2, '0')}`);
const percent = fc
  .tuple(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 9 }))
  .map(([a, b]) => `${a}.${b}`)
  .filter((s) => Number(s) > 0 && Number(s) <= 100);
const rounding = fc.constantFrom<PriceRounding>('none', '0.1', '0.5', '1', 'ending-8');

describe('pricing properties', () => {
  it(`suggested ≥ cost ÷ target (with service), real food cost ≤ target, verified (${runs} runs)`, () => {
    fc.assert(
      fc.property(
        money,
        money,
        fc.boolean(),
        fc.integer({ min: 0, max: 30 }).map(String),
        percent,
        rounding,
        (c, price, inc, sc, t, r) => {
          const p = compile(dish(c, price, inc, sc, t, r));
          const m = priceMenu(p, costRecipes(p)).get('m')!;
          if (!m.ok) return false;
          const item = p.menu.get('m')!;
          const withService = add(rat(1n), div(dec(sc), rat(100n)));
          const atTarget = div(m.portionCost, item.target);
          const want = inc ? mul(atTarget, withService) : atTarget;
          return (
            le(want, m.suggestedPrice) &&
            le(m.suggestedFoodCost, item.target) &&
            verifiedProject(p).menu.get('m')!.status === 'ok'
          );
        },
      ),
      { numRuns: runs },
    );
  });

  it(`random DAG projects with menu items: every item verified or an explicit error (${Math.ceil(runs / 4)} runs)`, () => {
    fc.assert(
      fc.property(
        projectArb({ maxRecipes: 6 }),
        fc.array(fc.tuple(fc.nat(), money, percent, rounding, fc.boolean()), {
          minLength: 1,
          maxLength: 6,
        }),
        (stored, items) => {
          stored.menu = items.map(([pick, price, t, r, inc], i): StoredMenuItem => {
            const recipe = stored.recipes[pick % stored.recipes.length]!;
            return {
              id: `m${i}`,
              name: `item ${i}`,
              recipeId: recipe.id,
              portionQty: '1',
              portionUnit: recipe.yieldUnit,
              price,
              priceIncludesService: inc,
              targetPercent: t,
              rounding: r,
            };
          });
          const v = verifiedProject(compile(stored));
          return [...v.menu.values()].every((m) => m.status !== 'mismatch');
        },
      ),
      { numRuns: Math.ceil(runs / 4) },
    );
  });
});

// ---- Price change impact ---------------------------------------------------------------

describe('price change impact', () => {
  const ids = (p: Project, ing: string, price: string) => {
    const v = verifiedImpact(p, ing, dec(price));
    if (v.status !== 'ok') throw new Error(v.detail);
    return v.rows.map((r) => `${r.kind}:${r.id}`).sort();
  };
  const p = compile(sampleStored());
  it('sugar reaches every recipe and dish through the 糖水 sub-recipe', () => {
    expect(ids(p, 'sugar', '15')).toEqual(
      ['menu:m1', 'menu:m2', 'recipe:charsiu', 'recipe:lemontea', 'recipe:syrup'].sort(),
    );
  });
  it('pork only changes 叉燒 and 叉燒飯; the same price changes nothing; unused egg changes nothing', () => {
    expect(ids(p, 'pork', '72')).toEqual(['menu:m1', 'recipe:charsiu']);
    expect(ids(p, 'pork', '68')).toEqual([]);
    expect(ids(p, 'egg', '99')).toEqual([]);
  });
  it('before, after and change are exact: pork 68 → 72 adds 2 × 4 ÷ 0.9 to 叉燒', () => {
    const v = verifiedImpact(p, 'pork', dec('72'));
    if (v.status !== 'ok') throw new Error(v.detail);
    const row = v.rows.find((r) => r.id === 'charsiu')!;
    expect(toFraction(row.change)).toBe(toFraction(rat(80n, 9n)));
    expect(toFraction(sub(row.after, row.before))).toBe(toFraction(row.change));
    const dishRow = v.rows.find((r) => r.id === 'm1')!;
    expect(toFraction(dishRow.change)).toBe(toFraction(rat(8n, 9n)));
  });
  it(`impact list = the set where the checker's before/after differ (${Math.ceil(runs / 4)} random projects)`, () => {
    fc.assert(
      fc.property(projectArb({ maxRecipes: 6 }), fc.nat(), money, (stored, pick, price) => {
        stored.menu = stored.recipes.map((r, i) => ({
          id: `m${i}`,
          name: r.name,
          recipeId: r.id,
          portionQty: '1',
          portionUnit: r.yieldUnit,
          price: '10',
          priceIncludesService: false,
          targetPercent: '30',
          rounding: 'none' as const,
        }));
        const proj = compile(stored);
        const ing = stored.ingredients[pick % stored.ingredients.length]!.id;
        return verifiedImpact(proj, ing, dec(price)).status === 'ok';
      }),
      { numRuns: Math.ceil(runs / 4) },
    );
  });
});

// ---- Scaling -----------------------------------------------------------------------------

describe('scaling', () => {
  const p = compile(sampleStored());
  it('a batch of 25 portions of 叉燒 scales every line by 2.5', () => {
    expect(cost.scaledLines(p, 'charsiu', dec('25')).map(toFraction)).toEqual(['5', '15/2', '500']);
  });
  it('3 catties of pork make 15 portions of 叉燒', () => {
    // The 90% usable yield is already in the pork's price; line waste is 0, so
    // 2 catties per 10 portions → 3 catties make 15 portions.
    const v = verifiedMaxYield(p, 'charsiu', 'pork', dec('3'), 'catty');
    expect(v.status).toBe('ok');
    if (v.status === 'ok') expect(toFraction(v.yieldUnits!)).toBe('15');
  });
  it('500 g of sugar makes 1 l of 糖水; 1 kg makes 200/3 凍檸茶 through the sub-recipe', () => {
    const syrup = verifiedMaxYield(p, 'syrup', 'sugar', dec('500'), 'g');
    expect(syrup.status === 'ok' && toFraction(syrup.yieldUnits!)).toBe('1');
    // 凍檸茶 uses 30 ml syrup = 15 g sugar per portion → 1 kg makes 200/3 portions.
    const tea = verifiedMaxYield(p, 'lemontea', 'sugar', dec('1'), 'kg');
    expect(tea.status === 'ok' && toFraction(tea.yieldUnits!)).toBe('200/3');
  });
  it('line waste counts: 1 lb of tea leaves at 2 taels + 5% waste each', () => {
    const v = verifiedMaxYield(p, 'lemontea', 'tea', dec('1'), 'lb');
    const want = div(mul(dec('453.59237'), dec('0.95')), mul(rat(2n), dec('37.79936375')));
    expect(v.status === 'ok' && toFraction(v.yieldUnits!)).toBe(toFraction(want));
  });
  it('an ingredient the recipe does not use gives "not used", not infinity', () => {
    const v = verifiedMaxYield(p, 'charsiu', 'egg', dec('10'), 'piece');
    expect(v).toEqual({ status: 'ok', yieldUnits: null });
  });
  it(`random projects: engine requirement = checker pack expansion (${Math.ceil(runs / 4)} runs)`, () => {
    fc.assert(
      fc.property(projectArb({ maxRecipes: 6 }), fc.nat(), fc.nat(), (stored, ri, ii) => {
        const proj = compile(stored);
        const recipe = stored.recipes[ri % stored.recipes.length]!.id;
        const ing = stored.ingredients[ii % stored.ingredients.length]!;
        const v = verifiedMaxYield(proj, recipe, ing.id, dec('7.5'), ing.packUnit);
        return v.status !== 'mismatch';
      }),
      { numRuns: Math.ceil(runs / 4) },
    );
  });
});

// ---- Mutation testing --------------------------------------------------------------------

const PRICING_MUTANTS: Mutant[] = [
  {
    name: 'net price ignores the service charge',
    file: 'cost/pricing.ts',
    from: 'return includesService ? div(price, add(ONE, serviceCharge)) : price;',
    to: 'return includesService ? price : price;',
  },
  {
    name: 'net price multiplies instead of divides',
    file: 'cost/pricing.ts',
    from: 'return includesService ? div(price, add(ONE, serviceCharge)) : price;',
    to: 'return includesService ? mul(price, add(ONE, serviceCharge)) : price;',
  },
  {
    name: 'suggested price forgets to add the service charge back',
    file: 'cost/pricing.ts',
    from: 'const listed = item.priceIncludesService ? mul(netNeeded, add(ONE, sc)) : netNeeded;',
    to: 'const listed = netNeeded;',
  },
  {
    name: 'suggested price ignores the rounding rule',
    file: 'cost/pricing.ts',
    from: 'suggestedPrice = roundPriceUp(listed, item.rounding);',
    to: "suggestedPrice = roundPriceUp(listed, 'none');",
  },
  {
    name: 'real food cost uses the listed price instead of the net price',
    file: 'cost/pricing.ts',
    from: 'suggestedFoodCost = div(portionCost, netOf(suggestedPrice, item.priceIncludesService, sc));',
    to: 'suggestedFoodCost = div(portionCost, suggestedPrice);',
  },
  {
    name: 'food cost uses the listed price',
    file: 'cost/pricing.ts',
    from: 'const foodCost = isZero(netPrice) ? null : div(portionCost, netPrice);',
    to: 'const foodCost = isZero(netPrice) ? null : div(portionCost, item.price);',
  },
  {
    name: 'gross profit sign flipped',
    file: 'cost/pricing.ts',
    from: 'const grossProfit = isZero(netPrice) ? null : sub(netPrice, portionCost);',
    to: 'const grossProfit = isZero(netPrice) ? null : sub(portionCost, netPrice);',
  },
  {
    name: 'zero cost is rounded up to a price',
    file: 'cost/pricing.ts',
    from: 'if (!isZero(portionCost)) {',
    to: 'if (portionCost) {',
  },
  {
    name: 'good band excludes its boundary',
    file: 'cost/pricing.ts',
    from: "if (le(foodCost, good)) return 'good';",
    to: "if (gt(good, foodCost)) return 'good';",
  },
  {
    name: 'high band includes its boundary',
    file: 'cost/pricing.ts',
    from: "if (gt(foodCost, high)) return 'high';",
    to: "if (le(high, foodCost)) return 'high';",
  },
  {
    name: 'portion size ignored',
    file: 'cost/pricing.ts',
    from: 'const portionCost = mul(q.value, rc.perYieldBase);',
    to: 'const portionCost = rc.perYieldBase; void q;',
  },
];

describe('pricing mutation testing', () => {
  it('has at least 10 mutants, each applying exactly once', () => {
    expect(PRICING_MUTANTS.length).toBeGreaterThanOrEqual(10);
    for (const m of PRICING_MUTANTS) expect(occurrences(m), m.name).toBe(1);
  });
  for (const m of PRICING_MUTANTS)
    it(`catches mutant: ${m.name}`, async () => {
      const mod = await loadMutant<typeof cost>(m);
      expect(runPricingGolden(mod).length, `mutant "${m.name}" survived`).toBeGreaterThan(0);
    });
});

const IMPACT_MUTANTS: Mutant[] = [
  {
    name: 'impact skips menu items',
    file: 'cost/impact.ts',
    from: "kind: 'menu',",
    to: "kind: 'recipe',",
  },
  {
    name: 'impact only looks at direct use (stale sub-recipe costs)',
    file: 'cost/impact.ts',
    from: 'const ra = costRecipes(after);',
    to: 'const ra = new Map([...costRecipes(after)].map(([k, v]) => [k, project.recipes.get(k)!.lines.some((l) => l.ref.kind === "ingredient" && l.ref.id === ingredientId) ? v : rb.get(k)!]));',
  },
];

describe('impact mutation testing (the verified API must refuse the result)', () => {
  for (const m of IMPACT_MUTANTS)
    it(`catches mutant: ${m.name}`, async () => {
      expect(occurrences(m)).toBe(1);
      const mod = await loadMutant<typeof cost>(m);
      const p = compile(sampleStored());
      const rows = mod.priceImpact(p, 'sugar', dec('15'));
      const good = verifiedImpact(p, 'sugar', dec('15'));
      if (good.status !== 'ok') throw new Error('baseline');
      const key = (r: cost.ImpactRow) => `${r.kind}:${r.id}:${toFraction(r.after)}`;
      expect(rows.map(key).sort()).not.toEqual(good.rows.map(key).sort());
    });
});

const MENU_CHECKER_MUTANTS: Mutant[] = [
  {
    name: 'checker net price ignores service',
    file: 'check/index.ts',
    from: 'return includes ? mul(price, div(rat(1n), add(rat(1n), serviceCharge))) : price;',
    to: 'return price;',
  },
  {
    name: 'checker raw suggestion forgets service',
    file: 'check/index.ts',
    from: 'const rawSuggested = item.priceIncludesService',
    to: 'const rawSuggested = false',
  },
  {
    name: 'checker band thresholds swapped',
    file: 'check/index.ts',
    from: "if (cmp(portionCost, mul(project.settings.good, netPrice)) <= 0) band = 'good';",
    to: "if (cmp(portionCost, mul(project.settings.high, netPrice)) <= 0) band = 'good';",
  },
  {
    name: 'checker accepts a price one step too high',
    file: 'check/index.ts',
    from: 'return cmp(sub(s, step), raw) < 0;',
    to: 'return cmp(sub(sub(s, step), step), raw) < 0;',
  },
];

describe('menu checker mutation testing', () => {
  for (const m of MENU_CHECKER_MUTANTS)
    it(`a broken checker is noticed: ${m.name}`, async () => {
      expect(occurrences(m)).toBe(1);
      const mod = await loadMutant<typeof check>(m);
      const statuses: string[] = [];
      for (const row of PRICING_GOLDEN) {
        const p = compile(
          dish(...(row.slice(0, 6) as [string, string, boolean, string, string, PriceRounding])),
        );
        const engine = priceMenu(p, costRecipes(p)).get('m')!;
        const checker = new mod.Checker(p) as unknown as Checker;
        statuses.push(
          verifyMenuItem(p, 'm', engine, checker, {
            recomputeMenu: mod.recomputeMenu as unknown as typeof check.recomputeMenu,
            isValidSuggestion: mod.isValidSuggestion,
            netPriceOf: mod.netPriceOf,
          }).status,
        );
      }
      // A permissive checker cannot produce a mismatch on correct numbers, so it must fail
      // the suggestion table instead.
      const noticed =
        statuses.includes('mismatch') || runSuggestionGolden(mod.isValidSuggestion).length > 0;
      expect(noticed).toBe(true);
    });
});

describe('ingredient unit cost (per kg, per litre, per piece), verified', () => {
  it('pork 68 per catty at 90% → per kg; tea 80 per lb; egg per piece; soy per litre', async () => {
    const { verifiedIngredientCosts } = await import('../src/api');
    const v = verifiedIngredientCosts(compile(sampleStored()));
    const get = (id: string) => {
      const x = v.get(id)!;
      if (x.status !== 'ok') throw new Error(id);
      return [x.unit, toFraction(x.cost)];
    };
    expect(get('pork')).toEqual([
      'kg',
      toFraction(div(rat(68000n), mul(dec('604.78982'), dec('0.9')))),
    ]);
    expect(get('tea')).toEqual(['kg', toFraction(div(rat(80000n), dec('453.59237')))]);
    expect(get('egg')).toEqual(['piece', '3/2']);
    expect(get('soy')).toEqual(['l', '30']);
  });
});

describe('verifying a subset (fast UI updates) gives the same results as verifying everything', () => {
  it('on the sample and on random projects', () => {
    fc.assert(
      fc.property(projectArb({ maxRecipes: 6 }), fc.nat(), (stored, pick) => {
        const p = compile(stored);
        const ids = [...p.recipes.keys()];
        const one = ids[pick % ids.length]!;
        const full = verifiedProject(p);
        const part = verifiedProject(p, { recipes: [one] });
        return (
          part.recipes.size === 1 &&
          JSON.stringify(part.recipes.get(one), (_k, v: unknown) =>
            typeof v === 'bigint' ? v.toString() : v,
          ) ===
            JSON.stringify(full.recipes.get(one), (_k, v: unknown) =>
              typeof v === 'bigint' ? v.toString() : v,
            )
        );
      }),
      { numRuns: Math.ceil(runs / 4) },
    );
    const p = compile(sampleStored());
    const part = verifiedProject(p, { menu: ['m2'] });
    expect(part.recipes.size).toBe(0);
    expect(part.menu.get('m2')!.status).toBe('ok');
  });
});
