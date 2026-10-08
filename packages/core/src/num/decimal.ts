// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Strict decimal-string parser (user input → exact Rational). Rules (docs/calculation-rules.md):
//  - full-width digits, point, comma, plus and minus (１２．５, －３) are folded to ASCII first,
//    as is the Unicode minus sign (−); surrounding spaces (including U+3000) are trimmed;
//  - optional sign, then digits with an optional fraction: 12, 12.5, .5, 007;
//  - thousands separators: commas only, in groups of exactly three, only in the integer
//    part (1,234.5 ok; 1,23.4, 1234,5, 1.234,5 rejected);
//  - rejected: empty, NaN, Infinity, exponents (1e5), several points, a trailing point (5.),
//    spaces inside, any other character, more than 15 significant digits;
//  - -0 is normalised to 0.

import { rat, type Rational } from './rational';

export const MAX_SIGNIFICANT_DIGITS = 15;

export type DecimalError =
  'empty' | 'not-a-number' | 'exponent' | 'multiple-points' | 'bad-grouping' | 'too-many-digits';

export type ParseResult = { ok: true; value: Rational } | { ok: false; error: DecimalError };

const FULLWIDTH: Record<string, string> = {
  '．': '.',
  '，': ',',
  '＋': '+',
  '－': '-',
  '−': '-',
};

/** Fold full-width forms to ASCII and trim (exported for tests and the UI). */
export function normaliseDecimalInput(input: string): string {
  let out = '';
  for (const ch of input) {
    const c = ch.codePointAt(0)!;
    if (c >= 0xff10 && c <= 0xff19) out += String.fromCharCode(c - 0xff10 + 48);
    else out += FULLWIDTH[ch] ?? ch;
  }
  return out.replace(/^[\s\u3000]+|[\s\u3000]+$/gu, '');
}

export function parseDecimal(input: string): ParseResult {
  if (typeof input !== 'string') return { ok: false, error: 'not-a-number' };
  const s = normaliseDecimalInput(input);
  if (s === '') return { ok: false, error: 'empty' };
  if (/^[+-]?(nan|inf(inity)?)$/i.test(s)) return { ok: false, error: 'not-a-number' };
  if (/^[+-]?[0-9.,]*[0-9][eE][+-]?[0-9]+$/.test(s)) return { ok: false, error: 'exponent' };
  if ((s.match(/\./g) ?? []).length > 1) return { ok: false, error: 'multiple-points' };
  const m = /^([+-]?)([0-9,]*)(?:\.([0-9]*))?$/.exec(s);
  if (!m) return { ok: false, error: 'not-a-number' };
  const [, signText, intText = '', fracText] = m;
  if (fracText !== undefined && fracText === '') return { ok: false, error: 'not-a-number' };
  if (intText === '' && fracText === undefined) return { ok: false, error: 'not-a-number' };
  if (intText.includes(',')) {
    if (!/^[0-9]{1,3}(,[0-9]{3})+$/.test(intText)) return { ok: false, error: 'bad-grouping' };
  }
  const intDigits = intText.replace(/,/g, '');
  const frac = fracText ?? '';
  const significant = (intDigits + frac).replace(/^0+/, '');
  if (significant.length > MAX_SIGNIFICANT_DIGITS) return { ok: false, error: 'too-many-digits' };
  const n = BigInt((intDigits || '0') + frac);
  const value = rat(signText === '-' ? -n : n, 10n ** BigInt(frac.length));
  return { ok: true, value };
}

/** Parse or throw (for trusted literals in code and tests). */
export function dec(text: string): Rational {
  const r = parseDecimal(text);
  if (!r.ok) throw new Error(`bad decimal literal "${text}": ${r.error}`);
  return r.value;
}
