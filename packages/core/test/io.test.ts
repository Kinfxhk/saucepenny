// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import type { VerifiedProject } from '../src/api';
import { verifiedProject } from '../src/api';
import { describeError, MESSAGE_CODES, ZH_CODES } from '../src/i18n/index';
import * as io from '../src/io/index';
import {
  importIngredientsCsv,
  ingredientsToCsv,
  menuCsv,
  menuRows,
  neutralise,
  parseCsv,
  recipeCard,
  textReport,
  toCsv,
} from '../src/io/index';
import { emptyProject, validateProject, type StoredIngredient } from '../src/model/index';
import { sampleStored } from './helpers/fixtures';
import { cleanupMutants, loadMutant, occurrences, type Mutant } from './helpers/mutate';

afterAll(cleanupMutants);

const runs = Number(process.env.SAUCEPENNY_PROPERTY_RUNS ?? 2000);

// [rows, CSV text written with neutralisation]
const WRITE_GOLDEN: [string[][], string][] = [
  [[['a', 'b']], 'a,b\r\n'],
  [[['a,b', 'c']], '"a,b",c\r\n'],
  [[['say "hi"']], '"say ""hi"""\r\n'],
  [[['two\nlines']], '"two\nlines"\r\n'],
  [[['cr\rhere']], '"cr\rhere"\r\n'],
  [[[' padded ']], '" padded "\r\n'],
  [[['=1+2']], "'=1+2\r\n"],
  [[['+1']], "'+1\r\n"],
  [[['-5']], "'-5\r\n"],
  [[['@SUM(A1)']], "'@SUM(A1)\r\n"],
  [[['\tx']], "'\tx\r\n"],
  [[['\rx']], '"\'\rx"\r\n'],
  [[['=HYPERLINK("x")']], '"\'=HYPERLINK(""x"")"\r\n'],
  [[['叉燒', '1,234.50']], '叉燒,"1,234.50"\r\n'],
  [[['']], '\r\n'],
  [[['a'], ['b']], 'a\r\nb\r\n'],
];

// [CSV text, parsed cells]
const PARSE_GOLDEN: [string, string[][]][] = [
  [
    'a,b\r\nc,d\r\n',
    [
      ['a', 'b'],
      ['c', 'd'],
    ],
  ],
  [
    'a,b\nc,d',
    [
      ['a', 'b'],
      ['c', 'd'],
    ],
  ],
  [
    'a,b\rc,d\r',
    [
      ['a', 'b'],
      ['c', 'd'],
    ],
  ],
  ['\uFEFFname,price\r\n', [['name', 'price']]],
  ['"a,b",c', [['a,b', 'c']]],
  ['"say ""hi"""', [['say "hi"']]],
  ['"two\r\nlines",x', [['two\r\nlines', 'x']]],
  ['a,,c', [['a', '', 'c']]],
  ['a,b,', [['a', 'b', '']]],
  ['\r\n\r\na\r\n\r\n', [['a']]],
  ['""', [['']]],
  [',', [['', '']]],
  ['"1,234.50",叉燒', [['1,234.50', '叉燒']]],
];

export function runCsvGolden(m: typeof io): string[] {
  const fails: string[] = [];
  for (const [rows, want] of WRITE_GOLDEN) {
    const got = m.toCsv(rows);
    if (got !== want) fails.push(`write ${JSON.stringify(rows)}: ${JSON.stringify(got)}`);
  }
  for (const [text, want] of PARSE_GOLDEN) {
    const r = m.parseCsv(text);
    const got = r.ok ? r.rows.map((x) => x.cells) : r.error.code;
    if (JSON.stringify(got) !== JSON.stringify(want))
      fails.push(`parse ${JSON.stringify(text)}: ${JSON.stringify(got)}`);
  }
  return fails;
}

describe('CSV (RFC 4180) golden', () => {
  it('writes and parses every golden case', () => expect(runCsvGolden(io)).toEqual([]));
  it('reports broken quoting with the line', () => {
    expect(parseCsv('a,"b\r\nc')).toEqual({
      ok: false,
      error: { code: 'csv-unterminated-quote', line: 1 },
    });
    expect(parseCsv('x\r\na"b"')).toEqual({
      ok: false,
      error: { code: 'csv-stray-quote', line: 2 },
    });
    expect(parseCsv('"a"b')).toEqual({ ok: false, error: { code: 'csv-stray-quote', line: 1 } });
  });
  it('line numbers count line breaks inside quotes', () => {
    const r = parseCsv('h\r\n"a\r\nb"\r\nc\r\n');
    expect(r.ok && r.rows.map((x) => x.line)).toEqual([1, 2, 4]);
  });
  it('BOM option', () => expect(toCsv([['x']], { bom: true })).toBe('\uFEFFx\r\n'));
});

const cellArb = fc.string({
  unit: fc.constantFrom('a', '叉', ',', '"', '\r', '\n', ' ', '=', '+', '-', '@', '\t', '1', '.'),
  maxLength: 8,
});
const rowsArb = fc
  .array(fc.array(cellArb, { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 6 })
  .filter((rows) => rows.every((r) => !(r.length === 1 && r[0] === '')));

describe(`CSV round trip (${runs} runs)`, () => {
  it('parse(write(rows)) = rows when not neutralised', () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const r = parseCsv(toCsv(rows, { neutralise: false, bom: true }));
        return r.ok && JSON.stringify(r.rows.map((x) => x.cells)) === JSON.stringify(rows);
      }),
      { numRuns: runs },
    );
  });
  it('with neutralisation, every formula-like cell comes back prefixed and nothing else changes', () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const r = parseCsv(toCsv(rows));
        return (
          r.ok &&
          JSON.stringify(r.rows.map((x) => x.cells)) ===
            JSON.stringify(rows.map((row) => row.map(neutralise)))
        );
      }),
      { numRuns: runs },
    );
  });
  it('no written cell starts with a formula character', () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const r = parseCsv(toCsv(rows));
        return r.ok && r.rows.every((x) => x.cells.every((c) => !/^[=+\-@\t\r]/.test(c)));
      }),
      { numRuns: runs },
    );
  });
});

const withoutId = (i: StoredIngredient) => {
  const { id, ...rest } = i;
  void id;
  return rest;
};

describe('ingredient CSV import', () => {
  it('handles BOM, CRLF, Chinese headers, 斤, quotes, commas inside quotes, full-width digits and blank lines', () => {
    const text =
      '\uFEFF名稱,包裝數量,單位,價錢,可用率 %,備註\r\n' +
      '梅頭肉,１,斤,６８,90,\r\n' +
      '\r\n' +
      '"生抽, 特級",500,毫升,"1,234.50",,"有""引號"""\r\n' +
      '紅茶葉,1,lb,80,,\r\n' +
      ',,,,,\r\n';
    const r = importIngredientsCsv(text);
    expect(r.problems).toEqual([]);
    expect(r.ingredients).toEqual([
      {
        id: 'ing-1',
        name: '梅頭肉',
        packQty: '1',
        packUnit: 'catty',
        price: '68',
        yieldPercent: '90',
      },
      {
        id: 'ing-2',
        name: '生抽, 特級',
        packQty: '500',
        packUnit: 'ml',
        price: '1234.50',
        note: '有"引號"',
      },
      { id: 'ing-3', name: '紅茶葉', packQty: '1', packUnit: 'lb', price: '80' },
    ]);
  });
  it('English headers in any order, with aliases', () => {
    const r = importIngredientsCsv(
      'Price,Name,Unit,Pack Qty,Density (g/ml)\n12,Sugar,kg,1,\n',
      new Set(['ing-1']),
    );
    expect(r.ingredients).toEqual([
      { id: 'ing-2', name: 'Sugar', packQty: '1', packUnit: 'kg', price: '12' },
    ]);
  });
  it('reports bad rows by line and column and keeps the good ones', () => {
    const r = importIngredientsCsv(
      'name,pack qty,unit,price,yield %\nA,1,kg,1e5,\nB,1,furlong,2,\nC,1,g,3,0\nD,1,g,4,\n,1,g,5,\n',
    );
    expect(r.ingredients.map((i) => i.name)).toEqual(['D']);
    const where = r.problems.map((p) =>
      p.kind === 'row' ? `${p.line}:${p.column}:${p.error.code}` : p.kind,
    );
    expect(where).toEqual([
      '2:price:exponent',
      '3:packUnit:bad-unit',
      '4:yieldPercent:yield-out-of-range',
      '6:name:empty',
    ]);
    const msg = io.describeImportProblem(r.problems[0]!, 'zh-HK', (e) => describeError(e, 'zh-HK'));
    expect(msg).toBe('第 2 行「價錢」: 請輸入完整數字（不要用 e 記數法）。');
  });
  it('missing required columns and broken quoting stop the import with a message', () => {
    expect(
      importIngredientsCsv('name,price\nA,1\n').problems.map(
        (p) => p.kind === 'header' && p.column,
      ),
    ).toEqual(['pack qty', 'unit']);
    expect(importIngredientsCsv('name,pack qty,unit,price\n"A,1,g,1\n').problems[0]!.kind).toBe(
      'csv',
    );
  });
  it('export → import gives the same ingredients (both languages)', () => {
    const list = sampleStored().ingredients;
    for (const lang of ['en', 'zh-HK'] as const) {
      const back = importIngredientsCsv(ingredientsToCsv(list, lang));
      expect(back.problems).toEqual([]);
      expect(back.ingredients.map(withoutId)).toEqual(list.map(withoutId));
    }
  });
  const decimalArb = fc
    .tuple(fc.integer({ min: 1, max: 99999 }), fc.integer({ min: 0, max: 99 }))
    .map(([a, b]) => `${a}.${String(b).padStart(2, '0')}`);
  it(`export → import round trip on random ingredients (${Math.ceil(runs / 4)} runs)`, () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc
              .string({
                unit: fc.constantFrom('叉', '燒', 'a', ',', '"', '=', ' ', '-', '@'),
                minLength: 1,
                maxLength: 10,
              })
              .filter((s) => s.trim() === s && s.length > 0 && !/^'/.test(s)),
            packQty: decimalArb,
            packUnit: fc.constantFrom('g', 'kg', 'catty', 'tael', 'lb', 'ml', 'l', 'piece'),
            price: decimalArb,
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (rows) => {
          const list: StoredIngredient[] = rows.map(
            (r, i) => ({ id: `x${i}`, ...r }) as StoredIngredient,
          );
          const back = importIngredientsCsv(ingredientsToCsv(list));
          // names starting with = + - @ come back with the neutralising apostrophe
          return (
            back.problems.length === 0 &&
            back.ingredients.every(
              (b, i) =>
                b.name === neutralise(list[i]!.name) &&
                b.price === list[i]!.price &&
                b.packQty === list[i]!.packQty &&
                b.packUnit === list[i]!.packUnit,
            )
          );
        },
      ),
      { numRuns: Math.ceil(runs / 4) },
    );
  });
});

describe('messages', () => {
  it('every error code has an English and a Chinese message', () => {
    expect(new Set(ZH_CODES)).toEqual(new Set(MESSAGE_CODES));
    expect(MESSAGE_CODES.length).toBeGreaterThan(40);
  });
  it('locations use names', () => {
    const p = validateProject(sampleStored());
    if (!p.ok) throw new Error();
    expect(
      describeError(
        { code: 'needs-density', path: 'recipes.charsiu.lines[1]', params: { item: '生抽' } },
        'zh-HK',
        p.value.project,
      ),
    ).toBe('食譜 叉燒 · 第 2 行: 「生抽」：重量與容量互換需要密度（克／毫升）。');
    expect(
      describeError({ code: 'yield-out-of-range', path: 'ingredients[0].yieldPercent' }, 'en'),
    ).toBe('Ingredient #1 · yieldPercent: Usable yield must be more than 0% and at most 100%.');
  });
});

describe('reports show verified numbers only', () => {
  const proj = (() => {
    const r = validateProject(sampleStored());
    if (!r.ok) throw new Error();
    return r.value.project;
  })();
  it('a mismatch withholds every number and says so', () => {
    const v = verifiedProject(proj);
    const broken: VerifiedProject = {
      recipes: new Map([...v.recipes].map(([k]) => [k, { status: 'mismatch', detail: 'test' }])),
      menu: new Map([...v.menu].map(([k]) => [k, { status: 'mismatch', detail: 'test' }])),
    };
    const card = recipeCard(proj, broken, 'charsiu', 'en');
    expect(card.total).toBeNull();
    expect(card.lines.every((l) => l.cost === '' && l.share === '')).toBe(true);
    expect(card.problem).toMatch(/Internal check failed/);
    const rows = menuRows(proj, broken, 'en');
    expect(
      rows.every((r) => r.portionCost === null && r.suggested === null && r.foodCost === null),
    ).toBe(true);
    const text = textReport(proj, 'en', broken);
    expect(text).not.toMatch(/15\.36|153\.64/);
  });
  it('the sample report carries the disclaimer and the hand-checked numbers', () => {
    const text = textReport(proj);
    expect(text).toContain('Estimates only, not accounting or tax advice.');
    expect(text).toContain('total 153.64 · per portion 15.36');
    expect(text).toContain('target 30.0% → suggested 58.00 (at suggested 26.5%)');
    expect(textReport(proj, 'zh-HK')).toContain('只供估算，並非會計或稅務意見。');
  });
  it('menu CSV is neutralised and ends with the disclaimer', () => {
    const s = sampleStored();
    s.menu[0]!.name = '=cmd()';
    const r = validateProject(s);
    if (!r.ok) throw new Error();
    const csv = menuCsv(r.value.project);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain("\r\n'=cmd(),叉燒,");
    expect(csv.trimEnd().endsWith('"Estimates only, not accounting or tax advice."')).toBe(true);
  });
  it('an empty project reports cleanly', () => {
    const r = validateProject(emptyProject('空'));
    if (!r.ok) throw new Error();
    expect(textReport(r.value.project)).toContain('== Menu ==');
  });
});

const CSV_MUTANTS: Mutant[] = [
  {
    name: 'neutralise forgets minus',
    file: 'io/csv.ts',
    from: 'const FORMULA_START = /^[=+\\-@\\t\\r]/;',
    to: 'const FORMULA_START = /^[=+@\\t\\r]/;',
  },
  {
    name: 'neutralise forgets tab and CR',
    file: 'io/csv.ts',
    from: 'const FORMULA_START = /^[=+\\-@\\t\\r]/;',
    to: 'const FORMULA_START = /^[=+\\-@]/;',
  },
  {
    name: 'quote misses CR',
    file: 'io/csv.ts',
    from: 'return /[",\\r\\n]/.test(cell)',
    to: 'return /[",\\n]/.test(cell)',
  },
  { name: 'quotes not doubled', file: 'io/csv.ts', from: 'cell.replace(/"/g, \'""\')', to: 'cell' },
  {
    name: 'LF instead of CRLF',
    file: 'io/csv.ts',
    from: '.map((line) => `${line}\\r\\n`)',
    to: '.map((line) => `${line}\\n`)',
  },
  {
    name: 'doubled quote not unescaped',
    file: 'io/csv.ts',
    from: "        if (s[i + 1] === '\"') {",
    to: '        if (false) {',
  },
  {
    name: 'BOM not stripped',
    file: 'io/csv.ts',
    from: 'const s = text.startsWith(BOM) ? text.slice(1) : text;',
    to: 'const s = text;',
  },
  {
    name: 'blank lines kept',
    file: 'io/csv.ts',
    from: "if (!(cells.length === 1 && cells[0] === '' && !wasQuoted)) rows.push",
    to: 'rows.push',
  },
  {
    name: 'bare CR not a line end',
    file: 'io/csv.ts',
    from: "if (ch === '\\r' || ch === '\\n') {",
    to: "if (ch === '\\n') {",
  },
];

describe('CSV mutation testing', () => {
  for (const m of CSV_MUTANTS)
    it(`catches mutant: ${m.name}`, async () => {
      expect(occurrences(m), m.name).toBe(1);
      const mod = await loadMutant<typeof io>(m);
      expect(runCsvGolden(mod).length).toBeGreaterThan(0);
    });
});
