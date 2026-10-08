// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterAll, describe, expect, it } from 'vitest';
import * as model from '../src/model/index';
import { cleanupMutants, loadMutant, occurrences, type Mutant } from './helpers/mutate';
import { dec, eq, toFraction } from '../src/num/index';
import {
  emptyProject,
  jsonDepth,
  LIMITS,
  readProjectJson,
  stringifyProject,
  utf8Length,
  validateProject,
  type ProjectError,
  type StoredProject,
} from '../src/model/index';
import { clone, sampleStored } from './helpers/fixtures';

const codes = (r: { ok: boolean; errors?: ProjectError[] }) =>
  r.ok ? [] : (r as { errors: ProjectError[] }).errors.map((e) => `${e.code}@${e.path}`);

function withIngredient(patch: Record<string, unknown>): StoredProject {
  const p = sampleStored();
  Object.assign(p.ingredients[0]!, patch);
  return p;
}

describe('valid projects', () => {
  it('the sample validates and compiles to exact numbers', () => {
    const r = validateProject(sampleStored());
    expect(codes(r)).toEqual([]);
    if (!r.ok) return;
    const pork = r.value.project.ingredients.get('pork')!;
    expect(eq(pork.yield, dec('0.9'))).toBe(true);
    expect(eq(r.value.project.settings.serviceCharge, dec('0.1'))).toBe(true);
    expect(r.value.migrated).toBe(false);
  });
  it('save → read round-trips the stored form exactly', () => {
    const r = validateProject(sampleStored());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const again = readProjectJson(stringifyProject(r.value.stored));
    expect(again.ok && again.value.stored).toEqual(r.value.stored);
  });
  it('an empty project is valid', () => {
    expect(codes(validateProject(emptyProject()))).toEqual([]);
  });
  it('keeps decimal text exactly as typed (no float conversion)', () => {
    const p = withIngredient({ price: '0.10' });
    const r = validateProject(p);
    expect(r.ok && r.value.stored.ingredients[0]!.price).toBe('0.10');
    expect(r.ok && toFraction(r.value.project.ingredients.get('pork')!.price)).toBe('1/10');
  });
  it('accepts full-width digits and thousands commas in numbers', () => {
    const r = validateProject(withIngredient({ price: '１，２００．５' }));
    expect(r.ok && toFraction(r.value.project.ingredients.get('pork')!.price)).toBe('2401/2');
  });
});

describe('yield (可用率) boundaries', () => {
  it.each([
    ['100', 'ok'],
    ['0.01', 'ok'],
    ['90', 'ok'],
    ['0', 'yield-out-of-range'],
    ['100.01', 'yield-out-of-range'],
    ['-5', 'yield-out-of-range'],
    ['', 'empty'],
    ['abc', 'not-a-number'],
    ['1e2', 'exponent'],
  ])('yieldPercent %j → %s', (y, want) => {
    const c = codes(validateProject(withIngredient({ yieldPercent: y })));
    expect(c.length ? c[0]!.split('@')[0] : 'ok').toBe(want);
  });
  it('a missing yield means 100%', () => {
    const p = sampleStored();
    delete p.ingredients[0]!.yieldPercent;
    const r = validateProject(p);
    expect(r.ok && eq(r.value.project.ingredients.get('pork')!.yield, dec('1'))).toBe(true);
  });
});

describe('field errors are explicit (never silently zero)', () => {
  it.each([
    [{ price: '-1' }, 'must-not-be-negative@ingredients[0].price'],
    [{ packQty: '0' }, 'must-be-positive@ingredients[0].packQty'],
    [{ packQty: '-2' }, 'must-be-positive@ingredients[0].packQty'],
    [{ density: '0' }, 'must-be-positive@ingredients[0].density'],
    [{ pieceWeight: '-55' }, 'must-be-positive@ingredients[0].pieceWeight'],
    [{ packUnit: 'handful' }, 'bad-unit@ingredients[0].packUnit'],
    [{ packUnit: 'portion' }, 'bad-unit@ingredients[0].packUnit'],
    [{ packUnit: 'measure:nope' }, 'unknown-measure@ingredients[0].packUnit'],
    [{ price: 12.5 }, 'type@ingredients[0].price'],
    [{ price: Number.NaN }, 'type@ingredients[0].price'],
    [{ price: '1000000000000000' }, 'too-many-digits@ingredients[0].price'],
    [{ name: '   ' }, 'empty@ingredients[0].name'],
    [{ name: 'x'.repeat(201) }, 'too-long@ingredients[0].name'],
    [{ id: 'has space' }, 'bad-id@ingredients[0].id'],
    [{ priceDate: '2026-02-30' }, 'bad-date@ingredients[0].priceDate'],
    [{ priceDate: '2026-13-01' }, 'bad-date@ingredients[0].priceDate'],
  ])('%j → %s', (patch, want) => {
    expect(codes(validateProject(withIngredient(patch)))).toContain(want);
  });
  it('accepts a leap day and integer prices', () => {
    expect(codes(validateProject(withIngredient({ priceDate: '2028-02-29', price: 68 })))).toEqual(
      [],
    );
  });
  it('recipe yield 0 and negative are rejected; line qty 0 accepted, negative rejected', () => {
    const p = sampleStored();
    p.recipes[0]!.yieldQty = '0';
    p.recipes[1]!.yieldQty = '-1';
    p.recipes[2]!.lines[0]!.qty = '-1';
    p.recipes[2]!.lines[1]!.qty = '0';
    const c = codes(validateProject(p));
    expect(c).toContain('zero-yield@recipes[0].yieldQty');
    expect(c).toContain('must-be-positive@recipes[1].yieldQty');
    expect(c).toContain('must-not-be-negative@recipes[2].lines[0].qty');
    expect(c.filter((x) => x.includes('lines[1]'))).toEqual([]);
  });
  it.each([
    ['0', 'ok'],
    ['99.99', 'ok'],
    ['100', 'waste-out-of-range'],
    ['-1', 'waste-out-of-range'],
  ])('line wastePercent %j → %s', (w, want) => {
    const p = sampleStored();
    p.recipes[0]!.lines[0]!.wastePercent = w;
    const c = codes(validateProject(p));
    expect(c.length ? c[0]!.split('@')[0] : 'ok').toBe(want);
  });
  it.each([
    ['100', 'ok'],
    ['0.5', 'ok'],
    ['0', 'target-out-of-range'],
    ['100.5', 'target-out-of-range'],
    ['-30', 'target-out-of-range'],
  ])('menu targetPercent %j → %s', (t, want) => {
    const p = sampleStored();
    p.menu[0]!.targetPercent = t;
    const c = codes(validateProject(p));
    expect(c.length ? c[0]!.split('@')[0] : 'ok').toBe(want);
  });
  it('unknown references, bad rounding and bad currency are reported', () => {
    const p = sampleStored();
    p.recipes[0]!.lines[0]!.ref = { kind: 'ingredient', id: 'ghost' };
    p.recipes[1]!.lines[2]!.ref = { kind: 'recipe', id: 'ghost' };
    p.menu[0]!.recipeId = 'ghost';
    (p.menu[1] as unknown as Record<string, unknown>).rounding = 'ending-9';
    p.settings.currency = 'hkd';
    const c = codes(validateProject(p));
    expect(c).toEqual(
      expect.arrayContaining([
        'unknown-ingredient@recipes[0].lines[0].ref',
        'unknown-recipe@recipes[1].lines[2].ref',
        'unknown-recipe@menu[0].recipeId',
        'bad-rounding@menu[1].rounding',
        'bad-currency@settings.currency',
      ]),
    );
  });
  it('band thresholds must be ordered', () => {
    const p = sampleStored();
    p.settings.goodPercent = '40';
    expect(codes(validateProject(p))).toContain('band-order@settings.highPercent');
  });
  it('duplicate ids are rejected', () => {
    const p = sampleStored();
    p.ingredients[1]!.id = 'pork';
    p.recipes[1]!.id = 'syrup';
    const c = codes(validateProject(p));
    expect(c).toContain('duplicate-id@ingredients[1].id');
    expect(c).toContain('duplicate-id@recipes[1].id');
  });
  it('the same id may be used for an ingredient and a recipe (separate namespaces)', () => {
    const p = sampleStored();
    p.recipes[0]!.id = 'sugar';
    p.recipes[1]!.lines[2]!.ref.id = 'sugar';
    p.recipes[2]!.lines[2]!.ref.id = 'sugar';
    expect(codes(validateProject(p))).toEqual([]);
  });
});

describe('limits', () => {
  it(`rejects more than ${LIMITS.ingredients} ingredients`, () => {
    const p = emptyProject();
    p.ingredients = Array.from({ length: LIMITS.ingredients + 1 }, (_, i) => ({
      id: `i${i}`,
      name: `I${i}`,
      packQty: '1',
      packUnit: 'kg' as const,
      price: '1',
    }));
    expect(codes(validateProject(p))).toContain('too-many@ingredients');
    p.ingredients.pop();
    expect(codes(validateProject(p))).toEqual([]);
  });
  it(`rejects more than ${LIMITS.linesPerRecipe} lines in a recipe`, () => {
    const p = sampleStored();
    p.recipes[0]!.lines = Array.from({ length: LIMITS.linesPerRecipe + 1 }, () => ({
      ref: { kind: 'ingredient' as const, id: 'sugar' },
      qty: '1',
      unit: 'g' as const,
    }));
    expect(codes(validateProject(p))).toContain('too-many@recipes[0].lines');
  });
});

describe('hostile JSON files', () => {
  const base = () => stringifyProject(sampleStored());
  it('rejects __proto__, constructor and prototype keys anywhere', () => {
    for (const evil of [
      base().replace('"name": "測試茶餐廳"', '"__proto__": {"polluted": true}, "name": "x"'),
      base().replace('"id": "pork"', '"id": "pork", "constructor": {"prototype": {}}'),
      base().replace('"currency": "HKD"', '"currency": "HKD", "prototype": 1'),
    ]) {
      const r = readProjectJson(evil);
      expect(codes(r)[0]).toMatch(/^forbidden-key@/);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('rejects nesting 1,000 deep without parsing it', () => {
    const deep = '['.repeat(1000) + ']'.repeat(1000);
    expect(codes(readProjectJson(deep))).toEqual(['too-deep@']);
    expect(jsonDepth('{"a":"[[[[[[[[[[[[[[[[[[[[[["}')).toBe(1);
  });
  it('rejects a file over 10 MB before parsing', () => {
    const big = base().replace('"note"', '"note"') + ' '.repeat(LIMITS.fileBytes);
    expect(codes(readProjectJson(big))).toEqual(['file-too-large@']);
    expect(utf8Length('叉燒')).toBe(6);
    expect(utf8Length('😀')).toBe(4);
  });
  it('rejects NaN, Infinity, trailing commas and other invalid JSON', () => {
    for (const bad of [
      base().replace('"price": "68"', '"price": NaN'),
      base().replace('"price": "68"', '"price": Infinity'),
      '{"schema": "saucepenny/project",}',
      '',
      'null x',
    ])
      expect(codes(readProjectJson(bad))).toEqual(['invalid-json@']);
  });
  it('rejects non-projects, newer versions and wrong types', () => {
    expect(codes(readProjectJson('[]'))).toEqual(['not-a-project@']);
    expect(codes(readProjectJson('{"schema":"other"}'))).toEqual(['not-a-project@']);
    const newer = clone(sampleStored()) as unknown as Record<string, unknown>;
    newer.version = 2;
    expect(codes(validateProject(newer))).toEqual(['newer-version@version']);
    newer.version = 0;
    expect(codes(validateProject(newer))).toEqual(['unsupported-version@version']);
    newer.version = 1;
    newer.ingredients = 'many';
    expect(codes(validateProject(newer))).toContain('type@ingredients');
  });
  it('accepts a UTF-8 BOM', () => {
    expect(readProjectJson('\ufeff' + base()).ok).toBe(true);
  });
  it('names with emoji, RTL marks and HTML stay as plain text', () => {
    const p = withIngredient({ name: '<img src=x onerror=alert(1)> 🍜\u202e' });
    const r = validateProject(p);
    expect(r.ok && r.value.project.ingredients.get('pork')!.name).toBe(
      '<img src=x onerror=alert(1)> 🍜\u202e',
    );
  });
});

describe('migration', () => {
  it('fills missing optional sections and settings with defaults', () => {
    const minimal = { schema: 'saucepenny/project', version: 1, name: 'Old file' };
    const r = validateProject(minimal);
    expect(codes(r)).toEqual([]);
    expect(r.ok && r.value.migrated).toBe(true);
    expect(r.ok && r.value.stored.settings).toEqual({
      currency: 'HKD',
      serviceChargePercent: '10',
      goodPercent: '30',
      highPercent: '35',
    });
  });
});

// ---------------------------------------------------------------------------------
// Mutation testing: broken copies of model/ must fail the hostile-input table.
// ---------------------------------------------------------------------------------
type ModelModule = typeof import('../src/model/index');

function runModelGolden(m: ModelModule): string[] {
  const fails: string[] = [];
  const first = (r: { ok: boolean; errors?: ProjectError[] }) =>
    r.ok ? 'ok' : (r as { errors: ProjectError[] }).errors[0]!.code;
  const text = stringifyProject(sampleStored());
  const cases: [string, () => string, string][] = [
    ['valid sample', () => first(m.validateProject(sampleStored())), 'ok'],
    [
      'yield 100.01',
      () => first(m.validateProject(withIngredient({ yieldPercent: '100.01' }))),
      'yield-out-of-range',
    ],
    [
      'yield 0',
      () => first(m.validateProject(withIngredient({ yieldPercent: '0' }))),
      'yield-out-of-range',
    ],
    ['yield 100', () => first(m.validateProject(withIngredient({ yieldPercent: '100' }))), 'ok'],
    [
      'negative price',
      () => first(m.validateProject(withIngredient({ price: '-1' }))),
      'must-not-be-negative',
    ],
    ['float price', () => first(m.validateProject(withIngredient({ price: 0.1 }))), 'type'],
    [
      '__proto__',
      () =>
        first(
          m.readProjectJson(text.replace('"name": "測試茶餐廳"', '"__proto__": {}, "name": "x"')),
        ),
      'forbidden-key',
    ],
    ['depth 1000', () => first(m.readProjectJson('['.repeat(1000) + ']'.repeat(1000))), 'too-deep'],
    [
      'duplicate id',
      () => {
        const p = sampleStored();
        p.ingredients[1]!.id = 'pork';
        return first(m.validateProject(p));
      },
      'duplicate-id',
    ],
    [
      'waste 100',
      () => {
        const p = sampleStored();
        p.recipes[0]!.lines[0]!.wastePercent = '100';
        return first(m.validateProject(p));
      },
      'waste-out-of-range',
    ],
    [
      'target 0',
      () => {
        const p = sampleStored();
        p.menu[0]!.targetPercent = '0';
        return first(m.validateProject(p));
      },
      'target-out-of-range',
    ],
    [
      '10 MB',
      () => first(m.readProjectJson(text + ' '.repeat(LIMITS.fileBytes))),
      'file-too-large',
    ],
  ];
  for (const [name, run, want] of cases) {
    let got: string;
    try {
      got = run();
    } catch (e) {
      got = `threw ${String(e)}`;
    }
    if (got !== want) fails.push(`${name}: got ${got}, want ${want}`);
  }
  return fails;
}

const MODEL_MUTANTS: Mutant[] = [
  {
    name: 'yield upper bound off (accepts 100.01%)',
    file: 'model/validate.ts',
    from: '(sign(y) <= 0 || gt(y, HUNDRED))',
    to: '(sign(y) <= 0 || gt(y, rat(101n)))',
  },
  {
    name: 'yield 0% accepted',
    file: 'model/validate.ts',
    from: '(sign(y) <= 0 || gt(y, HUNDRED))',
    to: '(sign(y) < 0 || gt(y, HUNDRED))',
  },
  {
    name: 'forbidden keys not checked',
    file: 'model/json.ts',
    from: "if (bad !== undefined) return fail({ code: 'forbidden-key', path: bad });",
    to: '',
  },
  {
    name: 'depth pre-scan disabled',
    file: 'model/json.ts',
    from: 'if (depth > LIMITS.jsonDepth)',
    to: 'if (depth > 100000)',
  },
  {
    name: 'duplicate ids allowed',
    file: 'model/validate.ts',
    from: "if (seen.has(scoped)) c.add('duplicate-id', `${key}[${i}].id`, { id });",
    to: '',
  },
  {
    name: 'floats accepted as numbers',
    file: 'model/validate.ts',
    from: "else if (typeof v === 'number' && Number.isSafeInteger(v)) text = String(v);",
    to: "else if (typeof v === 'number') text = String(v);",
  },
  {
    name: 'waste 100% accepted',
    file: 'model/validate.ts',
    from: '(sign(w) < 0 || !lt(w, HUNDRED))',
    to: '(sign(w) < 0 || gt(w, HUNDRED))',
  },
  {
    name: 'size limit checked after parsing only on characters',
    file: 'model/json.ts',
    from: 'if (text.length > LIMITS.fileBytes || utf8Length(text) > LIMITS.fileBytes)',
    to: 'if (text.length > LIMITS.fileBytes * 2)',
  },
];

describe('model mutation testing', () => {
  afterAll(cleanupMutants);
  it('the real model passes the table', () => {
    expect(runModelGolden(model)).toEqual([]);
  });
  it('each mutant applies exactly once', () => {
    for (const m of MODEL_MUTANTS) expect(occurrences(m), m.name).toBe(1);
  });
  for (const m of MODEL_MUTANTS)
    it(`catches mutant: ${m.name}`, async () => {
      const mod = await loadMutant<ModelModule>(m);
      expect(runModelGolden(mod).length, `mutant "${m.name}" survived`).toBeGreaterThan(0);
    });
});
