// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Project data model. The *stored* form (what is saved and exported as JSON) keeps every
// number as the decimal text the user typed, so nothing is ever lost to binary floats. The
// *compiled* form (after validation) holds exact Rationals and resolved references.

import type { PriceRounding, Rational } from '../num/index';
import type { UnitId } from '../units/index';

export const PROJECT_SCHEMA = 'saucepenny/project';
export const PROJECT_VERSION = 1;

/** A built-in unit id, "portion" (recipe yields counted in portions) or "measure:<id>". */
export type UnitRef = UnitId | 'portion' | `measure:${string}`;

export interface StoredMeasure {
  id: string;
  name: string;
  /** e.g. "250" with unit "ml" for "my cup = 250 ml" */
  amount: string;
  unit: UnitId;
}

export interface StoredIngredient {
  id: string;
  name: string;
  packQty: string;
  packUnit: UnitRef;
  price: string;
  /** Usable share after trimming/peeling, in percent (0 < y <= 100). Default "100". */
  yieldPercent?: string;
  /** grams per millilitre */
  density?: string;
  /** grams per piece */
  pieceWeight?: string;
  /** YYYY-MM-DD */
  priceDate?: string;
  note?: string;
}

export type LineRef = { kind: 'ingredient'; id: string } | { kind: 'recipe'; id: string };

export interface StoredLine {
  ref: LineRef;
  qty: string;
  unit: UnitRef;
  /** Extra loss for this line only, in percent (0 <= w < 100). Default "0". */
  wastePercent?: string;
}

export interface StoredRecipe {
  id: string;
  name: string;
  yieldQty: string;
  yieldUnit: UnitRef;
  /** grams per millilitre of the finished recipe (to use it by weight ↔ volume). */
  density?: string;
  lines: StoredLine[];
  note?: string;
}

export interface StoredMenuItem {
  id: string;
  name: string;
  recipeId: string;
  portionQty: string;
  portionUnit: UnitRef;
  price: string;
  priceIncludesService: boolean;
  /** Target food cost, percent (0 < t <= 100). */
  targetPercent: string;
  rounding: PriceRounding;
}

export interface StoredSettings {
  /** ISO 4217 code, e.g. "HKD". */
  currency: string;
  /** Service charge in percent, e.g. "10". */
  serviceChargePercent: string;
  /** Food cost % at or below this is shown as good. */
  goodPercent: string;
  /** Food cost % above this is shown as high (between the two: watch). */
  highPercent: string;
}

export interface StoredProject {
  schema: typeof PROJECT_SCHEMA;
  version: typeof PROJECT_VERSION;
  name: string;
  settings: StoredSettings;
  measures: StoredMeasure[];
  ingredients: StoredIngredient[];
  recipes: StoredRecipe[];
  menu: StoredMenuItem[];
}

// ---- Compiled (validated, exact) ------------------------------------------------------

export interface Measure {
  id: string;
  name: string;
  amount: Rational;
  unit: UnitId;
}

export interface Ingredient {
  id: string;
  name: string;
  packQty: Rational;
  packUnit: UnitRef;
  price: Rational;
  /** fraction 0 < y <= 1 */
  yield: Rational;
  density: Rational | undefined;
  pieceWeight: Rational | undefined;
  priceDate: string | undefined;
  note: string;
}

export interface Line {
  ref: LineRef;
  qty: Rational;
  unit: UnitRef;
  /** fraction 0 <= w < 1 */
  waste: Rational;
}

export interface Recipe {
  id: string;
  name: string;
  yieldQty: Rational;
  yieldUnit: UnitRef;
  density: Rational | undefined;
  lines: Line[];
  note: string;
}

export interface MenuItem {
  id: string;
  name: string;
  recipeId: string;
  portionQty: Rational;
  portionUnit: UnitRef;
  price: Rational;
  priceIncludesService: boolean;
  /** fraction 0 < t <= 1 */
  target: Rational;
  rounding: PriceRounding;
}

export interface Settings {
  currency: string;
  /** fraction, e.g. 1/10 */
  serviceCharge: Rational;
  good: Rational;
  high: Rational;
}

export interface Project {
  name: string;
  settings: Settings;
  measures: ReadonlyMap<string, Measure>;
  ingredients: ReadonlyMap<string, Ingredient>;
  recipes: ReadonlyMap<string, Recipe>;
  menu: ReadonlyMap<string, MenuItem>;
}
