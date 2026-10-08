// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { dec, eq, mul, rat, toFraction, formatFixed } from '../src/num/index';
import * as units from '../src/units/index';
import { convert, parseUnit, UNIT_IDS, UNITS, type UnitId } from '../src/units/index';
import { cleanupMutants, loadMutant, occurrences, type Mutant } from './helpers/mutate';

afterAll(cleanupMutants);
type UnitsModule = typeof units;

/**
 * Hand-checked against the primary sources (docs/units.md):
 * Cap. 68 First Schedule (lb, oz, catty, tael) and NIST HB 44 App. C (US volume).
 */
const CONSTANTS: [UnitId, string][] = [
  ['mg', '0.001'],
  ['g', '1'],
  ['kg', '1000'],
  ['lb', '453.59237'],
  ['oz', '28.349523125'],
  ['catty', '604.78982'],
  ['tael', '37.79936375'],
  ['ml', '1'],
  ['l', '1000'],
  ['floz', '29.5735295625'],
  ['cup', '236.5882365'],
  ['tbsp', '14.78676478125'],
  ['tsp', '4.92892159375'],
  ['piece', '1'],
];

/** [qty, from, to, expected exact decimal] — worked out by hand. */
const CONVERSIONS: [string, UnitId, UnitId, string][] = [
  ['1', 'catty', 'tael', '16'],
  ['1', 'catty', 'g', '604.78982'],
  ['5', 'catty', 'kg', '3.0239491'],
  ['8', 'tael', 'catty', '0.5'],
  ['1', 'lb', 'oz', '16'],
  ['1', 'kg', 'g', '1000'],
  ['250', 'g', 'kg', '0.25'],
  ['1', 'tbsp', 'tsp', '3'],
  ['1', 'floz', 'tbsp', '2'],
  ['1', 'cup', 'floz', '8'],
  ['1', 'cup', 'tbsp', '16'],
  ['1', 'cup', 'tsp', '48'],
  ['2', 'l', 'ml', '2000'],
  ['128', 'floz', 'ml', '3785.411784'],
  ['1', 'lb', 'kg', '0.45359237'],
  ['3', 'tsp', 'ml', '14.78676478125'],
];

function runUnitsGolden(m: UnitsModule): string[] {
  const fails: string[] = [];
  for (const [id, want] of CONSTANTS)
    if (!eq(m.UNITS[id].factor, dec(want)))
      fails.push(`${id}: ${toFraction(m.UNITS[id].factor)} != ${want}`);
  for (const [q, from, to, want] of CONVERSIONS) {
    const r = m.convert(dec(q), from, to);
    if (!r.ok || !eq(r.value, dec(want)))
      fails.push(`${q} ${from} → ${to}: ${r.ok ? toFraction(r.value) : r.error.code} != ${want}`);
  }
  // Mass ↔ volume with density 0.92 g/ml (cooking oil, invented example).
  const oil = m.convert(dec('1'), 'l', 'g', { densityGPerMl: dec('0.92') });
  if (!oil.ok || !eq(oil.value, dec('920'))) fails.push('1 L oil at 0.92 g/ml != 920 g');
  const oilBack = m.convert(dec('460'), 'g', 'ml', { densityGPerMl: dec('0.92') });
  if (!oilBack.ok || !eq(oilBack.value, dec('500'))) fails.push('460 g oil != 500 ml');
  // Count ↔ mass with 55 g per egg.
  const eggs = m.convert(dec('12'), 'piece', 'kg', { pieceWeightG: dec('55') });
  if (!eggs.ok || !eq(eggs.value, dec('0.66'))) fails.push('12 eggs at 55 g != 0.66 kg');
  const eggsBack = m.convert(dec('110'), 'g', 'piece', { pieceWeightG: dec('55') });
  if (!eggsBack.ok || !eq(eggsBack.value, dec('2'))) fails.push('110 g != 2 eggs');
  // Count ↔ volume needs both.
  const cv = m.convert(dec('2'), 'piece', 'ml', {
    pieceWeightG: dec('50'),
    densityGPerMl: dec('1.25'),
  });
  if (!cv.ok || !eq(cv.value, dec('80'))) fails.push('2 pieces of 50 g at 1.25 g/ml != 80 ml');
  return fails;
}

describe('unit constants (cited in docs/units.md)', () => {
  it('golden constants and conversions', () => {
    expect(runUnitsGolden(units)).toEqual([]);
  });
  it('covers every unit', () => {
    expect(CONSTANTS.map((c) => c[0]).sort()).toEqual([...UNIT_IDS].sort());
  });
  it('1 kg is about 1.65 catties (the customs department rounded figure)', () => {
    const r = convert(rat(1n), 'kg', 'catty');
    expect(r.ok && formatFixed(r.value, 2)).toBe('1.65');
  });
  it('each constant appears in docs/units.md', async () => {
    const { readFileSync } = await import('node:fs');
    const doc = readFileSync(new URL('../../../docs/units.md', import.meta.url), 'utf8');
    for (const [, want] of CONSTANTS.filter(([id]) => !['mg', 'g', 'ml', 'piece'].includes(id)))
      expect(doc, want).toContain(want);
    expect(doc).toContain('Cap. 68');
    expect(doc).toContain('NIST');
  });
});

const qtyArb = fc
  .tuple(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.bigInt({ min: 1n, max: 10n ** 6n }))
  .map(([n, d]) => rat(n, d));
const SAME_DIM: [UnitId, UnitId][] = [];
for (const a of UNIT_IDS)
  for (const b of UNIT_IDS) if (UNITS[a].dimension === UNITS[b].dimension) SAME_DIM.push([a, b]);

describe('conversion properties', () => {
  it(`every same-dimension pair round-trips exactly (${SAME_DIM.length} pairs)`, () => {
    for (const [a, b] of SAME_DIM)
      fc.assert(
        fc.property(qtyArb, (q) => {
          const there = convert(q, a, b);
          if (!there.ok) return false;
          const back = convert(there.value, b, a);
          return back.ok && eq(back.value, q);
        }),
        { numRuns: 60 },
      );
  });
  it('a chain of conversions equals the direct conversion (斤 → 兩 → g = 斤 → g)', () => {
    const triples = fc.tuple(
      fc.constantFrom(...UNIT_IDS),
      fc.constantFrom(...UNIT_IDS),
      fc.constantFrom(...UNIT_IDS),
    );
    const info = { densityGPerMl: dec('1.03'), pieceWeightG: dec('55') };
    fc.assert(
      fc.property(qtyArb, triples, (q, [a, b, c]) => {
        const ab = convert(q, a, b, info);
        if (!ab.ok) return false;
        const abc = convert(ab.value, b, c, info);
        const ac = convert(q, a, c, info);
        return abc.ok && ac.ok && eq(abc.value, ac.value);
      }),
      { numRuns: 3000 },
    );
    const viaTael = convert(rat(3n), 'catty', 'tael');
    const direct = convert(rat(3n), 'catty', 'g');
    const chained = viaTael.ok ? convert(viaTael.value, 'tael', 'g') : viaTael;
    expect(direct.ok && chained.ok && eq(direct.value, chained.value)).toBe(true);
  });
  it('conversion is linear: convert(k·q) = k·convert(q)', () => {
    fc.assert(
      fc.property(qtyArb, qtyArb, fc.constantFrom(...SAME_DIM), (q, k, [a, b]) => {
        const x = convert(mul(k, q), a, b);
        const y = convert(q, a, b);
        return x.ok && y.ok && eq(x.value, mul(k, y.value));
      }),
      { numRuns: 2000 },
    );
  });
});

describe('conversion errors are explicit, never a guess', () => {
  it.each([
    ['g', 'ml', 'needs-density'],
    ['cup', 'kg', 'needs-density'],
    ['piece', 'g', 'needs-piece-weight'],
    ['catty', 'piece', 'needs-piece-weight'],
    ['piece', 'ml', 'needs-piece-weight'],
  ] as [UnitId, UnitId, string][])('%s → %s without data: %s', (from, to, code) => {
    const r = convert(rat(1n), from, to);
    expect(r.ok ? 'ok' : r.error.code).toBe(code);
  });
  it('piece → volume with a weight but no density asks for the density', () => {
    const r = convert(rat(1n), 'piece', 'ml', { pieceWeightG: rat(5n) });
    expect(r.ok ? 'ok' : r.error.code).toBe('needs-density');
  });
  it.each([
    [{ densityGPerMl: rat(0n) }, 'bad-density'],
    [{ densityGPerMl: rat(-1n) }, 'bad-density'],
    [{ pieceWeightG: rat(0n) }, 'bad-piece-weight'],
  ] as [units.ConversionInfo, string][])('rejects non-positive data %#', (info, code) => {
    const r = convert(rat(1n), 'g', 'ml', info);
    expect(r.ok ? 'ok' : r.error.code).toBe(code);
  });
});

describe('typed unit names', () => {
  it.each([
    ['斤', 'catty'],
    ['兩', 'tael'],
    ['两', 'tael'],
    ['KG', 'kg'],
    [' Kg ', 'kg'],
    ['公斤', 'kg'],
    ['fl oz', 'floz'],
    ['FL  OZ', 'floz'],
    ['cup (US)', 'cup'],
    ['杯', 'cup'],
    ['湯匙', 'tbsp'],
    ['茶匙', 'tsp'],
    ['隻', 'piece'],
    ['個', 'piece'],
    ['ｋｇ', 'kg'],
    ['磅', 'lb'],
    ['安士', 'oz'],
  ])('%j → %s', (text, id) => {
    expect(parseUnit(text)).toBe(id);
  });
  it.each(['handful', '', 'toString', '__proto__', 'constructor', 'gallon', '金衡兩'])(
    'unknown %j → undefined',
    (text) => {
      expect(parseUnit(text)).toBeUndefined();
    },
  );
});

const UNIT_MUTANTS: Mutant[] = [
  {
    name: 'tael = catty × 16 (factor reversed)',
    file: 'units/table.ts',
    from: 'const TAEL_G = div(CATTY_G, rat(16n));',
    to: 'const TAEL_G = mul(CATTY_G, rat(16n));',
  },
  {
    name: 'catty = 600 g',
    file: 'units/table.ts',
    from: 'const CATTY_G = rat(60478982n, 100000n);',
    to: 'const CATTY_G = rat(600n);',
  },
  {
    name: 'tael rounded to 37.8 g',
    file: 'units/table.ts',
    from: 'const TAEL_G = div(CATTY_G, rat(16n));',
    to: 'const TAEL_G = rat(378n, 10n);',
  },
  {
    name: 'cup = 240 ml',
    file: 'units/table.ts',
    from: 'const CUP_ML = mul(rat(8n), FLOZ_ML);',
    to: 'const CUP_ML = rat(240n);',
  },
  {
    name: 'conversion direction reversed',
    file: 'units/convert.ts',
    from: 'div(mul(mul(qty, f.factor), dim.value), t.factor)',
    to: 'div(mul(mul(qty, t.factor), dim.value), f.factor)',
  },
  {
    name: 'density applied the wrong way round',
    file: 'units/convert.ts',
    from: 'return { ok: true, value: div(a, b) };',
    to: 'return { ok: true, value: div(b, a) };',
  },
  {
    name: 'imperial fluid ounce (1/20 imperial pint) used',
    file: 'units/table.ts',
    from: 'const FLOZ_ML = div(mul(rat(231n), CUBIC_INCH_ML), rat(128n));',
    to: 'const FLOZ_ML = rat(284130625n, 10000000n);',
  },
  {
    name: 'teaspoon = 1/2 tablespoon',
    file: 'units/table.ts',
    from: 'const TSP_ML = div(TBSP_ML, rat(3n));',
    to: 'const TSP_ML = div(TBSP_ML, rat(2n));',
  },
];

describe('units mutation testing', () => {
  it('has at least 6 mutants, each applying exactly once', () => {
    expect(UNIT_MUTANTS.length).toBeGreaterThanOrEqual(6);
    for (const m of UNIT_MUTANTS) expect(occurrences(m), m.name).toBe(1);
  });
  for (const m of UNIT_MUTANTS)
    it(`catches mutant: ${m.name}`, async () => {
      const mod = await loadMutant<UnitsModule>(m);
      expect(runUnitsGolden(mod).length, `mutant "${m.name}" survived`).toBeGreaterThan(0);
    });
});
