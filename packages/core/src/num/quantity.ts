// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Quantity parser: everything parseDecimal accepts, plus kitchen fractions (v0.2).
//   1/2   3/4   1 1/2   1½   ½   １／２   1⁄2   (full-width digits, ／ and the fraction
//   slash ⁄ are folded first; a space, U+3000 or nothing separates a whole number from a
//   vulgar fraction character).
// Rules: numerator and denominator are plain digits (no sign, point or comma); the
// denominator must not be 0; in a mixed number the fraction must be proper (1 1/2 ok,
// 1 3/2 rejected) so "1 3/2" is never silently read as 2.5; each part has at most 15
// digits. Quantities are never negative, so a sign in front of a fraction is rejected.

import {
  MAX_SIGNIFICANT_DIGITS,
  normaliseDecimalInput,
  parseDecimal,
  type DecimalError,
} from './decimal';
import { add, rat, type Rational } from './rational';

export type QuantityError = DecimalError | 'bad-fraction' | 'zero-denominator';

export type QuantityResult = { ok: true; value: Rational } | { ok: false; error: QuantityError };

/** Unicode vulgar fraction characters and their value. */
export const VULGAR_FRACTIONS: Readonly<Record<string, readonly [number, number]>> = {
  '½': [1, 2],
  '⅓': [1, 3],
  '⅔': [2, 3],
  '¼': [1, 4],
  '¾': [3, 4],
  '⅕': [1, 5],
  '⅖': [2, 5],
  '⅗': [3, 5],
  '⅘': [4, 5],
  '⅙': [1, 6],
  '⅚': [5, 6],
  '⅐': [1, 7],
  '⅛': [1, 8],
  '⅜': [3, 8],
  '⅝': [5, 8],
  '⅞': [7, 8],
  '⅑': [1, 9],
  '⅒': [1, 10],
};

/**
 * Fold full-width forms, the fraction slash and vulgar fraction characters into ASCII
 * ("1½" → "1 1/2", "１／２" → "1/2"). Inner runs of spaces become one space.
 */
export function normaliseQuantityInput(input: string): string {
  let s = normaliseDecimalInput(input).replace(/[／⁄]/gu, '/');
  s = s.replace(/(\d?)([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒])/gu, (_m, whole: string, ch: string) => {
    const [n, d] = VULGAR_FRACTIONS[ch]!;
    return `${whole}${whole ? ' ' : ''}${n}/${d}`;
  });
  return s.replace(/[\s\u3000]+/gu, ' ');
}

const tooLong = (digits: string) => digits.replace(/^0+/, '').length > MAX_SIGNIFICANT_DIGITS;

export function parseQuantity(input: string): QuantityResult {
  if (typeof input !== 'string') return { ok: false, error: 'not-a-number' };
  const s = normaliseQuantityInput(input);
  if (!s.includes('/')) return parseDecimal(s);
  const m = /^(?:(\d+) )?(\d+)\/(\d+)$/.exec(s);
  if (!m) return { ok: false, error: 'bad-fraction' };
  const [, wholeText, numText = '', denText = ''] = m;
  if ([wholeText ?? '', numText, denText].some(tooLong))
    return { ok: false, error: 'too-many-digits' };
  const num = BigInt(numText);
  const den = BigInt(denText);
  if (den === 0n) return { ok: false, error: 'zero-denominator' };
  if (wholeText === undefined) return { ok: true, value: rat(num, den) };
  if (num >= den) return { ok: false, error: 'bad-fraction' };
  return { ok: true, value: add(rat(BigInt(wholeText)), rat(num, den)) };
}

/** True if the text uses a fraction form (after folding), e.g. for tidying. */
export function isFractionText(input: string): boolean {
  return normaliseQuantityInput(input).includes('/');
}
