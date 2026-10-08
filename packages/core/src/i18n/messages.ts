// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Plain-language error messages in English and Traditional Chinese (Hong Kong), shared by
// the web UI and the CLI.

import type { ErrorCode, Project, ProjectError } from '../model/index';

export type Lang = 'en' | 'zh-HK';
export const LANGS: readonly Lang[] = ['en', 'zh-HK'];

type Params = Record<string, string | number>;
type Msg = (p: Params) => string;

const EN: Record<ErrorCode, Msg> = {
  'file-too-large': (p) => `The file is too large (limit ${p.max} bytes).`,
  'invalid-json': () => 'This is not a valid JSON file.',
  'too-deep': (p) => `The file is nested too deeply (limit ${p.max} levels).`,
  'forbidden-key': () => 'The file contains a forbidden key and was not loaded.',
  'not-a-project': () => 'This is not a Saucepenny project file.',
  'newer-version': (p) =>
    `This file was made by a newer Saucepenny (format ${p.version}). Please update.`,
  'unsupported-version': () => 'This project format version is not supported.',
  type: (p) => `Wrong type: expected ${p.expected}.`,
  required: () => 'Required.',
  empty: () => 'Must not be empty.',
  'not-a-number': () => 'Not a number.',
  exponent: () => 'Please type the number in full (no "e" notation).',
  'multiple-points': () => 'More than one decimal point.',
  'bad-grouping': () => 'Thousands commas must separate groups of three digits.',
  'too-many-digits': () => 'Too many digits (at most 15 significant digits).',
  'too-long': (p) => `Too long (at most ${p.max} characters).`,
  'bad-id': () => 'Invalid id.',
  'duplicate-id': (p) => `The id "${p.id}" is used twice.`,
  'bad-currency': () => 'Currency must be a three-letter code such as HKD.',
  'bad-date': () => 'Dates must be YYYY-MM-DD.',
  'bad-unit': () => 'Unknown unit.',
  'unknown-measure': () => 'Unknown custom measure.',
  'unknown-ingredient': (p) => `Unknown ingredient "${p.id}".`,
  'unknown-recipe': (p) => `Unknown recipe "${p.id}".`,
  'must-be-positive': () => 'Must be greater than 0.',
  'must-not-be-negative': () => 'Must not be negative.',
  'yield-out-of-range': () => 'Usable yield must be more than 0% and at most 100%.',
  'waste-out-of-range': () => 'Line waste must be at least 0% and less than 100%.',
  'percent-out-of-range': () => 'Must be between 0% and 100%.',
  'target-out-of-range': () => 'Target food cost must be more than 0% and at most 100%.',
  'band-order': () => 'The "good" limit must not be above the "high" limit.',
  'bad-rounding': () => 'Unknown rounding rule.',
  'too-many': (p) => `Too many items (limit ${p.max}).`,
  cycle: (p) =>
    p.cycle
      ? `Recipes use each other in a circle: ${p.cycle}.`
      : 'Recipes use each other in a circle.',
  'too-deep-nesting': (p) => `Sub-recipes are nested more than ${p.max} levels deep.`,
  'needs-density': (p) =>
    `${p.item ? `"${p.item}": ` : ''}converting between weight and volume needs a density (g/ml).`,
  'needs-piece-weight': (p) =>
    `${p.item ? `"${p.item}": ` : ''}converting pieces needs a weight per piece (g).`,
  'incompatible-units': () =>
    'These units cannot be converted (for example portions of a recipe that yields litres).',
  'zero-yield': () => 'The recipe yields 0.',
  'zero-price': () => 'The price is 0, so a food cost % cannot be worked out.',
  'recipe-error': (p) => `The recipe "${p.recipe}" has a problem; fix it first.`,
};

const ZH: Record<ErrorCode, Msg> = {
  'file-too-large': (p) => `檔案太大（上限 ${p.max} bytes）。`,
  'invalid-json': () => '這不是有效的 JSON 檔案。',
  'too-deep': (p) => `檔案層次太深（上限 ${p.max} 層）。`,
  'forbidden-key': () => '檔案含有被禁止的欄位名稱，沒有載入。',
  'not-a-project': () => '這不是菜本易的項目檔案。',
  'newer-version': (p) => `這個檔案由較新版本的菜本易建立（格式 ${p.version}），請先更新。`,
  'unsupported-version': () => '不支援這個項目格式版本。',
  type: (p) => `類型錯誤：應為 ${p.expected}。`,
  required: () => '必須填寫。',
  empty: () => '不可留空。',
  'not-a-number': () => '不是數字。',
  exponent: () => '請輸入完整數字（不要用 e 記數法）。',
  'multiple-points': () => '有多於一個小數點。',
  'bad-grouping': () => '千位逗號必須每三位數一組。',
  'too-many-digits': () => '位數太多（最多 15 位有效數字）。',
  'too-long': (p) => `太長（最多 ${p.max} 個字元）。`,
  'bad-id': () => '編號無效。',
  'duplicate-id': (p) => `編號「${p.id}」重複。`,
  'bad-currency': () => '貨幣須為三個字母，例如 HKD。',
  'bad-date': () => '日期格式須為 YYYY-MM-DD。',
  'bad-unit': () => '不認識這個單位。',
  'unknown-measure': () => '不認識這個自訂量度。',
  'unknown-ingredient': (p) => `找不到食材「${p.id}」。`,
  'unknown-recipe': (p) => `找不到食譜「${p.id}」。`,
  'must-be-positive': () => '必須大於 0。',
  'must-not-be-negative': () => '不可以是負數。',
  'yield-out-of-range': () => '可用率須大於 0% 及不多於 100%。',
  'waste-out-of-range': () => '損耗須至少 0% 及少於 100%。',
  'percent-out-of-range': () => '須在 0% 至 100% 之間。',
  'target-out-of-range': () => '目標食材成本率須大於 0% 及不多於 100%。',
  'band-order': () => '「良好」上限不可高於「偏高」界線。',
  'bad-rounding': () => '不認識這個進位規則。',
  'too-many': (p) => `項目太多（上限 ${p.max}）。`,
  cycle: (p) => (p.cycle ? `食譜互相引用成循環：${p.cycle}。` : '食譜互相引用成循環。'),
  'too-deep-nesting': (p) => `子食譜嵌套超過 ${p.max} 層。`,
  'needs-density': (p) => `${p.item ? `「${p.item}」：` : ''}重量與容量互換需要密度（克／毫升）。`,
  'needs-piece-weight': (p) => `${p.item ? `「${p.item}」：` : ''}以件計需要每件重量（克）。`,
  'incompatible-units': () => '這些單位無法互換（例如以「份」計一個以公升為產出量的食譜）。',
  'zero-yield': () => '食譜產出量為 0。',
  'zero-price': () => '售價為 0，無法計算食材成本率。',
  'recipe-error': (p) => `食譜「${p.recipe}」有問題，請先修正。`,
};

const SECTION: Record<Lang, Record<string, string>> = {
  en: {
    ingredients: 'Ingredient',
    recipes: 'Recipe',
    menu: 'Menu item',
    measures: 'Measure',
    lines: 'line',
    settings: 'Settings',
  },
  'zh-HK': {
    ingredients: '食材',
    recipes: '食譜',
    menu: '餐牌項目',
    measures: '量度',
    lines: '第',
    settings: '設定',
  },
};

/** "ingredients[3].price" or "recipes.charsiu.lines[1]" → "Ingredient 梅頭肉 · price". */
export function describeLocation(path: string, lang: Lang, project?: Project): string {
  if (!path) return '';
  const s = SECTION[lang];
  const m = /^(ingredients|recipes|menu|measures)(?:\[(\d+)\]|\.([^.[]+))(.*)$/.exec(path);
  if (!m)
    return path === 'settings' || path.startsWith('settings.') ? s.settings! + path.slice(8) : path;
  const [, section, index, id, rest = ''] = m;
  let name = index !== undefined ? `#${Number(index) + 1}` : id!;
  if (project && id !== undefined) {
    const coll = project[section as 'ingredients' | 'recipes' | 'menu' | 'measures'];
    const found = (coll as ReadonlyMap<string, { name: string }>).get(id);
    if (found) name = found.name;
  }
  let tail = rest.replace(/^\./, '');
  const line = /^lines\[(\d+)\](.*)$/.exec(tail);
  if (line) {
    const n = Number(line[1]) + 1;
    tail = (lang === 'en' ? `line ${n}` : `第 ${n} 行`) + (line[2] ?? '');
  }
  return [`${s[section!]} ${name}`, tail].filter(Boolean).join(' · ');
}

export function describeError(e: ProjectError, lang: Lang = 'en', project?: Project): string {
  const msg = (lang === 'en' ? EN : ZH)[e.code](e.params ?? {});
  const where = describeLocation(e.path, lang, project);
  return where ? `${where}: ${msg}` : msg;
}

/** Codes that have messages (for tests). */
export const MESSAGE_CODES = Object.keys(EN) as ErrorCode[];
export const ZH_CODES = Object.keys(ZH) as ErrorCode[];
