// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Engine-side quantity handling: a quantity in any unit reference (built-in unit, custom
// measure or "portion") is turned into base units of its dimension, then converted across
// dimensions with units/convert (density, weight per piece).

import { mul, type Rational } from '../num/index';
import type { Measure, ProjectError, UnitRef } from '../model/index';
import { BASE_UNIT, convert, UNITS, type ConversionInfo, type Dimension } from '../units/index';

export type Dim = Dimension | 'portion';

export interface Resolved {
  dim: Dim;
  /** base units (g, ml, piece or portion) per one of this unit */
  factor: Rational;
}

export function resolveUnit(ref: UnitRef, measures: ReadonlyMap<string, Measure>): Resolved {
  if (ref === 'portion') return { dim: 'portion', factor: { n: 1n, d: 1n } };
  if (ref.startsWith('measure:')) {
    const m = measures.get(ref.slice(8));
    if (!m) throw new Error(`unknown measure ${ref}`); // validation prevents this
    const u = UNITS[m.unit];
    return { dim: u.dimension, factor: mul(m.amount, u.factor) };
  }
  const u = UNITS[ref as keyof typeof UNITS];
  return { dim: u.dimension, factor: u.factor };
}

/** Convert `qty` of `from` into base units of dimension `to`. */
export function toBaseOf(
  qty: Rational,
  from: Resolved,
  to: Dim,
  info: ConversionInfo,
  path: string,
): { ok: true; value: Rational } | { ok: false; error: ProjectError } {
  const base = mul(qty, from.factor);
  if (from.dim === to) return { ok: true, value: base };
  if (from.dim === 'portion' || to === 'portion')
    return {
      ok: false,
      error: { code: 'incompatible-units', path, params: { from: from.dim, to } },
    };
  const r = convert(base, BASE_UNIT[from.dim], BASE_UNIT[to], info);
  if (r.ok) return r;
  const code =
    r.error.code === 'needs-density' || r.error.code === 'bad-density'
      ? 'needs-density'
      : 'needs-piece-weight';
  return { ok: false, error: { code, path, params: { from: from.dim, to } } };
}
