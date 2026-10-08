// SPDX-License-Identifier: AGPL-3.0-or-later
/** Hard limits (design §2.1). Exceeding one is a clear, bilingual error. */
export const LIMITS = Object.freeze({
  ingredients: 2000,
  recipes: 1000,
  linesPerRecipe: 100,
  nestingDepth: 20,
  menuItems: 1000,
  measures: 50,
  nameLength: 200,
  noteLength: 2000,
  idLength: 64,
  /** bytes of JSON text */
  fileBytes: 10 * 1024 * 1024,
  /** nesting of JSON arrays/objects in a file */
  jsonDepth: 16,
});
