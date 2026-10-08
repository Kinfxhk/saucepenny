// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Menu engineering (calculation rule 16, docs/calculation-rules.md), from sales counts the
// user imports or types; nothing leaves the device.
//   • margin of an item = net price − cost per portion (the verified gross profit);
//   • mix share = sold ÷ total sold of all analysed items;
//   • popular when mix share ≥ 70% of an equal share (0.7 ÷ number of items);
//   • profitable when margin ≥ the sales-weighted average margin
//     (Σ margin × sold ÷ total sold).
// Popular + profitable = "keep"; popular only = "raise margin"; profitable only =
// "promote"; neither = "rethink". Boundaries count as popular / profitable.

import { add, div, ge, mul, rat, ZERO, type Rational } from '../num/index';

export const QUADRANTS = ['keep', 'raise-margin', 'promote', 'rethink'] as const;
export type Quadrant = (typeof QUADRANTS)[number];

/** Popularity line as a fraction of an equal share. */
export const POPULARITY_FACTOR: Rational = rat(7n, 10n);

export interface MenuEngInput {
  id: string;
  /** Whole number of portions sold in the period (≥ 0). */
  sold: number;
  margin: Rational;
}

export interface MenuEngRow extends MenuEngInput {
  mix: Rational;
  totalMargin: Rational;
  popular: boolean;
  profitable: boolean;
  quadrant: Quadrant;
}

export type MenuEngResult =
  | {
      ok: true;
      rows: MenuEngRow[];
      totalSold: number;
      averageMargin: Rational;
      /** Mix share at or above which an item is popular. */
      popularLine: Rational;
      totalMargin: Rational;
    }
  | { ok: false; reason: 'no-items' | 'no-sales' };

export const quadrantOf = (popular: boolean, profitable: boolean): Quadrant =>
  popular ? (profitable ? 'keep' : 'raise-margin') : profitable ? 'promote' : 'rethink';

export function menuEngineering(items: readonly MenuEngInput[]): MenuEngResult {
  if (items.length === 0) return { ok: false, reason: 'no-items' };
  const totalSold = items.reduce((s, x) => s + x.sold, 0);
  if (totalSold === 0) return { ok: false, reason: 'no-sales' };
  const total = rat(BigInt(totalSold));
  const totalMargin = items.reduce((s, x) => add(s, mul(x.margin, rat(BigInt(x.sold)))), ZERO);
  const averageMargin = div(totalMargin, total);
  const popularLine = div(POPULARITY_FACTOR, rat(BigInt(items.length)));
  const rows = items.map((x): MenuEngRow => {
    const mix = div(rat(BigInt(x.sold)), total);
    const popular = ge(mix, popularLine);
    const profitable = ge(x.margin, averageMargin);
    return {
      ...x,
      mix,
      totalMargin: mul(x.margin, rat(BigInt(x.sold))),
      popular,
      profitable,
      quadrant: quadrantOf(popular, profitable),
    };
  });
  return { ok: true, rows, totalSold, averageMargin, popularLine, totalMargin };
}
