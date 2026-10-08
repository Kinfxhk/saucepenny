// SPDX-License-Identifier: AGPL-3.0-or-later
// v0.2 features: fractions, labour/overhead, ingredient weight, price history, duplicate
// recipe, custom measures in use, version 1 → 2. Every new number is checked against
// hand-worked values, and each piece of new logic has mutants that must be caught.
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { projectArb } from '../../../test/oracle/random-project';
import {
  verifiedPriceChange,
  verifiedRecipes,
  verifiedWeight,
  verifyRecipe,
  type VerifiedRecipe,
} from '../src/api';
import * as api from '../src/api';
import * as check from '../src/check/index';
import * as cost from '../src/cost/index';
import { importIngredientsCsv, textReport } from '../src/io/index';
import {
  duplicateRecipe,
  LIMITS,
  measureUses,
  readProjectJson,
  recordPriceChange,
  validateProject,
  type Project,
  type StoredIngredient,
  type StoredProject,
} from '../src/model/index';
import * as modelNs from '../src/model/index';
import * as num from '../src/num/index';
import {
  add,
  dec,
  div,
  eq,
  mul,
  parseDecimal,
  parseQuantity,
  rat,
  type Rational,
} from '../src/num/index';
import { clone, sampleStored } from './helpers/fixtures';
import { cleanupMutants, loadMutant, occurrences, type Mutant } from './helpers/mutate';

afterAll(cleanupMutants);

function compile(p: StoredProject): Project {
  const r = validateProject(p);
  if (!r.ok) throw new Error(JSON.stringify(r.errors.slice(0, 3)));
  return r.value.project;
}
const ok = (v: VerifiedRecipe | undefined) => {
  if (!v || v.status !== 'ok') throw new Error(`not ok: ${JSON.stringify(v)}`);
  return v;
};
const codes = (r: { ok: boolean; errors?: { code: string; path: string }[] }) =>
  r.ok ? [] : r.errors!.map((e) => `${e.code}@${e.path}`);

// ---------------------------------------------------------------------------------------
// Fractions
// ---------------------------------------------------------------------------------------
const QTY_GOLDEN: [string, string][] = [
  // input → "n/d" or error code
  ['1/2', '1/2'],
  ['3/4', '3/4'],
  ['2/4', '1/2'],
  ['5/2', '5/2'], // improper on its own is fine (= 2.5)
  ['1 1/2', '3/2'],
  ['2 3/4', '11/4'],
  ['1½', '3/2'],
  ['1 ½', '3/2'],
  ['½', '1/2'],
  ['⅓', '1/3'],
  ['⅔', '2/3'],
  ['¼', '1/4'],
  ['¾', '3/4'],
  ['⅛', '1/8'],
  ['⅞', '7/8'],
  ['12½', '25/2'],
  ['１／２', '1/2'],
  ['１　１／２', '3/2'],
  ['1⁄2', '1/2'],
  ['  3/8  ', '3/8'],
  ['0/5', '0/1'],
  ['1.5', '3/2'],
  ['1,250', '1250/1'],
  ['007', '7/1'],
  // rejected
  ['1/0', 'zero-denominator'],
  ['0/0', 'zero-denominator'],
  ['1 3/2', 'bad-fraction'],
  ['1 2/2', 'bad-fraction'],
  ['1 0/0', 'zero-denominator'],
  ['-1/2', 'bad-fraction'],
  ['+1/2', 'bad-fraction'],
  ['1/2/3', 'bad-fraction'],
  ['1.5/2', 'bad-fraction'],
  ['1/2.5', 'bad-fraction'],
  ['1,000/3', 'bad-fraction'],
  ['/2', 'bad-fraction'],
  ['1/', 'bad-fraction'],
  ['1 /2', 'bad-fraction'],
  ['1 1 1/2', 'bad-fraction'],
  ['½½', 'bad-fraction'],
  ['1 ½ ½', 'bad-fraction'],
  ['a/b', 'bad-fraction'],
  ['1234567890123456/1', 'too-many-digits'],
  ['', 'empty'],
  ['1e3', 'exponent'],
  ['1 2', 'not-a-number'],
];

function runQtyGolden(parse: typeof parseQuantity): string[] {
  const fails: string[] = [];
  for (const [input, want] of QTY_GOLDEN) {
    let got: string;
    try {
      const r = parse(input);
      got = r.ok ? `${r.value.n}/${r.value.d}` : r.error;
    } catch (e) {
      got = `threw ${String(e)}`;
    }
    if (got !== want) fails.push(`${JSON.stringify(input)}: ${got} != ${want}`);
  }
  return fails;
}

const FW = (s: string) =>
  s.replace(/[0-9]/g, (d) => String.fromCharCode(0xff10 + Number(d))).replace(/\//g, '／');

describe('fraction input', () => {
  it('golden table', () => {
    expect(runQtyGolden(parseQuantity)).toEqual([]);
  });

  it('property: a/b is exactly a ÷ b, in ASCII, full-width and with the fraction slash', () => {
    fc.assert(
      fc.property(fc.bigInt(0n, 10n ** 12n), fc.bigInt(1n, 10n ** 12n), (a, b) => {
        const want = rat(a, b);
        for (const text of [`${a}/${b}`, FW(`${a}/${b}`), `${a}⁄${b}`, ` ${a}/${b}\u3000`]) {
          const r = parseQuantity(text);
          if (!r.ok || !eq(r.value, want)) return false;
        }
        return true;
      }),
      { numRuns: 2000 },
    );
  });

  it('property: a mixed number w n/d (n < d) is w + n/d; n ≥ d is refused', () => {
    fc.assert(
      fc.property(
        fc.bigInt(0n, 10n ** 9n),
        fc.bigInt(1n, 10n ** 6n),
        fc.bigInt(0n, 10n ** 6n),
        (w, d, n0) => {
          const n = n0 % d;
          const r = parseQuantity(`${w} ${n}/${d}`);
          const improper = parseQuantity(`${w} ${n + d}/${d}`);
          return r.ok && eq(r.value, add(rat(w), rat(n, d))) && !improper.ok;
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('property: every vulgar fraction character, alone and after a whole number', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.entries(num.VULGAR_FRACTIONS)),
        fc.bigInt(0n, 10n ** 9n),
        ([ch, [n, d]], w) => {
          const alone = parseQuantity(ch);
          const mixed = parseQuantity(`${w}${ch}`);
          const spaced = parseQuantity(`${w} ${ch}`);
          const want = add(rat(w), rat(n, d));
          return (
            alone.ok &&
            eq(alone.value, rat(n, d)) &&
            mixed.ok &&
            eq(mixed.value, want) &&
            spaced.ok &&
            eq(spaced.value, want)
          );
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('property: everything parseDecimal accepts, parseQuantity reads the same', () => {
    const decimalText = fc.oneof(
      fc.bigInt(0n, 10n ** 14n).map(String),
      fc.tuple(fc.bigInt(0n, 10n ** 7n), fc.bigInt(0n, 10n ** 7n)).map(([a, b]) => `${a}.${b}`),
      fc.string({ maxLength: 8 }),
    );
    fc.assert(
      fc.property(decimalText, (text) => {
        const d = parseDecimal(text);
        if (!d.ok || text.includes('/')) return true;
        const q = parseQuantity(text);
        return q.ok && eq(q.value, d.value);
      }),
      { numRuns: 3000 },
    );
  });

  it('property: never throws and never returns a negative or non-finite value', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (text) => {
        const r = parseQuantity(text);
        if (!r.ok) return true;
        return (
          r.value.d > 0n && (text.includes('-') || text.includes('－') ? true : r.value.n >= 0n)
        );
      }),
      { numRuns: 3000 },
    );
  });

  it('quantity fields accept fractions; money and percent fields do not', () => {
    const s = sampleStored();
    s.ingredients[0]!.packQty = '1 1/2';
    s.recipes[1]!.lines[0]!.qty = '1½';
    s.recipes[1]!.yieldQty = '１０';
    s.menu[0]!.portionQty = '1/2';
    s.measures = [{ id: 'bowl', name: '碗', amount: '1/3', unit: 'l' }];
    const r = validateProject(s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(eq(r.value.project.ingredients.get('pork')!.packQty, rat(3n, 2n))).toBe(true);
    expect(eq(r.value.project.measures.get('bowl')!.amount, rat(1n, 3n))).toBe(true);
    expect(r.value.stored.ingredients[0]!.packQty).toBe('1 1/2'); // kept as typed
    const bad = sampleStored();
    bad.ingredients[0]!.price = '1/2';
    bad.recipes[1]!.lines[0]!.wastePercent = '1/2';
    bad.recipes[1]!.lines[1]!.qty = '1/0';
    expect(codes(validateProject(bad))).toEqual([
      'not-a-number@ingredients[0].price',
      'not-a-number@recipes[1].lines[0].wastePercent',
      'zero-denominator@recipes[1].lines[1].qty',
    ]);
  });

  it('costs computed from 1 1/2 equal costs computed from 1.5', () => {
    const a = sampleStored();
    const b = sampleStored();
    a.recipes[1]!.lines[0]!.qty = '1 1/2';
    b.recipes[1]!.lines[0]!.qty = '1.5';
    const va = ok(verifiedRecipes(compile(a)).get('charsiu'));
    const vb = ok(verifiedRecipes(compile(b)).get('charsiu'));
    expect(eq(va.total, vb.total)).toBe(true);
  });

  it('ingredient CSV import accepts a fraction pack size', () => {
    const r = importIngredientsCsv('name,packQty,packUnit,price\n牛油,1/2,lb,30\n', new Set());
    expect(r.problems).toEqual([]);
    expect(r.ingredients[0]!.packQty).toBe('1/2');
  });
});

const QTY_MUTANTS: Mutant[] = [
  {
    name: 'mixed number not required to be proper',
    file: 'num/quantity.ts',
    from: 'if (num >= den) return',
    to: 'if (num > den * 1000n) return',
  },
  {
    name: 'zero denominator not refused',
    file: 'num/quantity.ts',
    from: "if (den === 0n) return { ok: false, error: 'zero-denominator' };",
    to: 'if (den === 0n) return { ok: true, value: rat(0n) };',
  },
  {
    name: 'numerator and denominator swapped',
    file: 'num/quantity.ts',
    from: 'if (wholeText === undefined) return { ok: true, value: rat(num, den) };',
    to: 'if (wholeText === undefined) return { ok: true, value: num === 0n ? rat(0n) : rat(den, num) };',
  },
  {
    name: 'whole part subtracted',
    file: 'num/quantity.ts',
    from: 'return { ok: true, value: add(rat(BigInt(wholeText)), rat(num, den)) };',
    to: 'return { ok: true, value: add(rat(BigInt(wholeText)), rat(-num, den)) };',
  },
  {
    name: 'two thirds read as one third',
    file: 'num/quantity.ts',
    from: "'⅔': [2, 3],",
    to: "'⅔': [1, 3],",
  },
  {
    name: 'full-width slash not folded',
    file: 'num/quantity.ts',
    from: ".replace(/[／⁄]/gu, '/')",
    to: ".replace(/[⁄]/gu, '/')",
  },
  {
    name: 'whole number glued to a vulgar fraction',
    file: 'num/quantity.ts',
    from: "return `${whole}${whole ? ' ' : ''}${n}/${d}`;",
    to: 'return `${whole}${n}/${d}`;',
  },
  {
    name: 'digit limit not applied to fractions',
    file: 'num/quantity.ts',
    from: "    return { ok: false, error: 'too-many-digits' };",
    to: '    void 0;',
  },
];

describe('fraction mutants are caught', () => {
  for (const m of QTY_MUTANTS)
    it(m.name, async () => {
      expect(occurrences(m), `mutant "${m.name}" must apply once`).toBe(1);
      const mod = await loadMutant<typeof num>(m);
      expect(runQtyGolden(mod.parseQuantity).length, `mutant "${m.name}" survived`).toBeGreaterThan(
        0,
      );
    });
});

// ---------------------------------------------------------------------------------------
// Labour and overhead
// ---------------------------------------------------------------------------------------
const PORK = rat(1360n, 9n);
const SOY = dec('1.3308088303125');
const CHARSIU_FOOD = add(add(PORK, SOY), dec('1.2'));

function withExtras(): StoredProject {
  const s = sampleStored();
  Object.assign(s.recipes[1]!, {
    labourMinutes: '45',
    labourRate: '72',
    overheadFixed: '5.5',
    overheadPercent: '12.5',
  });
  return s;
}
// labour = 45/60 × 72 = 54; overhead = 5.5 + 12.5% × food; full = food × 1.125 + 59.5
const LABOUR = rat(54n);
const OVERHEAD = add(dec('5.5'), mul(CHARSIU_FOOD, dec('0.125')));
const FULL = add(mul(CHARSIU_FOOD, dec('1.125')), dec('59.5'));

function runExtrasGolden(engine: typeof cost): string[] {
  const fails: string[] = [];
  const p = compile(withExtras());
  const r = p.recipes.get('charsiu')!;
  let e: cost.ExtrasCost;
  try {
    e = engine.recipeExtras(r, CHARSIU_FOOD);
  } catch (err) {
    return [`threw ${String(err)}`];
  }
  if (!eq(e.labour, LABOUR)) fails.push('labour');
  if (!eq(e.overhead, OVERHEAD)) fails.push('overhead');
  if (!eq(e.full, FULL)) fails.push('full');
  if (!engine.hasExtras(r)) fails.push('hasExtras');
  if (engine.hasExtras(p.recipes.get('syrup')!)) fails.push('hasExtras on plain recipe');
  return fails;
}

describe('labour and overhead', () => {
  it('golden values', () => {
    expect(runExtrasGolden(cost)).toEqual([]);
    const v = ok(verifiedRecipes(compile(withExtras())).get('charsiu'));
    expect(eq(v.total, CHARSIU_FOOD)).toBe(true); // food cost unchanged
    expect(v.extras).not.toBeNull();
    expect(eq(v.extras!.full, FULL)).toBe(true);
    expect(eq(v.extras!.fullPerYieldUnit, div(FULL, rat(10n)))).toBe(true);
    expect(ok(verifiedRecipes(compile(withExtras())).get('syrup')).extras).toBeNull();
  });

  it('food cost % on the menu does not include labour or overhead', () => {
    const plain = textReport(compile(sampleStored()), 'en');
    const extra = textReport(compile(withExtras()), 'en');
    const menuPart = (t: string) => t.slice(t.indexOf('== Menu =='));
    expect(menuPart(extra)).toBe(menuPart(plain));
    expect(extra).toMatch(/labour 54\.00 · overhead/);
  });

  it('a sub-recipe’s own labour is not carried into recipes that use it', () => {
    const s = sampleStored();
    Object.assign(s.recipes[0]!, { labourMinutes: '600', labourRate: '100' });
    const a = ok(verifiedRecipes(compile(s)).get('charsiu'));
    const b = ok(verifiedRecipes(compile(sampleStored())).get('charsiu'));
    expect(eq(a.total, b.total)).toBe(true);
    expect(a.extras).toBeNull();
  });

  it('validation: negative values, overhead over 1000% and fractions are refused', () => {
    const s = sampleStored();
    Object.assign(s.recipes[1]!, {
      labourMinutes: '-1',
      labourRate: '1/2',
      overheadPercent: '1000.01',
    });
    expect(codes(validateProject(s))).toEqual([
      'must-not-be-negative@recipes[1].labourMinutes',
      'not-a-number@recipes[1].labourRate',
      'overhead-out-of-range@recipes[1].overheadPercent',
    ]);
    const kept = validateProject(withExtras());
    expect(kept.ok && kept.value.stored.recipes[1]!.overheadPercent).toBe('12.5');
  });

  it('property: on random projects, extras verify and follow the formula', () => {
    fc.assert(
      fc.property(
        projectArb({ maxIngredients: 4, maxRecipes: 4, maxLines: 3 }),
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 600 }),
            fc.integer({ min: 0, max: 50000 }),
            fc.integer({ min: 0, max: 9999 }),
            fc.integer({ min: 0, max: 1000 }),
          ),
          { minLength: 4, maxLength: 4 },
        ),
        (p, extras) => {
          p.recipes.forEach((r, i) => {
            const [m, rate, fixed, pct] = extras[i % 4]!;
            r.labourMinutes = String(m);
            r.labourRate = (rate / 100).toFixed(2);
            r.overheadFixed = (fixed / 100).toFixed(2);
            r.overheadPercent = String(pct);
          });
          const proj = compile(p);
          for (const [id, v] of verifiedRecipes(proj)) {
            if (v.status === 'mismatch') return false;
            if (v.status !== 'ok' || !v.extras) continue;
            const e = proj.recipes.get(id)!.extras;
            const want = add(
              add(v.total, mul(e.labourMinutes, div(e.labourRate, rat(60n)))),
              add(e.overheadFixed, mul(v.total, e.overheadRate)),
            );
            if (!eq(v.extras.full, want)) return false;
          }
          return true;
        },
      ),
      { numRuns: 150 },
    );
  });
});

const EXTRAS_MUTANTS: Mutant[] = [
  {
    name: 'labour minutes divided by 100',
    file: 'cost/extras.ts',
    from: 'const SIXTY = rat(60n);',
    to: 'const SIXTY = rat(100n);',
  },
  {
    name: 'fixed overhead dropped',
    file: 'cost/extras.ts',
    from: 'const overhead = add(e.overheadFixed, mul(food, e.overheadRate));',
    to: 'const overhead = add(rat(0n), mul(food, e.overheadRate));',
  },
  {
    name: 'labour left out of the full cost',
    file: 'cost/extras.ts',
    from: 'full: add(add(food, labour), overhead)',
    to: 'full: add(food, overhead)',
  },
  {
    name: 'overhead % applied to the full cost instead of food',
    file: 'cost/extras.ts',
    from: 'mul(food, e.overheadRate)',
    to: 'mul(add(food, labour), e.overheadRate)',
  },
  {
    name: 'hasExtras ignores overhead %',
    file: 'cost/extras.ts',
    from: '    e.overheadRate.n !== 0n\n',
    to: '    false\n',
  },
];

describe('labour/overhead engine mutants are caught', () => {
  for (const m of EXTRAS_MUTANTS)
    it(m.name, async () => {
      expect(occurrences(m), `mutant "${m.name}" must apply once`).toBe(1);
      const mod = await loadMutant<typeof cost>(m);
      const fails = runExtrasGolden(mod);
      if (m.name.startsWith('hasExtras')) {
        // only visible on a recipe that has nothing but an overhead %
        const s = sampleStored();
        s.recipes[0]!.overheadPercent = '10';
        expect(mod.hasExtras(compile(s).recipes.get('syrup')!), 'survived').toBe(false);
      } else expect(fails.length, `mutant "${m.name}" survived`).toBeGreaterThan(0);
    });
});

const CHECKER_MUTANTS: Mutant[] = [
  {
    name: 'checker labour per 100 minutes',
    file: 'check/index.ts',
    from: 'const labour = div(mul(e.labourRate, e.labourMinutes), rat(60n));',
    to: 'const labour = div(mul(e.labourRate, e.labourMinutes), rat(100n));',
  },
  {
    name: 'checker forgets fixed overhead',
    file: 'check/index.ts',
    from: 'const overhead = add(overheadOnFood, e.overheadFixed);',
    to: 'const overhead = overheadOnFood; void e.overheadFixed;',
  },
  {
    name: 'checker weight ignores density',
    file: 'check/index.ts',
    from: '} else g = amountIn(l.qty, from, gram, project.recipes.get(l.ref.id)!.density);',
    to: '} else g = amountIn(l.qty, from, gram, undefined);',
  },
];

describe('checker mutants make verification fail', () => {
  for (const m of CHECKER_MUTANTS)
    it(m.name, async () => {
      expect(occurrences(m), `mutant "${m.name}" must apply once`).toBe(1);
      const mod = await loadMutant<typeof check>(m);
      const s = withExtras();
      s.recipes[0]!.density = '1.3';
      const p = compile(s);
      const r = p.recipes.get('charsiu')!;
      const e = cost.recipeExtras(r, CHARSIU_FOOD);
      const c = mod.recomputeExtras(r, CHARSIU_FOOD);
      const w = mod.recomputeWeight(p, r);
      const ew = cost.recipeWeight(p, r);
      const agree =
        eq(e.full, c.full) &&
        eq(e.labour, c.labour) &&
        ew.ok &&
        'grams' in w &&
        eq(ew.grams, w.grams);
      expect(agree, `mutant "${m.name}" survived`).toBe(false);
    });
  it('the real checker agrees with the engine', () => {
    const p = compile(withExtras());
    const engine = cost.costRecipes(p);
    const chk = new check.Checker(p);
    expect(verifyRecipe(p, 'charsiu', engine.get('charsiu')!, chk).status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------------------
// Ingredient weight
// ---------------------------------------------------------------------------------------
describe('ingredient weight of a batch', () => {
  // charsiu: pork 2 catty = 1209.57964 g; soy 3 US tbsp × 1.2 g/ml = 53.2323532125 g;
  // syrup 200 ml × 1.3 g/ml = 260 g (only once the syrup has a density).
  const W = add(add(dec('1209.57964'), dec('53.2323532125')), rat(260n));
  it('golden values, per portion, and lines that cannot be weighed', () => {
    const s = sampleStored();
    const before = verifiedWeight(compile(s), 'charsiu');
    expect(before).toEqual({ status: 'missing', lines: [2] });
    s.recipes[0]!.density = '1.3';
    const v = verifiedWeight(compile(s), 'charsiu');
    expect(v.status).toBe('ok');
    if (v.status !== 'ok') return;
    expect(eq(v.grams, W)).toBe(true);
    expect(eq(v.perPortion!, div(W, rat(10n)))).toBe(true);
    // syrup: water has no density, so its 700 ml cannot be weighed
    expect(verifiedWeight(compile(s), 'syrup')).toEqual({ status: 'missing', lines: [1] });
    s.ingredients[6]!.density = '1';
    const syrup = verifiedWeight(compile(s), 'syrup');
    expect(syrup.status === 'ok' && eq(syrup.grams, rat(1200n))).toBe(true);
    expect(syrup.status === 'ok' && syrup.perPortion).toBeNull(); // yields litres
    // lemon tea: half a lemon without a weight per piece
    expect(verifiedWeight(compile(s), 'lemontea')).toEqual({ status: 'missing', lines: [1] });
  });
  it('property: scaling every line by k scales the weight by k', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), (k) => {
        const s = sampleStored();
        s.recipes[0]!.density = '1.3';
        const a = verifiedWeight(compile(s), 'charsiu');
        for (const l of s.recipes[1]!.lines) l.qty = String(Number(l.qty) * k);
        const b = verifiedWeight(compile(s), 'charsiu');
        return a.status === 'ok' && b.status === 'ok' && eq(b.grams, mul(a.grams, rat(k)));
      }),
      { numRuns: 200 },
    );
  });
});

const WEIGHT_MUTANTS: Mutant[] = [
  {
    name: 'weight converts to millilitres',
    file: 'cost/extras.ts',
    from: "const q = toBaseOf(line.qty, lu, 'mass', info, '');",
    to: "const q = toBaseOf(line.qty, lu, lu.dim === 'volume' ? 'volume' : 'mass', info, '');",
  },
  {
    name: 'weight skips unweighable lines silently',
    file: 'cost/extras.ts',
    from: '    else missing.push(j);',
    to: '    else void j;',
  },
];

describe('weight engine mutants are caught', () => {
  for (const m of WEIGHT_MUTANTS)
    it(m.name, async () => {
      expect(occurrences(m), `mutant "${m.name}" must apply once`).toBe(1);
      const mod = await loadMutant<typeof cost>(m);
      const s = sampleStored();
      const p = compile(s);
      const plain = mod.recipeWeight(p, p.recipes.get('charsiu')!);
      s.recipes[0]!.density = '1.3';
      const p2 = compile(s);
      const dense = mod.recipeWeight(p2, p2.recipes.get('charsiu')!);
      const W = add(add(dec('1209.57964'), dec('53.2323532125')), rat(260n));
      const right = !plain.ok && plain.missing.join() === '2' && dense.ok && eq(dense.grams, W);
      expect(right, `mutant "${m.name}" survived`).toBe(false);
    });
});

// ---------------------------------------------------------------------------------------
// Price history
// ---------------------------------------------------------------------------------------
const BASE: StoredIngredient = {
  id: 'b',
  name: '牛油',
  packQty: '454',
  packUnit: 'g',
  price: '40',
};

describe('price history', () => {
  it('a changed price keeps the old one, dated, and dates the new one today', () => {
    const before = { price: '40', packQty: '454', packUnit: 'g' as const, priceDate: '2026-09-01' };
    const next = recordPriceChange({ ...BASE, price: '46' }, before, '2026-10-08');
    expect(next.priceDate).toBe('2026-10-08');
    expect(next.priceHistory).toEqual([
      { date: '2026-09-01', price: '40', packQty: '454', packUnit: 'g' },
    ]);
    // without an old date, today is used
    const undated = recordPriceChange(
      { ...BASE, price: '46' },
      { ...before, priceDate: undefined },
      '2026-10-08',
    );
    expect(undated.priceHistory![0]!.date).toBe('2026-10-08');
    // nothing changed (or only written differently): no entry
    expect(recordPriceChange(BASE, before, '2026-10-08')).toBe(BASE);
    const same = (a: string, b: string) => Number(a) === Number(b);
    expect(recordPriceChange({ ...BASE, price: '40.00' }, before, '2026-10-08', same)).toEqual({
      ...BASE,
      price: '40.00',
    });
    // a pack change is recorded too
    expect(recordPriceChange({ ...BASE, packQty: '250' }, before, 'x').priceHistory).toHaveLength(
      1,
    );
  });

  it(`keeps at most ${LIMITS.priceHistory} entries, dropping the oldest`, () => {
    let ing: StoredIngredient = { ...BASE };
    for (let i = 0; i < LIMITS.priceHistory + 7; i++) {
      const before = {
        price: ing.price,
        packQty: ing.packQty,
        packUnit: ing.packUnit,
        priceDate: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      };
      ing = recordPriceChange({ ...ing, price: String(41 + i) }, before, '2026-10-08');
    }
    expect(ing.priceHistory).toHaveLength(LIMITS.priceHistory);
    expect(ing.priceHistory![0]!.price).toBe('47');
    const s = sampleStored();
    s.ingredients.push(ing);
    expect(validateProject(s).ok).toBe(true);
  });

  it('change since the last price: up, down, pack changed, was free', () => {
    const s = sampleStored();
    s.ingredients[1]!.priceHistory = [
      { date: '2026-09-01', price: '10', packQty: '1', packUnit: 'kg' },
    ];
    let v = verifiedPriceChange(compile(s).ingredients.get('sugar')!);
    expect(v?.status === 'ok' && v.change && eq(v.change, rat(1n, 5n))).toBe(true); // 10 → 12
    s.ingredients[1]!.priceHistory[0]!.price = '15';
    v = verifiedPriceChange(compile(s).ingredients.get('sugar')!);
    expect(v?.status === 'ok' && v.change && eq(v.change, rat(-1n, 5n))).toBe(true);
    s.ingredients[1]!.priceHistory[0]!.packQty = '1/2';
    expect(verifiedPriceChange(compile(s).ingredients.get('sugar')!)?.status).toBe('pack-changed');
    s.ingredients[1]!.priceHistory[0] = {
      date: '2026-09-01',
      price: '0',
      packQty: '1000',
      packUnit: 'g',
    };
    expect(verifiedPriceChange(compile(s).ingredients.get('sugar')!)?.status).toBe('pack-changed');
    s.ingredients[1]!.priceHistory[0]!.packQty = '1';
    s.ingredients[1]!.priceHistory[0]!.packUnit = 'kg';
    const free = verifiedPriceChange(compile(s).ingredients.get('sugar')!);
    expect(free?.status === 'ok' && free.change).toBeNull();
    expect(verifiedPriceChange(compile(sampleStored()).ingredients.get('sugar')!)).toBeNull();
  });

  it('validation of stored history', () => {
    const s = sampleStored();
    s.ingredients[1]!.priceHistory = [
      { date: '2026-02-30', price: '-1', packQty: '0', packUnit: 'portion' as never },
    ];
    expect(codes(validateProject(s))).toEqual([
      'bad-date@ingredients[1].priceHistory[0].date',
      'must-not-be-negative@ingredients[1].priceHistory[0].price',
      'must-be-positive@ingredients[1].priceHistory[0].packQty',
      'bad-unit@ingredients[1].priceHistory[0].packUnit',
    ]);
    const many = sampleStored();
    many.ingredients[1]!.priceHistory = Array.from({ length: LIMITS.priceHistory + 1 }, () => ({
      date: '2026-01-01',
      price: '1',
      packQty: '1',
      packUnit: 'kg' as const,
    }));
    expect(codes(validateProject(many))).toEqual(['too-many@ingredients[1].priceHistory']);
  });

  it('property: after any price change the shown change is (new − old) ÷ old', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 ** 6 }),
        fc.integer({ min: 0, max: 10 ** 6 }),
        (a, b) => {
          const s = sampleStored();
          const old = { price: (a / 100).toFixed(2), packQty: '1', packUnit: 'kg' as const };
          s.ingredients[1] = recordPriceChange(
            { ...s.ingredients[1]!, price: (b / 100).toFixed(2) },
            old,
            '2026-10-08',
          );
          const v = verifiedPriceChange(compile(s).ingredients.get('sugar')!);
          if (a === b) return v === null;
          return v?.status === 'ok' && v.change !== null && eq(v.change, div(rat(b - a), rat(a)));
        },
      ),
      { numRuns: 500 },
    );
  });
});

const HISTORY_MUTANTS: Mutant[] = [
  {
    name: 'history drops the newest instead of the oldest',
    file: 'model/edit.ts',
    from: 'while (history.length > LIMITS.priceHistory) history.shift();',
    to: 'while (history.length > LIMITS.priceHistory) history.pop();',
  },
  {
    name: 'old price recorded with today’s date even when it had one',
    file: 'model/edit.ts',
    from: 'date: before.priceDate || today,',
    to: 'date: today,',
  },
  {
    name: 'pack unit change not recorded',
    file: 'model/edit.ts',
    from: '    before.packUnit !== ing.packUnit;',
    to: '    false;',
  },
  {
    name: 'duplicate keeps the original id',
    file: 'model/edit.ts',
    from: 'return { ...copy, id: newId, name: base + suffix };',
    to: 'return { ...copy, id: r.id, name: base + suffix };',
  },
  {
    name: 'duplicate shares lines with the original',
    file: 'model/edit.ts',
    from: 'return { ...copy, id: newId, name: base + suffix };',
    to: 'return { ...copy, lines: r.lines, id: newId, name: base + suffix };',
  },
  {
    name: 'measure in a menu portion not seen as used',
    file: 'model/edit.ts',
    from: '  for (const m of p.menu) if (m.portionUnit === ref) out.push(m.name);',
    to: '  void p.menu;',
  },
];

function runEditGolden(m: typeof modelNs): string[] {
  const fails: string[] = [];
  let ing: StoredIngredient = { ...BASE };
  for (let i = 0; i < LIMITS.priceHistory + 2; i++)
    ing = m.recordPriceChange(
      { ...ing, price: String(50 + i) },
      { price: ing.price, packQty: ing.packQty, packUnit: ing.packUnit, priceDate: '2026-01-01' },
      '2026-10-08',
    );
  if (ing.priceHistory?.at(-1)?.price !== String(50 + LIMITS.priceHistory))
    fails.push('newest kept');
  if (ing.priceHistory?.[0]?.date !== '2026-01-01') fails.push('old date');
  const unit = m.recordPriceChange(
    { ...BASE, packUnit: 'kg' },
    { price: '40', packQty: '454', packUnit: 'g' },
    'd',
  );
  if (unit.priceHistory?.length !== 1) fails.push('unit change');
  const s = sampleStored();
  const copy = m.duplicateRecipe(s.recipes[1]!, 'r9', 'zh-HK');
  if (copy.id !== 'r9' || copy.name !== '叉燒（副本）') fails.push('copy id/name');
  copy.lines[0]!.qty = '99';
  if (s.recipes[1]!.lines[0]!.qty === '99') fails.push('copy shares lines');
  s.measures = [{ id: 'bowl', name: '碗', amount: '300', unit: 'ml' }];
  s.menu[0]!.portionUnit = 'measure:bowl';
  if (m.measureUses(s, 'bowl').join() !== '叉燒飯') fails.push('menu measure use');
  return fails;
}

describe('editing helpers', () => {
  it('golden', () => {
    expect(runEditGolden(modelNs)).toEqual([]);
  });
  it('duplicate recipe: valid, new id, long names are cut to fit', () => {
    const s = sampleStored();
    s.recipes[1]!.name = '叉'.repeat(LIMITS.nameLength);
    const copy = duplicateRecipe(s.recipes[1]!, 'charsiu2', 'en');
    expect([...copy.name].length).toBe(LIMITS.nameLength);
    expect(copy.name.endsWith(' (copy)')).toBe(true);
    s.recipes.push(copy);
    const v = verifiedRecipes(compile(s));
    expect(eq(ok(v.get('charsiu2')).total, ok(v.get('charsiu')).total)).toBe(true);
  });
  it('measure uses: packs, history, recipe yields, lines and menu portions', () => {
    const s = sampleStored();
    s.measures = [{ id: 'cup', name: 'cup', amount: '250', unit: 'ml' }];
    expect(measureUses(s, 'cup')).toEqual([]);
    s.recipes[0]!.lines[1]!.unit = 'measure:cup';
    s.ingredients[0]!.priceHistory = [
      { date: '2026-01-01', price: '1', packQty: '1', packUnit: 'measure:cup' },
    ];
    expect(measureUses(s, 'cup')).toEqual(['梅頭肉', '糖水']);
  });
  for (const mu of HISTORY_MUTANTS)
    it(`mutant caught: ${mu.name}`, async () => {
      expect(occurrences(mu), `mutant "${mu.name}" must apply once`).toBe(1);
      const mod = await loadMutant<typeof modelNs>(mu);
      expect(runEditGolden(mod).length, `mutant "${mu.name}" survived`).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------------------
describe('project format version 2', () => {
  it('a version 1 file opens unchanged and is saved back as version 2', () => {
    const v1 = { ...clone(sampleStored()), version: 1 };
    const r = readProjectJson(JSON.stringify(v1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.migrated).toBe(true);
    expect(r.value.stored.version).toBe(2);
    const { version: _a, ...restA } = r.value.stored;
    const { version: _b, ...restB } = v1;
    void _a;
    void _b;
    expect(restA).toEqual(restB);
  });
  it('the bundled v0.1 examples still open and cost the same', async () => {
    const { readFileSync } = await import('node:fs');
    for (const f of ['cha-chaan-teng', 'home-bakery', 'social-enterprise-lunch']) {
      const text = readFileSync(new URL(`../../../examples/${f}.json`, import.meta.url), 'utf8');
      const r = readProjectJson(text);
      expect(r.ok, f).toBe(true);
      if (!r.ok) continue;
      for (const v of verifiedRecipes(r.value.project).values())
        expect(v.status === 'mismatch', f).toBe(false);
    }
  });
});

void (null as unknown as Rational);

// ---------------------------------------------------------------------------------------
// "A pinch": lines counted at part of their cost, or not at all
// ---------------------------------------------------------------------------------------
describe('cost % per line (a pinch, not costed)', () => {
  const SYRUP_200 = dec('1.2');
  function runShareGolden(engine: typeof cost): string[] {
    const fails: string[] = [];
    const s = sampleStored();
    s.recipes[1]!.lines[1]!.costPercent = '0';
    s.recipes[1]!.lines[1]!.unit = 'piece'; // soy has no weight per piece: fine when not costed
    s.recipes[1]!.lines[2]!.costPercent = '50';
    let res: Map<string, cost.RecipeCost>;
    try {
      res = engine.costRecipes(compile(s));
    } catch (e) {
      return [`threw ${String(e)}`];
    }
    const r = res.get('charsiu');
    if (!r || !r.ok) return ['charsiu not ok'];
    if (!eq(r.lines[1]!, rat(0n))) fails.push('pinch line');
    if (!eq(r.lines[2]!, div(SYRUP_200, rat(2n)))) fails.push('half line');
    if (!eq(r.total, add(PORK, div(SYRUP_200, rat(2n))))) fails.push('total');
    return fails;
  }

  it('golden: 0% costs nothing and needs no conversion; 50% halves the line', () => {
    expect(runShareGolden(cost)).toEqual([]);
    const s = sampleStored();
    s.recipes[1]!.lines[1]!.costPercent = '0';
    s.recipes[1]!.lines[1]!.unit = 'piece';
    s.recipes[1]!.lines[2]!.costPercent = '50';
    const p = compile(s);
    const v = ok(verifiedRecipes(p).get('charsiu'));
    expect(eq(v.total, add(PORK, div(SYRUP_200, rat(2n))))).toBe(true);
    const report = textReport(p, 'en');
    expect(report).toMatch(/生抽 {2}3 pieces? \[pinch, not costed\]/);
    expect(report).toMatch(/\[cost counted at 50\.0%\]/);
    expect(textReport(p, 'zh-HK')).toMatch(/\[少量，不計成本\]/);
  });

  it('quantities are not affected: "how much can I make" and price impact', () => {
    const s = sampleStored();
    const before = compile(s);
    s.recipes[1]!.lines[0]!.costPercent = '50';
    const after = compile(s);
    const { verifiedMaxYield, verifiedImpact } = api;
    const a = verifiedMaxYield(before, 'charsiu', 'pork', rat(4n), 'catty');
    const b = verifiedMaxYield(after, 'charsiu', 'pork', rat(4n), 'catty');
    expect(a.status).toBe('ok');
    expect(b).toEqual(a); // 4 catties are still enough for 20 portions
    // a price change on a line counted at 50% moves the cost by half as much
    const ia = verifiedImpact(before, 'pork', rat(78n));
    const ib = verifiedImpact(after, 'pork', rat(78n));
    expect(ia.status === 'ok' && ib.status === 'ok').toBe(true);
    if (ia.status !== 'ok' || ib.status !== 'ok') return;
    const d = (rows: typeof ia.rows) => rows.find((r) => r.id === 'charsiu')!.change;
    expect(eq(d(ib.rows), div(d(ia.rows), rat(2n)))).toBe(true);
  });

  it('validation', () => {
    const s = sampleStored();
    s.recipes[1]!.lines[0]!.costPercent = '101';
    s.recipes[1]!.lines[1]!.costPercent = '-1';
    s.recipes[1]!.lines[2]!.costPercent = '1/2';
    expect(codes(validateProject(s))).toEqual([
      'percent-out-of-range@recipes[1].lines[0].costPercent',
      'percent-out-of-range@recipes[1].lines[1].costPercent',
      'not-a-number@recipes[1].lines[2].costPercent',
    ]);
  });

  it('property: random cost % on random projects never makes engine and checker disagree', () => {
    fc.assert(
      fc.property(
        projectArb({ maxIngredients: 5, maxRecipes: 5, maxLines: 4 }),
        fc.array(fc.constantFrom('0', '12.5', '50', '100', '99.9'), {
          minLength: 20,
          maxLength: 20,
        }),
        (p, shares) => {
          let n = 0;
          for (const r of p.recipes) for (const l of r.lines) l.costPercent = shares[n++ % 20]!;
          const proj = compile(p);
          for (const v of verifiedRecipes(proj).values()) if (v.status === 'mismatch') return false;
          const full = api.verifiedProject(proj);
          for (const m of full.menu.values()) if (m.status === 'mismatch') return false;
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('property: 100% written out costs the same as not set', () => {
    fc.assert(
      fc.property(projectArb({ maxIngredients: 4, maxRecipes: 4, maxLines: 3 }), (p) => {
        const a = verifiedRecipes(compile(p));
        for (const r of p.recipes) for (const l of r.lines) l.costPercent = '100';
        const b = verifiedRecipes(compile(p));
        for (const [id, va] of a) {
          const vb = b.get(id)!;
          if (va.status !== vb.status) return false;
          if (va.status === 'ok' && vb.status === 'ok' && !eq(va.total, vb.total)) return false;
        }
        return true;
      }),
      { numRuns: 150 },
    );
  });

  const SHARE_ENGINE_MUTANTS: Mutant[] = [
    {
      name: 'engine ignores the cost %',
      file: 'cost/engine.ts',
      from: 'const cost = mul(div(mul(qtyBase, unitCost), sub(ONE, line.waste)), line.share);',
      to: 'const cost = div(mul(qtyBase, unitCost), sub(ONE, line.waste));',
    },
    {
      name: 'engine converts pinch lines anyway',
      file: 'cost/engine.ts',
      from: '      if (line.share.n === 0n) {',
      to: '      if (line.share.n === 0n && line.qty.n < 0n) {',
    },
  ];
  for (const m of SHARE_ENGINE_MUTANTS)
    it(`mutant caught: ${m.name}`, async () => {
      expect(occurrences(m), `mutant "${m.name}" must apply once`).toBe(1);
      const mod = await loadMutant<typeof cost>(m);
      expect(runShareGolden(mod).length, `mutant "${m.name}" survived`).toBeGreaterThan(0);
    });

  const SHARE_CHECKER_MUTANTS: Mutant[] = [
    {
      name: 'checker ignores the cost %',
      file: 'check/index.ts',
      from: '      batches = mul(batches, line.share); // pay for this share of the line only',
      to: '      void 0;',
    },
    {
      name: 'checker applies the cost % to quantities too',
      file: 'check/index.ts',
      from: '    if (!physical) {\n      if (line.share.n === 0n) return undefined; // a pinch, not costed',
      to: '    if (physical || !physical) {\n      if (line.share.n === 0n) return undefined; // a pinch, not costed',
    },
  ];
  for (const m of SHARE_CHECKER_MUTANTS)
    it(`checker mutant caught: ${m.name}`, async () => {
      expect(occurrences(m), `mutant "${m.name}" must apply once`).toBe(1);
      const mod = await loadMutant<typeof check>(m);
      const s = sampleStored();
      s.recipes[1]!.lines[0]!.costPercent = '50';
      const p = compile(s);
      const engine = cost.costRecipes(p);
      const chk = new mod.Checker(p);
      const recipeOk = verifyRecipe(p, 'charsiu', engine.get('charsiu')!, chk).status === 'ok';
      // physical packs for 1 portion: 2 catties ÷ 10 portions of a 1-catty pack = 1/5
      const packs = chk.packsFor('charsiu', rat(1n), true);
      const physicalOk = typeof packs !== 'string' && eq(packs.get('pork')!, rat(1n, 5n));
      expect(recipeOk && physicalOk, `mutant "${m.name}" survived`).toBe(false);
    });
});
