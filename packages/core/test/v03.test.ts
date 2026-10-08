// SPDX-License-Identifier: AGPL-3.0-or-later
// v0.3 features: menu engineering (rule 16), sales CSV, supplier price lists. Numbers are
// checked against hand-worked values, and each piece of new logic has mutants that must be
// caught. The Python oracle (tools/oracle) checks the same code on random cases.
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { verifiedMenuEngineering, verifiedProject } from '../src/api';
import * as check from '../src/check/index';
import * as cost from '../src/cost/index';
import { menuEngineering, type MenuEngInput } from '../src/cost/index';
import * as io from '../src/io/index';
import {
  importSalesCsv,
  parseSold,
  readSupplierCsv,
  salesToCsv,
  unitPriceChange,
} from '../src/io/index';
import { validateProject, type Project, type StoredProject } from '../src/model/index';
import { add, dec, div, eq, mul, rat, sub, type Rational } from '../src/num/index';
import { clone, sampleStored } from './helpers/fixtures';
import { cleanupMutants, loadMutant, occurrences, type Mutant } from './helpers/mutate';

afterAll(cleanupMutants);

function compile(p: StoredProject): Project {
  const r = validateProject(p);
  if (!r.ok) throw new Error(JSON.stringify(r.errors.slice(0, 3)));
  return r.value.project;
}
const f = (r: Rational | null | undefined) => (r ? `${r.n}/${r.d}` : String(r));

// ---------------------------------------------------------------------------------------
// Menu engineering
// ---------------------------------------------------------------------------------------
const it4: MenuEngInput[] = [
  { id: 'a', sold: 50, margin: rat(30n) },
  { id: 'b', sold: 30, margin: rat(10n) },
  { id: 'c', sold: 15, margin: rat(40n) },
  { id: 'd', sold: 5, margin: rat(5n) },
];

/** [name, items, expected quadrants by id, average margin "n/d", popular line "n/d"] */
const ME_GOLDEN: [string, MenuEngInput[], Record<string, string>, string, string][] = [
  // total 100; line 0.7 × 1/4 = 7/40 (17.5%); Σ m×s = 1500+300+600+25 = 2425 → avg 97/4
  [
    'four corners',
    it4,
    { a: 'keep', b: 'raise-margin', c: 'promote', d: 'rethink' },
    '97/4',
    '7/40',
  ],
  // n = 2 → line 7/20 = 35%; 35 of 100 sits exactly on it (counts as popular)
  [
    'popular exactly at the line',
    [
      { id: 'x', sold: 35, margin: rat(10n) },
      { id: 'y', sold: 65, margin: rat(20n) },
    ],
    { x: 'raise-margin', y: 'keep' },
    '33/2', // (350 + 1300) / 100
    '7/20',
  ],
  // margins equal to the average count as profitable
  [
    'margin exactly at the average',
    [
      { id: 'x', sold: 1, margin: rat(15n) },
      { id: 'y', sold: 1, margin: rat(10n) },
      { id: 'z', sold: 1, margin: rat(20n) },
    ],
    { x: 'keep', y: 'raise-margin', z: 'keep' },
    '15/1',
    '7/30',
  ],
  // one below the line: 10 items, line 7/100; 6 of 100 is not popular, 7 is
  [
    'ten items around 7%',
    [6, 7, 12, 10, 10, 10, 10, 10, 10, 15].map((sold, k) => ({
      id: `m${k}`,
      sold,
      margin: rat(k === 0 || k === 1 ? 50n : 1n),
    })),
    {
      m0: 'promote',
      m1: 'keep',
      m2: 'raise-margin',
      m3: 'raise-margin',
      m4: 'raise-margin',
      m5: 'raise-margin',
      m6: 'raise-margin',
      m7: 'raise-margin',
      m8: 'raise-margin',
      m9: 'raise-margin',
    },
    '737/100', // (6×50 + 7×50 + 87×1) / 100
    '7/100',
  ],
  // negative margins (sold below cost) are allowed; the average is weighted
  [
    'negative margins',
    [
      { id: 'x', sold: 3, margin: rat(-2n) },
      { id: 'y', sold: 1, margin: dec('4.5') },
    ],
    { x: 'raise-margin', y: 'promote' },
    '-3/8', // (-6 + 4.5) / 4
    '7/20',
  ],
  // an item with no sales: never popular
  [
    'zero sold',
    [
      { id: 'x', sold: 0, margin: rat(100n) },
      { id: 'y', sold: 9, margin: rat(1n) },
    ],
    { x: 'promote', y: 'keep' },
    '1/1',
    '7/20',
  ],
];

function runMenuEngGolden(engine: typeof cost): string[] {
  const fails: string[] = [];
  for (const [name, items, quads, avg, line] of ME_GOLDEN) {
    let r;
    try {
      r = engine.menuEngineering(items);
    } catch (e) {
      fails.push(`${name}: threw ${String(e)}`);
      continue;
    }
    if (!r.ok) {
      fails.push(`${name}: ${r.reason}`);
      continue;
    }
    if (f(r.averageMargin) !== avg) fails.push(`${name}: avg ${f(r.averageMargin)}`);
    if (f(r.popularLine) !== line) fails.push(`${name}: line ${f(r.popularLine)}`);
    for (const row of r.rows)
      if (quads[row.id] !== row.quadrant) fails.push(`${name}: ${row.id} ${row.quadrant}`);
    const total = items.reduce((s, x) => s + x.sold, 0);
    for (const row of r.rows) {
      if (!eq(row.mix, rat(BigInt(row.sold), BigInt(total)))) fails.push(`${name}: mix ${row.id}`);
      if (!eq(row.totalMargin, mul(row.margin, rat(BigInt(row.sold)))))
        fails.push(`${name}: total ${row.id}`);
    }
  }
  try {
    const empty = engine.menuEngineering([]);
    if (empty.ok || empty.reason !== 'no-items') fails.push('empty list');
    const none = engine.menuEngineering([{ id: 'a', sold: 0, margin: rat(1n) }]);
    if (none.ok || none.reason !== 'no-sales') fails.push('no sales');
  } catch (e) {
    fails.push(`empty threw ${String(e)}`);
  }
  return fails;
}

describe('menu engineering (rule 16)', () => {
  it('matches the hand-worked table', () => {
    expect(runMenuEngGolden(cost)).toEqual([]);
  });

  it('the checker agrees with the hand-worked quadrants', () => {
    for (const [name, items, quads] of ME_GOLDEN) {
      const c = check.recomputeMenuEngineering(items)!;
      expect(Object.fromEntries(c.quadrants), name).toEqual(quads);
    }
    expect(check.recomputeMenuEngineering([])).toBeNull();
    expect(check.recomputeMenuEngineering([{ id: 'a', sold: 0, margin: rat(1n) }])).toBeNull();
  });

  it('uses verified margins from the project and lists what it leaves out', () => {
    const s = sampleStored();
    s.menu.push({ ...clone(s.menu[0]!), id: 'm3', name: '試食', price: '0' });
    s.menu.push({ ...clone(s.menu[0]!), id: 'm4', name: '壞的', portionUnit: 'g' });
    const p = compile(s);
    const v = verifiedProject(p);
    const r = verifiedMenuEngineering(
      v,
      new Map([
        ['m1', 120],
        ['m2', 300],
      ]),
    );
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.excluded).toEqual([
      { id: 'm3', reason: 'no-price' },
      { id: 'm4', reason: 'not-costed' },
    ]);
    const m1 = v.menu.get('m1')!;
    const m2 = v.menu.get('m2')!;
    if (m1.status !== 'ok' || m2.status !== 'ok') throw new Error('sample not ok');
    // net price of m2 = 22 ÷ 1.1 = 20 (service included)
    expect(eq(m2.netPrice, rat(20n))).toBe(true);
    expect(eq(r.rows[1]!.margin, sub(rat(20n), m2.portionCost))).toBe(true);
    const avg = div(
      add(mul(m1.grossProfit!, rat(120n)), mul(m2.grossProfit!, rat(300n))),
      rat(420n),
    );
    expect(eq(r.averageMargin, avg)).toBe(true);
    expect(r.rows.map((x) => x.quadrant)).toEqual(['promote', 'raise-margin']);
    expect(r.totalSold).toBe(420);
  });

  it('no sales and no items are reported, not divided by zero', () => {
    const v = verifiedProject(compile(sampleStored()));
    expect(verifiedMenuEngineering(v, new Map())).toMatchObject({
      status: 'empty',
      reason: 'no-sales',
    });
    const s = sampleStored();
    s.menu = [];
    expect(verifiedMenuEngineering(verifiedProject(compile(s)), new Map())).toMatchObject({
      status: 'empty',
      reason: 'no-items',
    });
  });

  it('refuses counts that are not whole non-negative numbers', () => {
    const v = verifiedProject(compile(sampleStored()));
    for (const bad of [-1, 1.5, Number.NaN, 2 ** 60])
      expect(verifiedMenuEngineering(v, new Map([['m1', bad]])).status).toBe('mismatch');
  });

  it('flags a wrong engine result (the checker is independent)', () => {
    const v = verifiedProject(compile(sampleStored()));
    const sold = new Map([
      ['m1', 120],
      ['m2', 300],
    ]);
    type R = Extract<ReturnType<typeof menuEngineering>, { ok: true }>;
    const broken: ((r: R) => R)[] = [
      (r) => ({ ...r, rows: r.rows.map((x, k) => (k ? x : { ...x, quadrant: 'keep' })) }),
      (r) => ({ ...r, averageMargin: add(r.averageMargin, rat(1n, 1000n)) }),
      (r) => ({ ...r, totalMargin: add(r.totalMargin, rat(1n)) }),
      (r) => ({ ...r, totalSold: r.totalSold + 1 }),
      (r) => ({ ...r, rows: r.rows.map((x) => ({ ...x, mix: rat(1n, 2n) })) }),
      (r) => ({ ...r, rows: r.rows.map((x) => ({ ...x, totalMargin: x.margin })) }),
      (r) => ({ ...r, rows: r.rows.slice(1) }),
      (r) => ({ ...r, rows: [...r.rows].reverse() }),
    ];
    for (const [k, b] of broken.entries()) {
      const engine: typeof menuEngineering = (items) => {
        const r = menuEngineering(items);
        return r.ok ? b(r) : r;
      };
      expect(verifiedMenuEngineering(v, sold, engine).status, `broken ${k}`).toBe('mismatch');
    }
    expect(
      verifiedMenuEngineering(v, new Map(), () =>
        menuEngineering([{ id: 'm1', sold: 1, margin: rat(1n) }]),
      ).status,
    ).toBe('mismatch');
    expect(verifiedMenuEngineering(v, sold, () => ({ ok: false, reason: 'no-sales' })).status).toBe(
      'mismatch',
    );
  });

  it('property: engine and checker agree; each quadrant follows the two rules', () => {
    const item = fc.record({
      sold: fc.integer({ min: 0, max: 100000 }),
      n: fc.integer({ min: -100000, max: 100000 }),
      d: fc.constantFrom(1, 2, 10, 100),
    });
    fc.assert(
      fc.property(fc.array(item, { minLength: 1, maxLength: 15 }), (arr) => {
        const items = arr.map((x, k) => ({
          id: `i${k}`,
          sold: x.sold,
          margin: rat(BigInt(x.n), BigInt(x.d)),
        }));
        const r = menuEngineering(items);
        const c = check.recomputeMenuEngineering(items);
        if (!r.ok) return c === null && r.reason === 'no-sales';
        if (!c) return false;
        return r.rows.every((x) => c.quadrants.get(x.id) === x.quadrant);
      }),
      { numRuns: 300 },
    );
  });
});

const ME_MUTANTS: Mutant[] = [
  {
    name: 'popularity boundary strict',
    file: 'cost/menu-eng.ts',
    from: 'const popular = ge(mix, popularLine);',
    to: 'const popular = !ge(popularLine, mix);',
  },
  {
    name: 'profitability boundary strict',
    file: 'cost/menu-eng.ts',
    from: 'const profitable = ge(x.margin, averageMargin);',
    to: 'const profitable = !ge(averageMargin, x.margin);',
  },
  {
    name: '80% popularity line',
    file: 'cost/menu-eng.ts',
    from: 'rat(7n, 10n);',
    to: 'rat(8n, 10n);',
  },
  {
    name: 'line not divided by the number of items',
    file: 'cost/menu-eng.ts',
    from: 'div(POPULARITY_FACTOR, rat(BigInt(items.length)))',
    to: 'div(POPULARITY_FACTOR, rat(BigInt(items.length + 1)))',
  },
  {
    name: 'average margin not weighted by sales',
    file: 'cost/menu-eng.ts',
    from: 'add(s, mul(x.margin, rat(BigInt(x.sold)))), ZERO)',
    to: 'add(s, x.margin), ZERO)',
  },
  {
    name: 'popular quadrants swapped',
    file: 'cost/menu-eng.ts',
    from: "(profitable ? 'keep' : 'raise-margin')",
    to: "(profitable ? 'raise-margin' : 'keep')",
  },
  {
    name: 'unpopular quadrants swapped',
    file: 'cost/menu-eng.ts',
    from: ": profitable ? 'promote' : 'rethink';",
    to: ": profitable ? 'rethink' : 'promote';",
  },
  {
    name: 'no-sales guard removed',
    file: 'cost/menu-eng.ts',
    from: "if (totalSold === 0) return { ok: false, reason: 'no-sales' };",
    to: ';',
  },
];

describe('menu engineering engine mutants are caught', () => {
  for (const m of ME_MUTANTS)
    it(m.name, async () => {
      expect(occurrences(m), `mutant "${m.name}" must apply once`).toBe(1);
      const mod = await loadMutant<typeof cost>(m);
      expect(runMenuEngGolden(mod).length, `mutant "${m.name}" survived`).toBeGreaterThan(0);
    });
});

const ME_CHECK_MUTANTS: Mutant[] = [
  {
    name: 'checker popularity strict',
    file: 'check/index.ts',
    from: 'const popular = 10n * n * BigInt(x.sold) >= 7n * totalSold;',
    to: 'const popular = 10n * n * BigInt(x.sold) > 7n * totalSold;',
  },
  {
    name: 'checker profitability strict',
    file: 'check/index.ts',
    from: 'const profitable = cmp(mul(x.margin, rat(totalSold)), marginSum) >= 0;',
    to: 'const profitable = cmp(mul(x.margin, rat(totalSold)), marginSum) > 0;',
  },
  {
    name: 'checker margin sum skips the first item',
    file: 'check/index.ts',
    from: 'for (let i = items.length - 1; i >= 0; i--)',
    to: 'for (let i = items.length - 1; i >= 1; i--)',
  },
];

describe('menu engineering checker mutants are caught', () => {
  for (const m of ME_CHECK_MUTANTS)
    it(m.name, async () => {
      expect(occurrences(m), `mutant "${m.name}" must apply once`).toBe(1);
      const mod = await loadMutant<typeof check>(m);
      const fails: string[] = [];
      for (const [name, items, quads, avg] of ME_GOLDEN) {
        const c = mod.recomputeMenuEngineering(items)!;
        if (JSON.stringify(Object.fromEntries(c.quadrants)) !== JSON.stringify(quads))
          fails.push(name);
        const total = items.reduce((s, x) => s + x.sold, 0);
        if (f(div(c.marginSum, rat(BigInt(total)))) !== avg) fails.push(`${name} sum`);
      }
      expect(fails.length, `mutant "${m.name}" survived`).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------------------
// Sales CSV
// ---------------------------------------------------------------------------------------
const MENU = [
  { id: 'm1', name: '叉燒飯' },
  { id: 'm2', name: 'Milk Tea' },
  { id: 'm3', name: 'Egg tart' },
  { id: 'm4', name: 'egg TART ' }, // same name as m3 once normalised
  { id: 'm5', name: '=Special' }, // exported as '=Special so spreadsheets do not run it
];

function runSalesGolden(mod: typeof io): string[] {
  const fails: string[] = [];
  const t = (
    name: string,
    text: string,
    sold: Record<string, number>,
    problems: string[],
    merged: string[] = [],
  ) => {
    const r = mod.importSalesCsv(text, MENU);
    const got = {
      sold: Object.fromEntries(r.sold),
      problems: r.problems.map((p) =>
        p.kind === 'row'
          ? `${p.line}:${p.code}`
          : p.kind === 'header'
            ? `header:${p.column}`
            : 'csv',
      ),
      merged: [...r.merged].sort(),
    };
    const want = { sold, problems, merged };
    if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: ${JSON.stringify(got)}`);
  };
  t('english', 'item,sold\r\n叉燒飯,12\r\nMilk Tea,30\r\n', { m1: 12, m2: 30 }, []);
  t('chinese headers and BOM', '\uFEFF項目,售出\n叉燒飯,１２\n', { m1: 12 }, []);
  t('columns swapped, extra column', 'note,qty,name\nx,"1,200",milk  tea\n', { m2: 1200 }, []);
  t('match by id', 'item,sold\nm2,5\n', { m2: 5 }, []);
  t('duplicates added', 'item,sold\n叉燒飯,2\n叉燒飯,3\n', { m1: 5 }, [], ['m1']);
  t('full-width letters', 'item,sold\nＭｉｌｋ Ｔｅａ,4\n', { m2: 4 }, []);
  t('neutralised export', "item,sold\n'=Special,1\n", { m5: 1 }, []);
  t('unknown item', 'item,sold\nSoup,3\n叉燒飯,1\n', { m1: 1 }, ['2:unknown-item']);
  t('ambiguous name', 'item,sold\negg tart,3\nm3,2\n', { m3: 2 }, ['2:ambiguous-item']);
  t(
    'bad counts',
    'item,sold\n叉燒飯,-1\n叉燒飯,1.5\n叉燒飯,"1,2"\n叉燒飯,abc\n叉燒飯,\n叉燒飯,0\n',
    { m1: 0 },
    ['2:bad-sold', '3:bad-sold', '4:bad-sold', '5:bad-sold', '6:bad-sold'],
  );
  t(
    'limit',
    'item,sold\n叉燒飯,1000000000\n叉燒飯,1\nMilk Tea,1000000001\n',
    { m1: 1_000_000_000 },
    ['3:too-many-sold', '4:too-many-sold'],
  );
  t('blank rows skipped', 'item,sold\n\n,\n叉燒飯,1\n', { m1: 1 }, []);
  t('missing columns', 'dish name,price\n叉燒飯,1\n', {}, ['header:item', 'header:sold']);
  t('missing sold', 'item,price\n叉燒飯,1\n', {}, ['header:sold']);
  t('csv error', 'item,sold\n"叉燒飯,1\n', {}, ['csv']);
  if (mod.parseSold('1000000001') !== 'too-many') fails.push('one count over the limit');
  return fails;
}

describe('sales CSV', () => {
  it('matches the hand-worked table', () => {
    expect(runSalesGolden(io)).toEqual([]);
  });

  it('whole numbers only, commas between groups of three', () => {
    expect(parseSold('0')).toBe(0);
    expect(parseSold('１２３')).toBe(123);
    expect(parseSold('1,234,567')).toBe(1234567);
    expect(parseSold('１，２３４')).toBe(1234);
    for (const bad of ['', ' ', '-1', '+1', '1.0', '1e3', '12,34', ',123', '1,,234', 'NaN'])
      expect(parseSold(bad), bad).toBe('bad');
    expect(parseSold('1000000001')).toBe('too-many');
  });

  it('round trip: export then import gives the same counts', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 3, maxLength: 3 }),
        fc.boolean(),
        (counts, zh) => {
          const rows = MENU.slice(0, 3).map((m, k) => ({ name: m.name, sold: counts[k]! }));
          const r = importSalesCsv(salesToCsv(rows, zh), MENU.slice(0, 3));
          return (
            r.problems.length === 0 &&
            MENU.slice(0, 3).every((m, k) => r.sold.get(m.id) === counts[k])
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('names that look like formulas survive the round trip', () => {
    const menu = [{ id: 'x', name: '=1+1' }];
    const r = importSalesCsv(salesToCsv([{ name: '=1+1', sold: 3 }], false), menu);
    expect(r.sold.get('x')).toBe(3);
  });
});

const SALES_MUTANTS: Mutant[] = [
  {
    name: 'duplicates replace instead of add',
    file: 'io/sales.ts',
    from: 'const total = (prev ?? 0) + n;',
    to: 'const total = n;',
  },
  {
    name: 'shared names matched to the last item',
    file: 'io/sales.ts',
    from: 'byName.set(k, byName.has(k) ? null : m.id);',
    to: 'byName.set(k, m.id);',
  },
  {
    name: 'names compared case-sensitively',
    file: 'io/sales.ts',
    from: ".replace(/\\s+/g, ' ').toLowerCase();",
    to: ".replace(/\\s+/g, ' ');",
  },
  {
    name: 'loose commas accepted',
    file: 'io/sales.ts',
    from: 'if (!/^(\\d+|\\d{1,3}(,\\d{3})+)$/.test(t))',
    to: 'if (!/^[\\d,]+$/.test(t))',
  },
  {
    name: 'limit 10× too high',
    file: 'io/sales.ts',
    from: "return n > MAX_SOLD ? 'too-many' : n;",
    to: "return n > MAX_SOLD * 10 ? 'too-many' : n;",
  },
  {
    name: 'sum over the limit accepted',
    file: 'io/sales.ts',
    from: 'if (total > MAX_SOLD) {',
    to: 'if (false) {',
  },
  {
    name: 'merged rows not reported',
    file: 'io/sales.ts',
    from: 'if (prev !== undefined) merged.add(id);',
    to: ';',
  },
  {
    name: 'neutralised names not restored',
    file: 'io/sales.ts',
    from: "if (/^'[=+\\-@]/.test(item)) item = item.slice(1);",
    to: ';',
  },
  {
    name: 'qty header not recognised',
    file: 'io/sales.ts',
    from: "  'qty',\n",
    to: "  'qtyX',\n",
  },
];

describe('sales CSV mutants are caught', () => {
  for (const m of SALES_MUTANTS)
    it(m.name, async () => {
      expect(occurrences(m), `mutant "${m.name}" must apply once`).toBe(1);
      const mod = await loadMutant<typeof io>(m);
      expect(runSalesGolden(mod).length, `mutant "${m.name}" survived`).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------------------
// Supplier price lists
// ---------------------------------------------------------------------------------------
const CATTY_G = rat(60478982n, 100000n);

function runSupplierGolden(mod: typeof io): string[] {
  const fails: string[] = [];
  const s = sampleStored();
  s.ingredients[1]!.priceDate = '2026-09-01';
  const p = compile(s);
  const ing = (id: string) => p.ingredients.get(id)!;
  const csv =
    'name,pack qty,unit,price,price date,code\n' +
    '砂糖,2,kg,26,2026-10-01,S-1\n' + // line 2: sugar 12/kg → 13/kg
    '梅頭肉,1,kg,120,,P-9\n' + // line 3: pork per catty → per kg
    '雞蛋,1,kg,40,,E-1\n' + // line 4: eggs by piece → by kg: not comparable
    'Lemon,1,piece,4,,L-1\n' + // line 5: saved match → lemon, same price
    '水,1,l,0.5,,W\n' + // line 6: water was 0
    'Unknown thing,1,kg,9,,X\n'; // line 7: no match
  const r = mod.readSupplierCsv(csv, s.ingredients, { lemon: 'lemon', 'unknown thing': 'gone' });
  const got = r.rows.map((x) => `${x.line}:${x.match}:${x.matchedBy}`);
  const want = [
    '2:sugar:name',
    '3:pork:name',
    '4:egg:name',
    '5:lemon:saved',
    '6:water:name',
    '7:null:null',
  ];
  if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`rows ${JSON.stringify(got)}`);
  if (!r.problems.some((x) => x.kind === 'header' && x.code === 'csv-unknown-column'))
    fails.push('code column not reported');
  const row = (k: number) => r.rows[k]!;
  if (r.rows.length < 6) return [...fails, 'too few rows'];
  const ch = (id: string, k: number) => mod.unitPriceChange(ing(id), row(k), p.measures);
  const sugar = ch('sugar', 0);
  if (sugar.status !== 'ok' || f(sugar.change) !== '1/12' || f(sugar.before) !== '3/250')
    fails.push(`sugar ${JSON.stringify(sugar, (_, v) => (typeof v === 'bigint' ? `${v}` : v))}`);
  const pork = ch('pork', 1);
  // 120 per 1000 g vs 68 per catty: change = 0.12 × catty ÷ 68 − 1
  const porkWant = sub(div(mul(dec('0.12'), CATTY_G), rat(68n)), rat(1n));
  if (pork.status !== 'ok' || !eq(pork.change!, porkWant)) fails.push('pork change');
  if (ch('egg', 2).status !== 'not-comparable') fails.push('egg should not compare');
  const lemon = ch('lemon', 3);
  if (lemon.status !== 'ok' || f(lemon.change) !== '0/1') fails.push('lemon change');
  const water = ch('water', 4);
  if (water.status !== 'ok' || water.change !== null) fails.push('water change');

  const before = JSON.stringify(s);
  const applied = mod.applySupplierPrices(
    s,
    [
      { ingredientId: 'sugar', row: row(0) },
      { ingredientId: 'pork', row: row(1) },
      { ingredientId: 'lemon', row: row(3) },
      { ingredientId: 'water', row: row(4) },
    ],
    '2026-10-08',
  );
  if (JSON.stringify(s) !== before) fails.push('input changed');
  if (!applied.ok) return [...fails, `apply ${applied.code}`];
  if (applied.changed.join() !== 'sugar,pork,water')
    fails.push(`changed ${applied.changed.join()}`);
  if (applied.unchanged.join() !== 'lemon') fails.push(`unchanged ${applied.unchanged.join()}`);
  const by = (id: string) => applied.project.ingredients.find((g) => g.id === id)!;
  const sg = by('sugar');
  if (
    sg.price !== '26' ||
    sg.packQty !== '2' ||
    sg.priceDate !== '2026-10-01' ||
    JSON.stringify(sg.priceHistory) !==
      JSON.stringify([{ date: '2026-09-01', price: '12', packQty: '1', packUnit: 'kg' }])
  )
    fails.push(`sugar applied ${JSON.stringify(sg)}`);
  const pk = by('pork');
  if (
    pk.packUnit !== 'kg' ||
    pk.priceDate !== '2026-10-08' ||
    JSON.stringify(pk.priceHistory) !==
      JSON.stringify([{ date: '2026-10-08', price: '68', packQty: '1', packUnit: 'catty' }])
  )
    fails.push(`pork applied ${JSON.stringify(pk)}`);
  const wt = by('water');
  if (wt.price !== '0.5' || wt.priceHistory !== undefined) fails.push('water history');
  const lm = by('lemon');
  if (lm.priceHistory !== undefined || lm.priceDate !== undefined) fails.push('lemon touched');
  if (!validateProject(applied.project).ok) fails.push('result invalid');
  const dup = mod.applySupplierPrices(
    s,
    [
      { ingredientId: 'sugar', row: row(0) },
      { ingredientId: 'sugar', row: row(1) },
    ],
    '2026-10-08',
  );
  if (dup.ok || dup.code !== 'duplicate-target') fails.push('duplicate accepted');
  const unknown = mod.applySupplierPrices(s, [{ ingredientId: 'nope', row: row(0) }], '2026-10-08');
  if (unknown.ok || unknown.code !== 'unknown-ingredient') fails.push('unknown accepted');
  // 12.0 vs 12 is the same price
  const same = mod.applySupplierPrices(
    s,
    [{ ingredientId: 'sugar', row: { price: '12.0', packQty: '1', packUnit: 'kg' } }],
    '2026-10-08',
  );
  if (!same.ok || same.changed.length) fails.push('12.0 counted as a change');
  return fails;
}

describe('supplier price lists', () => {
  it('matches the hand-worked table', () => {
    expect(runSupplierGolden(io)).toEqual([]);
  });

  it('two ingredients with the same name are not matched automatically', () => {
    const s = sampleStored();
    s.ingredients.push({ ...clone(s.ingredients[1]!), id: 'sugar2' });
    const r = readSupplierCsv('name,pack qty,unit,price\n砂糖,1,kg,13\n', s.ingredients);
    expect(r.rows[0]!.match).toBeNull();
  });

  it('a remembered match to a deleted ingredient falls back to the name', () => {
    const s = sampleStored();
    const r = readSupplierCsv('name,pack qty,unit,price\n砂糖,1,kg,13\n', s.ingredients, {
      砂糖: 'deleted-id',
    });
    expect(r.rows[0]).toMatchObject({ match: 'sugar', matchedBy: 'name' });
  });

  it('rows with errors are reported and left out', () => {
    const s = sampleStored();
    const r = readSupplierCsv(
      'item,pack size,unit,cost\n砂糖,1,kg,abc\n砂糖,1,bushel,3\n砂糖,½,kg,7\n',
      s.ingredients,
    );
    expect(r.rows.map((x) => [x.line, x.packQty, x.price])).toEqual([[4, '1/2', '7']]);
    expect(
      r.problems.filter((x) => x.kind === 'row').map((x) => x.kind === 'row' && x.line),
    ).toEqual([2, 3]);
  });

  it('a project measure as pack unit compares by its size', () => {
    const s = sampleStored();
    s.measures = [{ id: 'bag', name: '包', amount: '5', unit: 'kg' }];
    const p = compile(s);
    const r = unitPriceChange(
      p.ingredients.get('sugar')!,
      { price: '50', packQty: '1', packUnit: 'measure:bag' },
      p.measures,
    );
    // 12 per kg → 10 per kg
    expect(r.status === 'ok' && f(r.change)).toBe('-1/6');
  });

  it('property: price per base unit change equals the one-step ratio', () => {
    const p = compile(sampleStored());
    const sugar = p.ingredients.get('sugar')!;
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100000 }),
        fc.integer({ min: 1, max: 5000 }),
        fc.constantFrom('g', 'kg', 'catty', 'tael', 'lb', 'oz'),
        (cents, qty, unit) => {
          const r = unitPriceChange(
            sugar,
            { price: `${cents / 100}`, packQty: `${qty}`, packUnit: unit },
            p.measures,
          );
          return r.status === 'ok';
        },
      ),
      { numRuns: 200 },
    );
  });
});

const SUPPLIER_MUTANTS: Mutant[] = [
  {
    name: 'remembered match ignored',
    file: 'io/supplier.ts',
    from: 'const match = remembered && ids.has(remembered) ? remembered : byN;',
    to: 'const match = byN;',
  },
  {
    name: 'remembered match to a deleted ingredient kept',
    file: 'io/supplier.ts',
    from: 'remembered && ids.has(remembered) ?',
    to: 'remembered ?',
  },
  {
    name: 'compares across kinds of unit',
    file: 'io/supplier.ts',
    from: 'if (a.dim !== b.dim || ing.packQty.n === 0n)',
    to: 'if (ing.packQty.n === 0n)',
  },
  {
    name: 'old price uses the new unit size',
    file: 'io/supplier.ts',
    from: 'const before = div(ing.price, mul(ing.packQty, a.factor));',
    to: 'const before = div(ing.price, mul(ing.packQty, b.factor));',
  },
  {
    name: '0 placeholder kept in history',
    file: 'io/supplier.ts',
    from: '!oldPrice.ok || oldPrice.value.n === 0n',
    to: '!oldPrice.ok',
  },
  {
    name: 'row date ignored',
    file: 'io/supplier.ts',
    from: 'priceDate: pick.row.priceDate || today',
    to: 'priceDate: today',
  },
  {
    name: 'duplicate target accepted',
    file: 'io/supplier.ts',
    from: 'if (seen.has(pick.ingredientId))',
    to: 'if (false)',
  },
  {
    name: 'unchanged rows applied',
    file: 'io/supplier.ts',
    from: 'if (samePrice(old, updated)) {',
    to: 'if (false) {',
  },
  {
    name: 'ingredient changed in place',
    file: 'io/supplier.ts',
    from: 'const ingredients = project.ingredients.map((g) => ({ ...g }));',
    to: 'const ingredients = project.ingredients;',
  },
];

describe('supplier mutants are caught', () => {
  for (const m of SUPPLIER_MUTANTS)
    it(m.name, async () => {
      expect(occurrences(m), `mutant "${m.name}" must apply once`).toBe(1);
      const mod = await loadMutant<typeof io>(m);
      expect(runSupplierGolden(mod).length, `mutant "${m.name}" survived`).toBeGreaterThan(0);
    });
});
