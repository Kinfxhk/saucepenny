// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Unit table: exact rational factors to the base unit of each dimension.
// Every constant is cited in docs/units.md (Hong Kong Cap. 68 First Schedule; NIST
// Handbook 44 Appendix C). Factors are written as integer fractions on purpose: no float.

import { div, mul, rat, type Rational } from '../num/index';

export type Dimension = 'mass' | 'volume' | 'count';
export type UnitId =
  | 'mg'
  | 'g'
  | 'kg'
  | 'oz'
  | 'lb'
  | 'catty'
  | 'tael'
  | 'ml'
  | 'l'
  | 'tsp'
  | 'tbsp'
  | 'cup'
  | 'floz'
  | 'piece';

export interface UnitDef {
  readonly id: UnitId;
  readonly dimension: Dimension;
  /** How many base units (g, ml or piece) one of this unit is, exactly. */
  readonly factor: Rational;
  readonly en: string;
  readonly zh: string;
}

// Mass (base: gram).
/** Cap. 68: 1 pound = 0.453 592 37 kilogram exactly → 45359237/100000 g. */
const POUND_G = rat(45359237n, 100000n);
/** Cap. 68: 1 ounce = 1/16 pound. */
const OUNCE_G = div(POUND_G, rat(16n));
/** Cap. 68 (c): 1 catty = 0.604 789 82 kilogram → 60478982/100000 g. */
const CATTY_G = rat(60478982n, 100000n);
/** Cap. 68 (c): 1 tael = 1/16 catty. */
const TAEL_G = div(CATTY_G, rat(16n));

// Volume (base: millilitre).
/** NIST HB44 App. C: 1 inch = 2.54 cm exactly → 1 in³ = 2.54³ cm³ = 16.387064 mL. */
const CUBIC_INCH_ML = rat(16387064n, 1000000n);
/** NIST HB44 App. C: 1 gallon = 231 in³ = 128 fluid ounces (both exactly). */
const FLOZ_ML = div(mul(rat(231n), CUBIC_INCH_ML), rat(128n));
/** NIST: cup = 8 fl oz; tablespoon = 1/2 fl oz; teaspoon = 1/3 tablespoon (all exactly). */
const CUP_ML = mul(rat(8n), FLOZ_ML);
const TBSP_ML = div(FLOZ_ML, rat(2n));
const TSP_ML = div(TBSP_ML, rat(3n));

export const UNITS: Readonly<Record<UnitId, UnitDef>> = Object.freeze({
  mg: { id: 'mg', dimension: 'mass', factor: rat(1n, 1000n), en: 'mg', zh: '毫克' },
  g: { id: 'g', dimension: 'mass', factor: rat(1n), en: 'g', zh: '克' },
  kg: { id: 'kg', dimension: 'mass', factor: rat(1000n), en: 'kg', zh: '公斤' },
  oz: { id: 'oz', dimension: 'mass', factor: OUNCE_G, en: 'oz', zh: '安士' },
  lb: { id: 'lb', dimension: 'mass', factor: POUND_G, en: 'lb', zh: '磅' },
  catty: { id: 'catty', dimension: 'mass', factor: CATTY_G, en: 'catty (斤)', zh: '斤' },
  tael: { id: 'tael', dimension: 'mass', factor: TAEL_G, en: 'tael (兩)', zh: '兩' },
  ml: { id: 'ml', dimension: 'volume', factor: rat(1n), en: 'ml', zh: '毫升' },
  l: { id: 'l', dimension: 'volume', factor: rat(1000n), en: 'L', zh: '公升' },
  tsp: { id: 'tsp', dimension: 'volume', factor: TSP_ML, en: 'tsp (US)', zh: '茶匙（美制）' },
  tbsp: { id: 'tbsp', dimension: 'volume', factor: TBSP_ML, en: 'tbsp (US)', zh: '湯匙（美制）' },
  cup: { id: 'cup', dimension: 'volume', factor: CUP_ML, en: 'cup (US)', zh: '杯（美制）' },
  floz: {
    id: 'floz',
    dimension: 'volume',
    factor: FLOZ_ML,
    en: 'fl oz (US)',
    zh: '液安士（美制）',
  },
  piece: { id: 'piece', dimension: 'count', factor: rat(1n), en: 'piece', zh: '件' },
});

export const UNIT_IDS = Object.keys(UNITS) as UnitId[];
export const isUnitId = (x: unknown): x is UnitId =>
  typeof x === 'string' && Object.prototype.hasOwnProperty.call(UNITS, x);

export const BASE_UNIT: Readonly<Record<Dimension, UnitId>> = {
  mass: 'g',
  volume: 'ml',
  count: 'piece',
};

/** Words people type for each unit (case-insensitive for Latin letters). */
const ALIASES: Record<string, UnitId> = {
  mg: 'mg',
  毫克: 'mg',
  g: 'g',
  gram: 'g',
  grams: 'g',
  克: 'g',
  公克: 'g',
  kg: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  公斤: 'kg',
  千克: 'kg',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  安士: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  磅: 'lb',
  catty: 'catty',
  catties: 'catty',
  斤: 'catty',
  tael: 'tael',
  taels: 'tael',
  兩: 'tael',
  两: 'tael',
  ml: 'ml',
  毫升: 'ml',
  l: 'l',
  litre: 'l',
  liter: 'l',
  litres: 'l',
  liters: 'l',
  公升: 'l',
  升: 'l',
  tsp: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  茶匙: 'tsp',
  tbsp: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  湯匙: 'tbsp',
  汤匙: 'tbsp',
  cup: 'cup',
  cups: 'cup',
  杯: 'cup',
  floz: 'floz',
  'fl oz': 'floz',
  'fl. oz': 'floz',
  'fl. oz.': 'floz',
  液安士: 'floz',
  piece: 'piece',
  pieces: 'piece',
  pc: 'piece',
  pcs: 'piece',
  ea: 'piece',
  each: 'piece',
  件: 'piece',
  隻: 'piece',
  只: 'piece',
  個: 'piece',
  个: 'piece',
  粒: 'piece',
};

/** Resolve typed unit text (e.g. "斤", "KG", "fl oz") to a unit id, or undefined. */
export function parseUnit(text: string): UnitId | undefined {
  const key = text
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[（(]us[)）]$/, '')
    .trim();
  return Object.prototype.hasOwnProperty.call(ALIASES, key) ? ALIASES[key] : undefined;
}
