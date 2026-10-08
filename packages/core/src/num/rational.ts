// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Exact rational numbers on BigInt. Every value is kept in lowest terms with a positive
// denominator, so two equal numbers always have identical numerator and denominator
// (equality is structural). No operation ever rounds.

export interface Rational {
  readonly n: bigint;
  readonly d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b !== 0n) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/** Build n/d in lowest terms. Throws on a zero denominator (a programming error). */
export function rat(n: bigint | number, d: bigint | number = 1n): Rational {
  let nn = typeof n === 'bigint' ? n : toBigIntStrict(n);
  let dd = typeof d === 'bigint' ? d : toBigIntStrict(d);
  if (dd === 0n) throw new RangeError('zero denominator');
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  if (nn === 0n) return ZERO;
  const g = gcd(nn, dd);
  return { n: nn / g, d: dd / g };
}

function toBigIntStrict(x: number): bigint {
  if (!Number.isSafeInteger(x)) throw new RangeError(`not a safe integer: ${x}`);
  return BigInt(x);
}

export const ZERO: Rational = Object.freeze({ n: 0n, d: 1n });
export const ONE: Rational = Object.freeze({ n: 1n, d: 1n });

export const add = (a: Rational, b: Rational): Rational =>
  a.d === b.d ? rat(a.n + b.n, a.d) : rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rational, b: Rational): Rational => add(a, neg(b));
export const mul = (a: Rational, b: Rational): Rational => rat(a.n * b.n, a.d * b.d);
export const neg = (a: Rational): Rational => (a.n === 0n ? ZERO : { n: -a.n, d: a.d });

/** a / b. Throws on division by zero; callers must check and report a user error first. */
export function div(a: Rational, b: Rational): Rational {
  if (b.n === 0n) throw new RangeError('division by zero');
  return rat(a.n * b.d, a.d * b.n);
}

export const sum = (xs: Iterable<Rational>): Rational => {
  let s = ZERO;
  for (const x of xs) s = add(s, x);
  return s;
};

export const cmp = (a: Rational, b: Rational): -1 | 0 | 1 => {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
};
export const eq = (a: Rational, b: Rational): boolean => a.n === b.n && a.d === b.d;
export const lt = (a: Rational, b: Rational): boolean => cmp(a, b) < 0;
export const le = (a: Rational, b: Rational): boolean => cmp(a, b) <= 0;
export const gt = (a: Rational, b: Rational): boolean => cmp(a, b) > 0;
export const ge = (a: Rational, b: Rational): boolean => cmp(a, b) >= 0;
export const isZero = (a: Rational): boolean => a.n === 0n;
export const sign = (a: Rational): -1 | 0 | 1 => (a.n < 0n ? -1 : a.n > 0n ? 1 : 0);
export const abs = (a: Rational): Rational => (a.n < 0n ? neg(a) : a);
export const isInteger = (a: Rational): boolean => a.d === 1n;
export const max = (a: Rational, b: Rational): Rational => (ge(a, b) ? a : b);
export const min = (a: Rational, b: Rational): Rational => (le(a, b) ? a : b);

/** Floor division of the rational: the largest integer <= a. */
export function floorInt(a: Rational): bigint {
  const q = a.n / a.d; // truncates toward zero
  return a.n < 0n && q * a.d !== a.n ? q - 1n : q;
}
/** The smallest integer >= a. */
export function ceilInt(a: Rational): bigint {
  return -floorInt(neg(a));
}

/** Canonical "n/d" text (used for exact JSON and test messages). */
export const toFraction = (a: Rational): string => (a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`);

/** Parse canonical "n/d" or "n" text (exact JSON form). Returns undefined when malformed. */
export function fromFraction(s: string): Rational | undefined {
  const m = /^(-?(?:0|[1-9][0-9]*))(?:\/([1-9][0-9]*))?$/.exec(s);
  if (!m) return undefined;
  const r = rat(BigInt(m[1]!), BigInt(m[2] ?? '1'));
  return toFraction(r) === s ? r : undefined;
}

/** Approximate value for sorting/colour thresholds only. Never use for money. */
export function toNumberApprox(a: Rational): number {
  return Number(a.n) / Number(a.d);
}
