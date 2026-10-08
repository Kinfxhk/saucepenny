// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import * as num from '../src/num/index';
import {
  add,
  ceilInt,
  cmp,
  dec,
  div,
  eq,
  floorInt,
  fromFraction,
  mul,
  neg,
  parseDecimal,
  rat,
  sub,
  toFraction,
  ZERO,
  type Rational,
} from '../src/num/index';
import { cleanupMutants, loadMutant, occurrences, type Mutant } from './helpers/mutate';
import { CEIL_HALF_GOLDEN, ENDING8_GOLDEN, PARSE_GOLDEN, runNumGolden } from './helpers/num-golden';

afterAll(cleanupMutants);

const bigintArb = fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n });
const ratArb = fc
  .tuple(bigintArb, fc.bigInt({ min: 1n, max: 10n ** 20n }))
  .map(([n, d]) => rat(n, d));
const nonZeroArb = ratArb.filter((r) => r.n !== 0n);
const RUNS = { numRuns: 5000 };

describe('rational arithmetic properties (5,000 runs each)', () => {
  it('is always in lowest terms with a positive denominator', () => {
    fc.assert(
      fc.property(bigintArb, fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }), (n, d) => {
        fc.pre(d !== 0n);
        const r = rat(n, d);
        let a = r.n < 0n ? -r.n : r.n;
        let b = r.d;
        while (b) [a, b] = [b, a % b];
        return r.d > 0n && (r.n === 0n ? r.d === 1n : a === 1n);
      }),
      RUNS,
    );
  });
  it('unique representation: equal values are structurally equal', () => {
    fc.assert(
      fc.property(ratArb, fc.bigInt({ min: 1n, max: 10n ** 9n }), (r, k) =>
        eq(rat(r.n * k, r.d * k), r),
      ),
      RUNS,
    );
  });
  it('addition and multiplication commute', () => {
    fc.assert(
      fc.property(ratArb, ratArb, (a, b) => eq(add(a, b), add(b, a)) && eq(mul(a, b), mul(b, a))),
      RUNS,
    );
  });
  it('addition and multiplication associate', () => {
    fc.assert(
      fc.property(
        ratArb,
        ratArb,
        ratArb,
        (a, b, c) =>
          eq(add(add(a, b), c), add(a, add(b, c))) && eq(mul(mul(a, b), c), mul(a, mul(b, c))),
      ),
      RUNS,
    );
  });
  it('multiplication distributes over addition', () => {
    fc.assert(
      fc.property(ratArb, ratArb, ratArb, (a, b, c) =>
        eq(mul(a, add(b, c)), add(mul(a, b), mul(a, c))),
      ),
      RUNS,
    );
  });
  it('a / b × b = a and a − a = 0', () => {
    fc.assert(
      fc.property(ratArb, nonZeroArb, (a, b) => eq(mul(div(a, b), b), a) && eq(sub(a, a), ZERO)),
      RUNS,
    );
  });
  it('comparison agrees with subtraction', () => {
    fc.assert(
      fc.property(ratArb, ratArb, (a, b) => cmp(a, b) === Math.sign(Number(sub(a, b).n))),
      RUNS,
    );
  });
  it('floor <= x < floor + 1 and ceil − 1 < x <= ceil', () => {
    fc.assert(
      fc.property(ratArb, (x) => {
        const f = rat(floorInt(x));
        const c = rat(ceilInt(x));
        return (
          cmp(f, x) <= 0 &&
          cmp(x, add(f, rat(1n))) < 0 &&
          cmp(c, x) >= 0 &&
          cmp(sub(c, rat(1n)), x) < 0
        );
      }),
      RUNS,
    );
  });
  it('canonical fraction text round-trips and rejects non-canonical text', () => {
    fc.assert(
      fc.property(ratArb, (r) => eq(fromFraction(toFraction(r))!, r)),
      RUNS,
    );
    for (const bad of ['2/4', '1/0', '-1/-2', '01', '1/1', '+1', '1.5', '', '-0', '1/-2'])
      expect(fromFraction(bad), bad).toBeUndefined();
  });
  it('division by zero and zero denominators throw (callers report user errors first)', () => {
    expect(() => div(rat(1n), ZERO)).toThrow(/division by zero/);
    expect(() => rat(1n, 0n)).toThrow(/zero denominator/);
    expect(() => rat(0.5)).toThrow(/safe integer/);
  });
  it('negation never produces a negative zero', () => {
    expect(neg(ZERO)).toEqual(ZERO);
    expect(toFraction(neg(ZERO))).toBe('0');
  });
});

describe('decimal parser', () => {
  it(`has at least 50 golden cases (${PARSE_GOLDEN.length})`, () => {
    expect(PARSE_GOLDEN.length).toBeGreaterThanOrEqual(50);
  });
  it.each(PARSE_GOLDEN)('%j → %s', (input, want) => {
    const r = parseDecimal(input);
    expect(r.ok ? toFraction(r.value) : r.error).toBe(want);
  });
  it('0.1 + 0.2 equals 0.3 exactly (unlike binary floating point)', () => {
    expect(eq(add(dec('0.1'), dec('0.2')), dec('0.3'))).toBe(true);
  });
  it('round-trips every decimal with up to 15 significant digits', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 15n) + 1n, max: 10n ** 15n - 1n }),
        fc.integer({ min: 0, max: 15 }),
        (n, scale) => {
          const digits = (n < 0n ? -n : n).toString().padStart(scale + 1, '0');
          const text =
            (n < 0n ? '-' : '') +
            (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits);
          const r = parseDecimal(text);
          return r.ok && eq(r.value, rat(n, 10n ** BigInt(scale)));
        },
      ),
      { numRuns: 2000 },
    );
  });
  it('does not depend on the machine locale', () => {
    // A German locale writes 1.234,5; we must not "helpfully" accept it.
    expect(parseDecimal('1.234,5').ok).toBe(false);
    expect(toFraction(dec('1,234.5'))).toBe('2469/2');
  });
  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40 }), (s) => {
        const r = parseDecimal(s);
        return typeof r.ok === 'boolean';
      }),
      { numRuns: 3000 },
    );
    expect(parseDecimal(undefined as unknown as string).ok).toBe(false);
  });
});

describe('rounding (display and suggested prices only)', () => {
  it('golden tables (cents, ceil to 0.5 ×20, ending in 8 ×20) all pass', () => {
    expect(CEIL_HALF_GOLDEN.length).toBeGreaterThanOrEqual(20);
    expect(ENDING8_GOLDEN.length).toBeGreaterThanOrEqual(20);
    expect(runNumGolden(num)).toEqual([]);
  });
  it('rounding up never goes below the value and moves less than one step', () => {
    const step: Record<string, Rational> = {
      none: rat(1n, 100n),
      '0.1': rat(1n, 10n),
      '0.5': rat(1n, 2n),
      '1': rat(1n),
      'ending-8': rat(10n),
    };
    fc.assert(
      fc.property(
        ratArb.filter((r) => r.n >= 0n),
        fc.constantFrom(...num.PRICE_ROUNDINGS),
        (x, rule) => {
          const y = num.roundPriceUp(x, rule);
          return cmp(y, x) >= 0 && cmp(sub(y, x), step[rule]!) < 0;
        },
      ),
      { numRuns: 3000 },
    );
  });
  it('display rounding moves a value by at most half a cent and never shows -0.00', () => {
    fc.assert(
      fc.property(ratArb, (x) => {
        const residue = num.roundingResidue(x);
        const text = num.formatMoney(x);
        return cmp(num.abs(residue), rat(1n, 200n)) <= 0 && text !== '-0.00';
      }),
      { numRuns: 3000 },
    );
  });
});

// ---------------------------------------------------------------------------------
// Mutation testing: deliberately broken copies of num/ must fail the golden table.
// ---------------------------------------------------------------------------------
const NUM_MUTANTS: Mutant[] = [
  {
    name: 'half-up rounding uses floor',
    file: 'num/round.ts',
    from: 'floorInt(add(units, rat(1n, 2n)))',
    to: 'floorInt(units)',
  },
  {
    name: 'ceil-to-step uses floor',
    file: 'num/round.ts',
    from: 'mul(rat(ceilInt(div(x, step))), step)',
    to: 'mul(rat(floorInt(div(x, step))), step)',
  },
  {
    name: 'parser tolerates a second decimal point',
    file: 'num/decimal.ts',
    from: "if ((s.match(/\\./g) ?? []).length > 1) return { ok: false, error: 'multiple-points' };",
    to: '',
  },
  {
    name: 'thousands groups of two digits accepted',
    file: 'num/decimal.ts',
    from: '(,[0-9]{3})+',
    to: '(,[0-9]{2,3})+',
  },
  {
    name: '16 significant digits accepted',
    file: 'num/decimal.ts',
    from: 'significant.length > MAX_SIGNIFICANT_DIGITS',
    to: 'significant.length > MAX_SIGNIFICANT_DIGITS + 1',
  },
  {
    name: 'negative sign taken from the unrounded value (-0.00)',
    file: 'num/round.ts',
    from: 'const negative = scaled < 0n;',
    to: 'const negative = x.n < 0n;',
  },
  {
    name: 'halves rounded toward zero for negatives',
    file: 'num/round.ts',
    from: 'if (sign(x) < 0) return neg(roundHalfAwayFromZero(neg(x), step));',
    to: '',
  },
  {
    name: 'ending-8 off by ten',
    file: 'num/round.ts',
    from: 'const up = (8n - r + 10n) % 10n;',
    to: 'const up = 8n - r + 10n;',
  },
  {
    name: 'same-denominator addition adds denominators',
    file: 'num/rational.ts',
    from: 'a.d === b.d ? rat(a.n + b.n, a.d)',
    to: 'a.d === b.d ? rat(a.n + b.n, a.d + b.d)',
  },
  {
    name: 'full-width digits not folded',
    file: 'num/decimal.ts',
    from: 'if (c >= 0xff10 && c <= 0xff19)',
    to: 'if (c >= 0xff11 && c <= 0xff19)',
  },
];

describe('num mutation testing (each broken copy must fail the golden table)', () => {
  it('has at least 6 mutants, each applying exactly once', () => {
    expect(NUM_MUTANTS.length).toBeGreaterThanOrEqual(6);
    for (const m of NUM_MUTANTS) expect(occurrences(m), m.name).toBe(1);
  });
  for (const m of NUM_MUTANTS)
    it(`catches mutant: ${m.name}`, async () => {
      const mod = await loadMutant<typeof num>(m);
      let fails: string[];
      try {
        fails = runNumGolden(mod);
      } catch (e) {
        fails = [String(e)];
      }
      expect(fails.length, `mutant "${m.name}" survived`).toBeGreaterThan(0);
    });
});
