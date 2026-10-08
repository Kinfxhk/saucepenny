// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Structured errors: a stable code, the location in the project and parameters. Messages
// in English and Traditional Chinese are produced by i18n/messages.ts from these.

export type ErrorCode =
  // file level
  | 'file-too-large'
  | 'invalid-json'
  | 'too-deep'
  | 'forbidden-key'
  | 'not-a-project'
  | 'newer-version'
  | 'unsupported-version'
  // field level
  | 'type'
  | 'required'
  | 'empty'
  | 'not-a-number'
  | 'exponent'
  | 'multiple-points'
  | 'bad-grouping'
  | 'too-many-digits'
  | 'bad-fraction'
  | 'zero-denominator'
  | 'too-long'
  | 'bad-id'
  | 'duplicate-id'
  | 'bad-currency'
  | 'bad-date'
  | 'bad-unit'
  | 'unknown-measure'
  | 'unknown-ingredient'
  | 'unknown-recipe'
  | 'must-be-positive'
  | 'must-not-be-negative'
  | 'yield-out-of-range'
  | 'waste-out-of-range'
  | 'percent-out-of-range'
  | 'target-out-of-range'
  | 'overhead-out-of-range'
  | 'band-order'
  | 'bad-rounding'
  | 'too-many'
  // costing
  | 'cycle'
  | 'too-deep-nesting'
  | 'needs-density'
  | 'needs-piece-weight'
  | 'incompatible-units'
  | 'zero-yield'
  | 'zero-price'
  | 'recipe-error';

export interface ProjectError {
  code: ErrorCode;
  /** e.g. "ingredients[3].yieldPercent" */
  path: string;
  params?: Record<string, string | number>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; errors: ProjectError[] };
