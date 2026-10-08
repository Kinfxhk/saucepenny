// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Exact rounding. Nothing inside the engine is rounded; these functions are used only to
// display a value, and to compute a suggested price (always rounded UP, so the real food
// cost % after rounding never exceeds the target).

import { add, ceilInt, div, floorInt, mul, neg, rat, sign, sub, type Rational } from './rational';

/** Round to a multiple of `step` (> 0), halves away from zero ("四捨五入"). */
export function roundHalfAwayFromZero(x: Rational, step: Rational): Rational {
  if (sign(step) <= 0) throw new RangeError('step must be positive');
  if (sign(x) < 0) return neg(roundHalfAwayFromZero(neg(x), step));
  const units = div(x, step);
  const k = floorInt(add(units, rat(1n, 2n)));
  return mul(rat(k), step);
}

/** Smallest multiple of `step` that is >= x. */
export function ceilToStep(x: Rational, step: Rational): Rational {
  if (sign(step) <= 0) throw new RangeError('step must be positive');
  return mul(rat(ceilInt(div(x, step))), step);
}

/** Largest multiple of `step` that is <= x. */
export function floorToStep(x: Rational, step: Rational): Rational {
  if (sign(step) <= 0) throw new RangeError('step must be positive');
  return mul(rat(floorInt(div(x, step))), step);
}

/** Smallest whole amount >= x whose last digit is 8 (8, 18, 28, …). */
export function ceilToEnding8(x: Rational): Rational {
  const c = ceilInt(x);
  const r = ((c % 10n) + 10n) % 10n;
  const up = (8n - r + 10n) % 10n;
  return rat(c + up);
}

export type PriceRounding = 'none' | '0.1' | '0.5' | '1' | 'ending-8';
export const PRICE_ROUNDINGS: readonly PriceRounding[] = ['none', '0.1', '0.5', '1', 'ending-8'];

/** Round a price UP according to the chosen rule ('none' still rounds up to the cent). */
export function roundPriceUp(x: Rational, rule: PriceRounding): Rational {
  switch (rule) {
    case 'none':
      return ceilToStep(x, rat(1n, 100n));
    case '0.1':
      return ceilToStep(x, rat(1n, 10n));
    case '0.5':
      return ceilToStep(x, rat(1n, 2n));
    case '1':
      return ceilToStep(x, rat(1n));
    case 'ending-8':
      return ceilToEnding8(x);
  }
}

/**
 * Exact fixed-point text with `decimals` places, rounding halves away from zero.
 * formatFixed(1/3, 2) === "0.33"; formatFixed(-0.005, 2) === "-0.01"; never "-0.00".
 */
export function formatFixed(x: Rational, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 20)
    throw new RangeError('decimals must be 0..20');
  const scale = 10n ** BigInt(decimals);
  const r = roundHalfAwayFromZero(x, rat(1n, scale));
  const scaled = (r.n * scale) / r.d; // exact: r is a multiple of 1/scale
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(decimals + 1, '0');
  const intPart = digits.slice(0, digits.length - decimals);
  const fracPart = digits.slice(digits.length - decimals);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (negative ? '-' : '') + grouped + (decimals > 0 ? `.${fracPart}` : '');
}

/** Money to the cent ("四捨五入至仙"), e.g. "1,234.57". */
export const formatMoney = (x: Rational): string => formatFixed(x, 2);

/** A ratio as a percentage with `decimals` places, e.g. 0.28456 → "28.5". */
export const formatPercent = (ratio: Rational, decimals = 1): string =>
  formatFixed(mul(ratio, rat(100n)), decimals);

/**
 * Up to `maxDecimals` places, trailing zeros removed (for quantities): 1.500 → "1.5".
 */
export function formatQuantity(x: Rational, maxDecimals = 3): string {
  const s = formatFixed(x, maxDecimals);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** Difference that display rounding introduces (exact − rounded), for report notes. */
export const roundingResidue = (x: Rational): Rational =>
  sub(x, roundHalfAwayFromZero(x, rat(1n, 100n)));
