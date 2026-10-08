// @ts-check
// SPDX-License-Identifier: AGPL-3.0-or-later
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** Money and quantities are exact rationals. Floating-point helpers are banned where they would leak in. */
const NO_FLOAT_PROPERTIES = [
  { object: 'Math', property: 'round', message: 'Use exact rounding from num/.' },
  { object: 'Math', property: 'floor', message: 'Use exact rounding from num/.' },
  { object: 'Math', property: 'ceil', message: 'Use exact rounding from num/.' },
  { object: 'Math', property: 'trunc', message: 'Use exact rounding from num/.' },
  { object: 'Number', property: 'parseFloat', message: 'Use parseDecimal from num/.' },
  { object: 'Math', property: 'random', message: 'Core must be deterministic.' },
  { object: 'Date', property: 'now', message: 'Core must not read the clock.' },
];
const NO_FLOAT_SYNTAX = [
  {
    selector: "MemberExpression[property.name='toFixed']",
    message: 'toFixed rounds binary floats; use formatMoney from num/.',
  },
  {
    selector: "MemberExpression[property.name='toPrecision']",
    message: 'toPrecision rounds binary floats; use num/.',
  },
  {
    selector: 'Literal[raw=/^[0-9]*\\.[0-9]+(e[+-]?[0-9]+)?$/i]',
    message: 'No floating-point literals in exact code; use a Rational.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'release/**',
      'test-results/**',
      'playwright-report/**',
      'test/scripts/fixtures/**',
      'packages/core/src/*-mutant-*/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    // The core must stay pure: no I/O, no clock, no ambient randomness.
    files: ['packages/core/src/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['node:*', 'fs', 'path', 'http', 'https', 'net', 'child_process'] },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Core must be deterministic.' },
        { object: 'Date', property: 'now', message: 'Core must not read the clock.' },
      ],
      'no-restricted-globals': ['error', 'fetch', 'XMLHttpRequest', 'localStorage', 'window'],
    },
  },
  {
    // Exact code: numbers, units, costing engine and checker never touch binary floats.
    files: [
      'packages/core/src/num/**/*.ts',
      'packages/core/src/units/**/*.ts',
      'packages/core/src/cost/**/*.ts',
      'packages/core/src/check/**/*.ts',
    ],
    rules: {
      'no-restricted-properties': ['error', ...NO_FLOAT_PROPERTIES],
      'no-restricted-globals': [
        'error',
        'fetch',
        'XMLHttpRequest',
        'localStorage',
        'window',
        { name: 'parseFloat', message: 'Use parseDecimal from num/.' },
      ],
      'no-restricted-syntax': ['error', ...NO_FLOAT_SYNTAX],
    },
  },
  {
    // The independent checker must never depend on the costing engine (or anything that
    // imports it), so an engine bug cannot hide itself from the checker.
    files: ['packages/core/src/check/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['..', '../', '../index', '../index.ts', '../api', '../api.ts'],
          patterns: ['node:*', 'fs', 'path', '**/cost', '**/cost/**', '**/api', '**/api.ts'],
        },
      ],
    },
  },
  {
    files: ['packages/web/src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  prettier,
);
