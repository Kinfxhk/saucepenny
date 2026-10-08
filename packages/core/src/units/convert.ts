// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Exact unit conversion, including mass ↔ volume (needs density in g/ml) and
// count ↔ mass/volume (needs weight per piece in g). Missing data is an error, never a guess.

import { div, mul, sign, type Rational } from '../num/index';
import { UNITS, type Dimension, type UnitId } from './table';

export interface ConversionInfo {
  /** grams per millilitre */
  densityGPerMl?: Rational | undefined;
  /** grams per piece */
  pieceWeightG?: Rational | undefined;
}

export type ConvertError =
  | { code: 'needs-density'; from: Dimension; to: Dimension }
  | { code: 'needs-piece-weight'; from: Dimension; to: Dimension }
  | { code: 'bad-density' }
  | { code: 'bad-piece-weight' };

export type ConvertResult = { ok: true; value: Rational } | { ok: false; error: ConvertError };

/** How many base units of `to`'s dimension one base unit of `from`'s dimension is. */
function dimensionFactor(from: Dimension, to: Dimension, info: ConversionInfo): ConvertResult {
  if (from === to) return { ok: true, value: { n: 1n, d: 1n } };
  const density = info.densityGPerMl;
  const piece = info.pieceWeightG;
  if (density !== undefined && sign(density) <= 0)
    return { ok: false, error: { code: 'bad-density' } };
  if (piece !== undefined && sign(piece) <= 0)
    return { ok: false, error: { code: 'bad-piece-weight' } };
  // Express each dimension in grams per base unit.
  const gramsPer = (dim: Dimension): Rational | ConvertError => {
    if (dim === 'mass') return { n: 1n, d: 1n };
    if (dim === 'volume') return density ?? { code: 'needs-density', from, to };
    return piece ?? { code: 'needs-piece-weight', from, to };
  };
  const a = gramsPer(from);
  if ('code' in a) return { ok: false, error: a };
  const b = gramsPer(to);
  if ('code' in b) return { ok: false, error: b };
  return { ok: true, value: div(a, b) };
}

/** Convert `qty` of unit `from` into unit `to`, exactly. */
export function convert(
  qty: Rational,
  from: UnitId,
  to: UnitId,
  info: ConversionInfo = {},
): ConvertResult {
  const f = UNITS[from];
  const t = UNITS[to];
  const dim = dimensionFactor(f.dimension, t.dimension, info);
  if (!dim.ok) return dim;
  // qty × (from → base) × (base_from → base_to) ÷ (to → base)
  return { ok: true, value: div(mul(mul(qty, f.factor), dim.value), t.factor) };
}
