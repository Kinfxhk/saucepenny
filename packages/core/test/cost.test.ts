// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { projectArb } from '../../../test/oracle/random-project';
import { verifiedRecipes, type VerifiedRecipe } from '../src/api';
import { Checker } from '../src/check/index';
import * as cost from '../src/cost/index';
import { costRecipes } from '../src/cost/index';
import { validateProject, type Project, type StoredProject } from '../src/model/index';
import { add, dec, div, eq, ge, mul, rat, toFraction, ZERO, type Rational } from '../src/num/index';
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

// ---- Hand-worked golden values for the sample (see helpers/fixtures.ts) -------------------
// Pork: 1 catty for $68, 90% usable. 2 catties used → 2 × 68 ÷ 0.9 = 1360/9.
// Soy: 500 ml for $15. 3 US tbsp = 44.36029434375 ml → × 15/500 = 1.3308088303125.
// Syrup: 500 g sugar of a $12 kg = 6; water free → $6 per litre. 200 ml → 1.2.
// Lemon tea: 2 taels of tea from a $80 lb with 5% line waste
//   = 2 × 37.79936375 × 80 ÷ 453.59237 ÷ 0.95; half a $4 lemon = 2; 30 ml syrup = 0.18.
const PORK = rat(1360n, 9n);
const SOY = dec('1.3308088303125');
const SYRUP_200 = dec('1.2');
const CHARSIU_TOTAL = add(add(PORK, SOY), SYRUP_200);
const TEA = div(
  div(mul(mul(rat(2n), dec('37.79936375')), rat(80n)), dec('453.59237')),
  dec('0.95'),
);
const LEMONTEA_TOTAL = add(add(TEA, rat(2n)), dec('0.18'));

export function runEngineGolden(engine: typeof cost): string[] {
  const fails: string[] = [];
  const check = (name: string, got: Rational | undefined, want: Rational) => {
    if (!got || !eq(got, want))
      fails.push(`${name}: ${got ? toFraction(got) : '—'} != ${toFraction(want)}`);
  };
  let res: Map<string, cost.RecipeCost>;
  try {
    res = engine.costRecipes(compile(sampleStored()));
  } catch (e) {
    return [`threw: ${String(e)}`];
  }
  const get = (id: string) => {
    const r = res.get(id);
    return r && r.ok ? r : undefined;
  };
  check('syrup total', get('syrup')?.total, rat(6n));
  check('syrup per ml', get('syrup')?.perYieldBase, dec('0.006'));
  check('charsiu pork line', get('charsiu')?.lines[0], PORK);
  check('charsiu soy line', get('charsiu')?.lines[1], SOY);
  check('charsiu syrup line', get('charsiu')?.lines[2], SYRUP_200);
  check('charsiu total', get('charsiu')?.total, CHARSIU_TOTAL);
  check('charsiu per portion', get('charsiu')?.perYieldBase, div(CHARSIU_TOTAL, rat(10n)));
  check('lemon tea tea line', get('lemontea')?.lines[0], TEA);
  check('lemon tea total', get('lemontea')?.total, LEMONTEA_TOTAL);

  // Two different recipes with the same name must not share a memo entry.
  const twins = sampleStored();
  twins.recipes.push({
    id: 'syrup2',
    name: '糖水',
    yieldQty: '500',
    yieldUnit: 'ml',
    lines: [{ ref: { kind: 'ingredient', id: 'sugar' }, qty: '500', unit: 'g' }],
  });
  twins.recipes[2]!.lines[2]!.ref.id = 'syrup2';
  try {
    const t = engine.costRecipes(compile(twins)).get('lemontea');
    // 30 ml of a $6-per-500-ml syrup = 0.36
    check(
      'same-name sub-recipes',
      t && t.ok ? t.total : undefined,
      add(add(TEA, rat(2n)), dec('0.36')),
    );
  } catch (e) {
    fails.push(`twins threw ${String(e)}`);
  }

  // Diamond: top uses A and B, both use base. Each path counts.
  const dia = sampleStored();
  dia.recipes.push(
    {
      id: 'A',
      name: 'A',
      yieldQty: '1',
      yieldUnit: 'portion',
      lines: [{ ref: { kind: 'recipe', id: 'syrup' }, qty: '100', unit: 'ml' }],
    },
    {
      id: 'B',
      name: 'B',
      yieldQty: '2',
      yieldUnit: 'portion',
      lines: [{ ref: { kind: 'recipe', id: 'syrup' }, qty: '300', unit: 'ml' }],
    },
    {
      id: 'top',
      name: 'Top',
      yieldQty: '1',
      yieldUnit: 'portion',
      lines: [
        { ref: { kind: 'recipe', id: 'A' }, qty: '1', unit: 'portion' },
        { ref: { kind: 'recipe', id: 'B' }, qty: '1', unit: 'portion' },
      ],
    },
  );
  try {
    const t = engine.costRecipes(compile(dia)).get('top');
    // A: 100 ml × 0.006 = 0.6 ; B per portion: 300 ml × 0.006 ÷ 2 = 0.9 → 1.5
    check('diamond', t && t.ok ? t.total : undefined, dec('1.5'));
  } catch (e) {
    fails.push(`diamond threw ${String(e)}`);
  }

  // Density: 1 kg of soy sauce at 1.2 g/ml = 833.33… ml × 0.03 = 25.
  const dens = sampleStored();
  dens.recipes[0]!.lines.push({ ref: { kind: 'ingredient', id: 'soy' }, qty: '1', unit: 'kg' });
  try {
    const t = engine.costRecipes(compile(dens)).get('syrup');
    check('density line', t && t.ok ? t.lines[2] : undefined, rat(25n));
  } catch (e) {
    fails.push(`density threw ${String(e)}`);
  }
  // Eggs by weight: 110 g of eggs at 55 g each = 2 eggs × $1.5 = 3.
  const eggs = sampleStored();
  eggs.recipes[0]!.lines.push({ ref: { kind: 'ingredient', id: 'egg' }, qty: '110', unit: 'g' });
  try {
    const t = engine.costRecipes(compile(eggs)).get('syrup');
    check('piece-weight line', t && t.ok ? t.lines[2] : undefined, rat(3n));
  } catch (e) {
    fails.push(`piece threw ${String(e)}`);
  }
  return fails;
}

describe('costing engine: hand-worked golden values', () => {
  it('matches every value worked out on paper', () => {
    expect(runEngineGolden(cost)).toEqual([]);
  });
  it('the verified API agrees and marks everything verified', () => {
    const v = verifiedRecipes(compile(sampleStored()));
    expect(eq(ok(v.get('charsiu')).total, CHARSIU_TOTAL)).toBe(true);
    expect(eq(ok(v.get('charsiu')).perYieldUnit, div(CHARSIU_TOTAL, rat(10n)))).toBe(true);
    // syrup yields 1 L: per yield unit = per litre = $6
    expect(eq(ok(v.get('syrup')).perYieldUnit, rat(6n))).toBe(true);
  });
});

describe('explicit errors (never zero)', () => {
  const codeOf = (p: StoredProject, id: string) => {
    const r = costRecipes(compile(p)).get(id)!;
    return r.ok
      ? 'ok'
      : `${r.error.code}${r.error.params?.cycle ? `:${r.error.params.cycle}` : ''}`;
  };
  it('volume of an ingredient sold by weight without density', () => {
    const p = sampleStored();
    p.recipes[0]!.lines[0]!.unit = 'cup';
    expect(codeOf(p, 'syrup')).toBe('needs-density');
    expect(codeOf(p, 'charsiu')).toBe('recipe-error');
  });
  it('pieces of an ingredient sold by weight without weight per piece', () => {
    const p = sampleStored();
    p.recipes[0]!.lines[0]!.unit = 'piece';
    expect(codeOf(p, 'syrup')).toBe('needs-piece-weight');
  });
  it('portions of a recipe that yields litres', () => {
    const p = sampleStored();
    p.recipes[1]!.lines[2]!.unit = 'portion';
    expect(codeOf(p, 'charsiu')).toBe('incompatible-units');
  });
  it('grams of a recipe that yields litres needs the recipe density, then works', () => {
    const p = sampleStored();
    p.recipes[1]!.lines[2]!.unit = 'g';
    expect(codeOf(p, 'charsiu')).toBe('needs-density');
    p.recipes[0]!.density = '1.25';
    expect(codeOf(p, 'charsiu')).toBe('ok');
  });
  it('zero lines cost zero; zero quantity costs zero', () => {
    const p = sampleStored();
    p.recipes[0]!.lines = [];
    p.recipes[2]!.lines[0]!.qty = '0';
    const res = costRecipes(compile(p));
    const s = res.get('syrup')!;
    expect(s.ok && eq(s.total, ZERO)).toBe(true);
    const t = res.get('lemontea')!;
    expect(t.ok && eq(t.lines[0]!, ZERO)).toBe(true);
  });
});

describe('cycles and nesting', () => {
  const chain = (n: number, closeTo?: number): StoredProject => {
    const p = sampleStored();
    for (let i = 0; i < n; i++)
      p.recipes.push({
        id: `c${i}`,
        name: `C${i}`,
        yieldQty: '1',
        yieldUnit: 'portion',
        lines:
          i === n - 1 && closeTo === undefined
            ? [{ ref: { kind: 'ingredient', id: 'sugar' }, qty: '1', unit: 'g' }]
            : [
                {
                  ref: { kind: 'recipe', id: i === n - 1 ? `c${closeTo}` : `c${i + 1}` },
                  qty: '1',
                  unit: 'portion',
                },
              ],
      });
    return p;
  };
  const err = (p: StoredProject, id: string) => {
    const r = costRecipes(compile(p)).get(id)!;
    return r.ok ? undefined : r.error;
  };
  it('a recipe that uses itself', () => {
    const p = sampleStored();
    p.recipes[0]!.lines.push({ ref: { kind: 'recipe', id: 'syrup' }, qty: '1', unit: 'ml' });
    expect(err(p, 'syrup')).toMatchObject({ code: 'cycle', params: { cycle: '糖水 → 糖水' } });
    expect(err(p, 'charsiu')?.code).toBe('recipe-error');
  });
  it('two recipes using each other, with the full path', () => {
    const p = chain(2, 0);
    expect(err(p, 'c0')).toMatchObject({ code: 'cycle', params: { cycle: 'C0 → C1 → C0' } });
    expect(err(p, 'c1')).toMatchObject({ code: 'cycle', params: { cycle: 'C1 → C0 → C1' } });
  });
  it('a cycle of length 20 reports all 20 recipes', () => {
    const e = err(chain(20, 0), 'c0');
    expect(e?.code).toBe('cycle');
    expect(String(e?.params?.cycle).split(' → ')).toHaveLength(21);
  });
  it('a cycle that goes through a diamond and back', () => {
    const p = sampleStored();
    p.recipes.push(
      {
        id: 'top',
        name: 'Top',
        yieldQty: '1',
        yieldUnit: 'portion',
        lines: [
          { ref: { kind: 'recipe', id: 'L' }, qty: '1', unit: 'portion' },
          { ref: { kind: 'recipe', id: 'R' }, qty: '1', unit: 'portion' },
        ],
      },
      {
        id: 'L',
        name: 'L',
        yieldQty: '1',
        yieldUnit: 'portion',
        lines: [{ ref: { kind: 'recipe', id: 'base' }, qty: '1', unit: 'portion' }],
      },
      {
        id: 'R',
        name: 'R',
        yieldQty: '1',
        yieldUnit: 'portion',
        lines: [{ ref: { kind: 'recipe', id: 'base' }, qty: '1', unit: 'portion' }],
      },
      {
        id: 'base',
        name: 'Base',
        yieldQty: '1',
        yieldUnit: 'portion',
        lines: [{ ref: { kind: 'recipe', id: 'top' }, qty: '1', unit: 'portion' }],
      },
    );
    for (const id of ['top', 'L', 'R', 'base']) expect(err(p, id)?.code, id).toBe('cycle');
    expect(String(err(p, 'base')?.params?.cycle)).toMatch(/^Base → Top → [LR] → Base$/);
    expect(err(p, 'syrup')).toBeUndefined();
  });
  it('20 levels of nesting are allowed; 21 are refused clearly', () => {
    expect(err(chain(21), 'c0')).toBeUndefined(); // c0 → … → c20: nesting 20
    expect(err(chain(22), 'c0')).toMatchObject({ code: 'too-deep-nesting' });
    expect(err(chain(22), 'c1')).toBeUndefined();
  });
  it('the checker agrees on the nesting limit and cycles', () => {
    const deep = compile(chain(22));
    expect(new Checker(deep).recipe('c0')).toBe('too-deep');
    expect(typeof new Checker(deep).recipe('c1')).toBe('object');
    expect(new Checker(compile(chain(3, 1))).recipe('c0')).toBe('cycle');
  });
});

const randomRuns = Number(process.env.SAUCEPENNY_PROPERTY_RUNS ?? 3000);

describe(`engine = independent checker on ${randomRuns} random DAG projects (exact)`, () => {
  it('every recipe total, per-unit cost and line cost is identical', () => {
    let recipes = 0;
    fc.assert(
      fc.property(projectArb(), (stored) => {
        const v = verifiedRecipes(compile(stored));
        for (const [id, r] of v) {
          if (r.status === 'mismatch') throw new Error(`${id}: ${r.detail}`);
          if (r.status === 'ok') recipes++;
        }
        return true;
      }),
      { numRuns: randomRuns },
    );
    expect(recipes).toBeGreaterThan(randomRuns);
  });
  it('deep chains with diamonds (depth up to 20) agree too', () => {
    fc.assert(
      fc.property(projectArb({ maxRecipes: 24, maxLines: 3, maxIngredients: 3 }), (stored) => {
        for (const [id, r] of verifiedRecipes(compile(stored)))
          if (r.status === 'mismatch') throw new Error(`${id}: ${r.detail}`);
        return true;
      }),
      { numRuns: Math.max(100, Math.floor(randomRuns / 10)) },
    );
  });
});

describe('engine properties', () => {
  it('scaling every line by k scales the cost by k (linear)', () => {
    fc.assert(
      fc.property(projectArb(), fc.integer({ min: 1, max: 50 }), (stored, k) => {
        const before = costRecipes(compile(stored));
        const last = stored.recipes[stored.recipes.length - 1]!;
        const s2 = clone(stored);
        const l2 = s2.recipes[s2.recipes.length - 1]!;
        for (let j = 0; j < l2.lines.length; j++)
          l2.lines[j]!.qty = timesInt(last.lines[j]!.qty, k);
        const after = costRecipes(compile(s2));
        const a = before.get(last.id)!;
        const b = after.get(last.id)!;
        if (!a.ok || !b.ok) return a.ok === b.ok;
        return eq(b.total, mul(a.total, rat(BigInt(k))));
      }),
      { numRuns: 500 },
    );
  });
  it('a recipe costs the sum of its lines costed separately (additive)', () => {
    fc.assert(
      fc.property(projectArb(), (stored) => {
        const last = stored.recipes.length - 1;
        const full = costRecipes(compile(stored)).get(`r${last}`)!;
        if (!full.ok) return true;
        let s = ZERO;
        for (let j = 0; j < stored.recipes[last]!.lines.length; j++) {
          const one = clone(stored);
          one.recipes[last]!.lines = [stored.recipes[last]!.lines[j]!];
          const r = costRecipes(compile(one)).get(`r${last}`)!;
          if (!r.ok) return false;
          s = add(s, r.total);
        }
        return eq(s, full.total);
      }),
      { numRuns: 500 },
    );
  });
  it('raising one price never lowers any cost, and leaves unrelated recipes unchanged', () => {
    fc.assert(
      fc.property(
        projectArb(),
        fc.nat(),
        fc.integer({ min: 1, max: 100 }),
        (stored, pick, rise) => {
          const ing = stored.ingredients[pick % stored.ingredients.length]!;
          const before = verifiedRecipes(compile(stored));
          const up = clone(stored);
          up.ingredients[pick % stored.ingredients.length]!.price = toPlain(
            add(dec(ing.price), rat(BigInt(rise))),
          );
          const p2 = compile(up);
          const after = verifiedRecipes(p2);
          const checker = new Checker(p2);
          for (const [id, b] of before) {
            const a = after.get(id)!;
            if (b.status !== 'ok' || a.status !== 'ok') continue;
            const packs = checker.packsFor(id, rat(1n));
            const uses = typeof packs !== 'string' && (packs.get(ing.id)?.n ?? 0n) !== 0n;
            if (!ge(a.total, b.total)) return false;
            if (!uses && !eq(a.total, b.total)) return false;
            if (uses && eq(a.total, b.total)) return false;
          }
          return true;
        },
      ),
      { numRuns: 500 },
    );
  });
});

/** "12.5" × 3 → "37.5", exactly, as decimal text. */
function timesInt(text: string, k: number): string {
  return toPlain(mul(dec(text), rat(BigInt(k))));
}
/** Exact decimal text of a rational with a power-of-ten denominator. */
function toPlain(r: Rational): string {
  let scale = 0n;
  while ((r.n * 10n ** scale) % r.d !== 0n) scale++;
  const n = (r.n * 10n ** scale) / r.d;
  const s = (n < 0n ? -n : n).toString().padStart(Number(scale) + 1, '0');
  const out = scale ? `${s.slice(0, -Number(scale))}.${s.slice(-Number(scale))}` : s;
  return (n < 0n ? '-' : '') + out;
}

// ---------------------------------------------------------------------------------
// Engine mutants: each must fail the hand-worked golden table.
// ---------------------------------------------------------------------------------
const ENGINE_MUTANTS: Mutant[] = [
  {
    name: 'yield multiplied instead of divided',
    file: 'cost/engine.ts',
    from: 'return { dim: u.dim, perBase: div(ing.price, usableBase) };',
    to: 'return { dim: u.dim, perBase: mul(div(ing.price, mul(ing.packQty, u.factor)), ing.yield) };',
  },
  {
    name: 'sub-recipe yield not divided out',
    file: 'cost/engine.ts',
    from: 'perYieldBase: div(total, yieldBase),',
    to: 'perYieldBase: total,',
  },
  {
    name: 'diamond counted once',
    file: 'cost/engine.ts',
    from: 'const hit = memo.get(id);\n    if (hit) return hit;',
    to: 'const hit = memo.get(id);\n    if (hit) return hit.ok ? { ...hit, perYieldBase: ZERO, total: ZERO, lines: [] } : hit;',
  },
  {
    name: 'each line rounded to the cent before adding',
    file: 'cost/engine.ts',
    from: 'const cost = mul(div(mul(qtyBase, unitCost), sub(ONE, line.waste)), line.share);',
    to: 'const cost = rat(ceilInt(mul(mul(div(mul(qtyBase, unitCost), sub(ONE, line.waste)), line.share), rat(100n))), 100n);',
    prepend: "import { ceilInt } from '../num/index';",
  },
  {
    name: 'binary floating point instead of exact',
    file: 'cost/engine.ts',
    from: 'const cost = mul(div(mul(qtyBase, unitCost), sub(ONE, line.waste)), line.share);',
    to: 'const cost = toFloatRat(mul(div(mul(qtyBase, unitCost), sub(ONE, line.waste)), line.share));',
    prepend:
      'const toFloatRat = (r: { n: bigint; d: bigint }) => rat(BigInt(Math.round((Number(r.n) / Number(r.d)) * 1e9)), 10n ** 9n);',
  },
  {
    name: 'waste added instead of divided',
    file: 'cost/engine.ts',
    from: 'const cost = mul(div(mul(qtyBase, unitCost), sub(ONE, line.waste)), line.share);',
    to: 'const cost = mul(mul(mul(qtyBase, unitCost), add(ONE, line.waste)), line.share);',
  },
  {
    name: 'unit conversion direction reversed',
    file: 'cost/units.ts',
    from: 'const base = mul(qty, from.factor);',
    to: 'const base = div(qty, from.factor);',
  },
  {
    name: 'memo keyed by recipe name (same-name recipes share a cost)',
    file: 'cost/engine.ts',
    from: 'memo.set(id, result);',
    to: 'memo.set(id, result);\n    for (const other of project.recipes.values()) if (other.name === recipe.name) memo.set(other.id, result);',
  },
  {
    name: 'density applied the wrong way round',
    file: 'cost/engine.ts',
    from: '{ densityGPerMl: ing.density, pieceWeightG: ing.pieceWeight }',
    to: '{ densityGPerMl: ing.density ? div(rat(1n), ing.density) : undefined, pieceWeightG: ing.pieceWeight }',
  },
];

describe('engine mutation testing', () => {
  it('has at least 8 mutants, each applying exactly once', () => {
    expect(ENGINE_MUTANTS.length).toBeGreaterThanOrEqual(8);
    for (const m of ENGINE_MUTANTS) expect(occurrences(m), m.name).toBe(1);
  });
  for (const m of ENGINE_MUTANTS)
    it(`catches mutant: ${m.name}`, async () => {
      const mod = await loadMutant<typeof cost>(m);
      expect(runEngineGolden(mod).length, `mutant "${m.name}" survived`).toBeGreaterThan(0);
    });
});

// Checker mutants: a broken checker must make the comparison fail (so a matching wrong
// engine could not hide behind it).
const CHECKER_MUTANTS: Mutant[] = [
  {
    name: 'checker ignores line waste',
    file: 'check/index.ts',
    from: 'const keep = sub(rat(1n), line.waste);',
    to: 'const keep = rat(1n); void sub;',
  },
  {
    name: 'checker ignores yield',
    file: 'check/index.ts',
    from: 'this.packCost.set(ing.id, div(ing.price, ing.yield));',
    to: 'this.packCost.set(ing.id, ing.price);',
  },
  {
    name: 'checker forgets the sub-recipe batch size',
    file: 'check/index.ts',
    from: 'const childBatches = div(div(mul(inYieldUnits, batches), child.yieldQty), keep);',
    to: 'const childBatches = div(mul(inYieldUnits, batches), keep);',
  },
  {
    name: 'checker inverts density',
    file: 'check/index.ts',
    from: "if (kind === 'volume') return density;",
    to: "if (kind === 'volume') return density ? div(rat(1n), density) : density;",
  },
];

describe('checker mutation testing', () => {
  for (const m of CHECKER_MUTANTS)
    it(`a broken checker is noticed: ${m.name}`, async () => {
      expect(occurrences(m)).toBe(1);
      const mod = await loadMutant<{ Checker: typeof Checker }>(m);
      const stored = sampleStored();
      stored.recipes[0]!.lines.push({
        ref: { kind: 'ingredient', id: 'soy' },
        qty: '1',
        unit: 'kg',
      });
      stored.recipes[0]!.yieldQty = '2';
      const p = compile(stored);
      const engine = costRecipes(p);
      const checker = new mod.Checker(p);
      const { verifyRecipe } = await import('../src/api');
      const statuses = [...p.recipes.keys()].map(
        (id) => verifyRecipe(p, id, engine.get(id)!, checker as unknown as Checker).status,
      );
      expect(statuses).toContain('mismatch');
    });
});
