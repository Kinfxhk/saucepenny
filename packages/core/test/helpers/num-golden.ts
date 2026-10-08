// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Golden tables for num/ (parser, rounding, formatting). Written by hand: every expected value
// was worked out on paper, not produced by the code under test. `runNumGolden` returns the
// list of failures so the same table can be run against deliberately broken copies.

import type * as Num from '../../src/num/index';

type NumModule = typeof Num;

/** [input, expected exact fraction "n/d" | error code] */
export const PARSE_GOLDEN: [string, string][] = [
  ['0', '0'],
  ['12', '12'],
  ['12.5', '25/2'],
  ['.5', '1/2'],
  ['007', '7'],
  ['-0', '0'],
  ['-0.000', '0'],
  ['+3', '3'],
  ['-3.25', '-13/4'],
  ['１２．５', '25/2'],
  ['－３', '-3'],
  ['１００', '100'],
  ['０．０５', '1/20'],
  ['−3', '-3'],
  ['1,234.5', '2469/2'],
  ['１，２３４', '1234'],
  ['12,345,678', '12345678'],
  [' 42 ', '42'],
  ['\u300042\u3000', '42'],
  ['0.1', '1/10'],
  ['0.000001', '1/1000000'],
  ['999999999999999', '999999999999999'],
  ['0.123456789012345', '24691357802469/200000000000000'],
  ['000000000000000001', '1'],
  ['1.50', '3/2'],
  ['1,000', '1000'],
  ['0.30', '3/10'],
  ['', 'empty'],
  ['   ', 'empty'],
  ['NaN', 'not-a-number'],
  ['Infinity', 'not-a-number'],
  ['-Infinity', 'not-a-number'],
  ['inf', 'not-a-number'],
  ['1e5', 'exponent'],
  ['1E-3', 'exponent'],
  ['2.5e+2', 'exponent'],
  ['1.2.3', 'multiple-points'],
  ['1..2', 'multiple-points'],
  ['5.', 'not-a-number'],
  ['.', 'not-a-number'],
  ['-', 'not-a-number'],
  ['1,23.4', 'bad-grouping'],
  ['1234,5', 'bad-grouping'],
  [',123', 'bad-grouping'],
  ['1,2345', 'bad-grouping'],
  ['12,34,567', 'bad-grouping'],
  ['1.234,5', 'not-a-number'],
  ['1 234', 'not-a-number'],
  ['12a', 'not-a-number'],
  ['0x10', 'not-a-number'],
  ['1000000000000000', 'too-many-digits'],
  ['0.1234567890123456', 'too-many-digits'],
  ['--1', 'not-a-number'],
  ['+-1', 'not-a-number'],
  ['1/2', 'not-a-number'],
  ['١٢', 'not-a-number'],
  ['12%', 'not-a-number'],
  ['$12', 'not-a-number'],
];

/** [value as decimal text, expected money text] — halves away from zero. */
export const CENTS_GOLDEN: [string, string][] = [
  ['0.005', '0.01'],
  ['0.004999', '0.00'],
  ['0.015', '0.02'],
  ['0.025', '0.03'],
  ['1.005', '1.01'],
  ['2.675', '2.68'],
  ['-0.005', '-0.01'],
  ['-0.004', '0.00'],
  ['1234567.895', '1,234,567.90'],
  ['999.995', '1,000.00'],
  ['0', '0.00'],
  ['12', '12.00'],
];

/** [x, ceil to 0.5] */
export const CEIL_HALF_GOLDEN: [string, string][] = [
  ['0', '0'],
  ['0.01', '0.5'],
  ['0.5', '0.5'],
  ['0.51', '1'],
  ['1', '1'],
  ['1.2', '1.5'],
  ['1.49', '1.5'],
  ['1.5', '1.5'],
  ['1.500001', '2'],
  ['2.25', '2.5'],
  ['9.99', '10'],
  ['10', '10'],
  ['10.01', '10.5'],
  ['33.3', '33.5'],
  ['33.5', '33.5'],
  ['33.75', '34'],
  ['100.1', '100.5'],
  ['0.333333', '0.5'],
  ['3.5', '3.5'],
  ['28.0001', '28.5'],
];

/** [x, smallest whole amount ending in 8 that is >= x] */
export const ENDING8_GOLDEN: [string, string][] = [
  ['1', '8'],
  ['7.99', '8'],
  ['8', '8'],
  ['8.01', '18'],
  ['12', '18'],
  ['17.5', '18'],
  ['18', '18'],
  ['18.1', '28'],
  ['28', '28'],
  ['29', '38'],
  ['38', '38'],
  ['41.2', '48'],
  ['48', '48'],
  ['48.0001', '58'],
  ['99', '108'],
  ['100', '108'],
  ['108', '108'],
  ['109', '118'],
  ['1234', '1238'],
  ['1239', '1248'],
];

export function runNumGolden(m: NumModule): string[] {
  const fails: string[] = [];
  const d = (s: string) => {
    const r = m.parseDecimal(s);
    if (!r.ok) throw new Error(`golden literal ${s} does not parse`);
    return r.value;
  };
  for (const [input, want] of PARSE_GOLDEN) {
    const r = m.parseDecimal(input);
    const got = r.ok ? m.toFraction(r.value) : r.error;
    if (got !== want) fails.push(`parse ${JSON.stringify(input)}: got ${got}, want ${want}`);
  }
  // 0.1 + 0.2 is exactly 0.3.
  if (!m.eq(m.add(d('0.1'), d('0.2')), d('0.3'))) fails.push('0.1 + 0.2 != 0.3');
  for (const [x, want] of CENTS_GOLDEN) {
    const got = m.formatMoney(d(x));
    if (got !== want) fails.push(`money ${x}: got ${got}, want ${want}`);
  }
  for (const [x, want] of CEIL_HALF_GOLDEN) {
    const got = m.toFraction(m.roundPriceUp(d(x), '0.5'));
    if (got !== m.toFraction(d(want))) fails.push(`ceil 0.5 ${x}: got ${got}, want ${want}`);
  }
  for (const [x, want] of ENDING8_GOLDEN) {
    const got = m.toFraction(m.roundPriceUp(d(x), 'ending-8'));
    if (got !== want) fails.push(`ending-8 ${x}: got ${got}, want ${want}`);
  }
  const extra: [string, string][] = [
    [m.formatFixed(m.rat(1n, 3n), 2), '0.33'],
    [m.formatFixed(m.rat(2n, 3n), 2), '0.67'],
    [m.formatPercent(m.rat(2n, 7n)), '28.6'],
    [m.formatQuantity(d('1.500')), '1.5'],
    [m.formatQuantity(d('2')), '2'],
    [m.toFraction(m.roundPriceUp(d('12.301'), '0.1')), '62/5'],
    [m.toFraction(m.roundPriceUp(d('12.001'), '1')), '13'],
    [m.toFraction(m.roundPriceUp(d('12.001'), 'none')), '1201/100'],
    [m.toFraction(m.add(m.rat(1n, 6n), m.rat(1n, 6n))), '1/3'],
    [m.toFraction(m.sub(m.rat(1n, 2n), m.rat(1n, 3n))), '1/6'],
    [m.toFraction(m.mul(m.rat(2n, 3n), m.rat(3n, 4n))), '1/2'],
    [m.toFraction(m.div(m.rat(1n, 2n), m.rat(1n, 4n))), '2'],
  ];
  for (const [got, want] of extra) if (got !== want) fails.push(`extra: got ${got}, want ${want}`);
  return fails;
}
