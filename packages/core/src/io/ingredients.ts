// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Ingredient list as CSV: export, and import with English or Chinese headers, full-width
// digits, thousands commas (inside quotes) and units such as 斤 or 兩. Every imported row is
// validated with the same rules as the editor; problems are reported by row and column.

import type { Lang } from '../i18n/index';
import { LIMITS } from '../model/limits';
import type { ProjectError, StoredIngredient } from '../model/index';
import { emptyProject, validateProject } from '../model/index';
import {
  normaliseDecimalInput,
  normaliseQuantityInput,
  parseDecimal,
  parseQuantity,
} from '../num/index';
import { parseUnit } from '../units/index';
import { parseCsv, toCsv, type CsvParseError } from './csv';

export const INGREDIENT_COLUMNS = [
  'name',
  'packQty',
  'packUnit',
  'price',
  'yieldPercent',
  'density',
  'pieceWeight',
  'priceDate',
  'note',
] as const;
export type IngredientColumn = (typeof INGREDIENT_COLUMNS)[number];

const HEADERS: Record<Lang, Record<IngredientColumn, string>> = {
  en: {
    name: 'name',
    packQty: 'pack qty',
    packUnit: 'unit',
    price: 'price',
    yieldPercent: 'yield %',
    density: 'density g/ml',
    pieceWeight: 'piece weight g',
    priceDate: 'price date',
    note: 'note',
  },
  'zh-HK': {
    name: '名稱',
    packQty: '包裝數量',
    packUnit: '單位',
    price: '價錢',
    yieldPercent: '可用率 %',
    density: '密度 g/ml',
    pieceWeight: '每件重量 g',
    priceDate: '價格日期',
    note: '備註',
  },
};

const ALIASES: Record<string, IngredientColumn> = {};
const key = (h: string) =>
  normaliseDecimalInput(h)
    .toLowerCase()
    .replace(/[（(][^)）]*[)）]/g, '')
    .replace(/[\s_%％/-]|g\/ml|^g$/g, '')
    .replace(/(g|克)$/, '');
for (const lang of Object.keys(HEADERS) as Lang[])
  for (const col of INGREDIENT_COLUMNS) ALIASES[key(HEADERS[lang][col])] = col;
for (const [alias, col] of Object.entries({
  ingredient: 'name',
  食材: 'name',
  食材名稱: 'name',
  qty: 'packQty',
  quantity: 'packQty',
  packquantity: 'packQty',
  數量: 'packQty',
  packunit: 'packUnit',
  價格: 'price',
  yield: 'yieldPercent',
  可用率: 'yieldPercent',
  density: 'density',
  weightperpiece: 'pieceWeight',
  date: 'priceDate',
  日期: 'priceDate',
  notes: 'note',
} as Record<string, IngredientColumn>))
  ALIASES[key(alias)] = col;

export function ingredientsToCsv(list: readonly StoredIngredient[], lang: Lang = 'en'): string {
  const h = HEADERS[lang];
  const rows = [INGREDIENT_COLUMNS.map((c) => h[c])];
  for (const ing of list)
    rows.push(INGREDIENT_COLUMNS.map((c) => (ing[c] === undefined ? '' : String(ing[c]))));
  return toCsv(rows, { bom: true });
}

export type ImportProblem =
  | { kind: 'csv'; error: CsvParseError }
  | { kind: 'header'; code: 'csv-missing-column' | 'csv-duplicate-column'; column: string }
  | { kind: 'header'; code: 'csv-unknown-column'; column: string }
  | { kind: 'row'; line: number; column: IngredientColumn | ''; error: ProjectError };

export interface ImportResult {
  ingredients: StoredIngredient[];
  problems: ImportProblem[];
}

const NUMERIC: IngredientColumn[] = ['packQty', 'price', 'yieldPercent', 'density', 'pieceWeight'];

/** New ids "ing-1", "ing-2", … that do not clash with `taken`. */
function idMaker(taken: ReadonlySet<string>) {
  let n = 0;
  return () => {
    let id: string;
    do id = `ing-${++n}`;
    while (taken.has(id));
    return id;
  };
}

export function importIngredientsCsv(
  text: string,
  taken: ReadonlySet<string> = new Set(),
): ImportResult {
  const problems: ImportProblem[] = [];
  const parsed = parseCsv(text);
  if (!parsed.ok) return { ingredients: [], problems: [{ kind: 'csv', error: parsed.error }] };
  const [header, ...body] = parsed.rows;
  if (!header)
    return {
      ingredients: [],
      problems: [{ kind: 'header', code: 'csv-missing-column', column: 'name' }],
    };
  const index = new Map<IngredientColumn, number>();
  header.cells.forEach((h, i) => {
    if (h.trim() === '') return;
    const col = ALIASES[key(h)];
    if (!col) problems.push({ kind: 'header', code: 'csv-unknown-column', column: h });
    else if (index.has(col))
      problems.push({ kind: 'header', code: 'csv-duplicate-column', column: h });
    else index.set(col, i);
  });
  for (const col of ['name', 'packQty', 'packUnit', 'price'] as const)
    if (!index.has(col))
      problems.push({ kind: 'header', code: 'csv-missing-column', column: HEADERS.en[col] });
  if (problems.some((p) => p.kind === 'header' && p.code !== 'csv-unknown-column'))
    return { ingredients: [], problems };
  if (body.length > LIMITS.ingredients) {
    problems.push({
      kind: 'row',
      line: body[LIMITS.ingredients]!.line,
      column: '',
      error: { code: 'too-many', path: '', params: { max: LIMITS.ingredients } },
    });
    return { ingredients: [], problems };
  }
  const nextId = idMaker(taken);
  const candidates: { line: number; ing: StoredIngredient }[] = [];
  for (const row of body) {
    const get = (c: IngredientColumn) => {
      const i = index.get(c);
      return i === undefined ? '' : (row.cells[i] ?? '').trim();
    };
    if (INGREDIENT_COLUMNS.every((c) => get(c) === '')) continue; // a row of empty cells
    let bad = false;
    const ing: StoredIngredient = {
      id: nextId(),
      name: get('name'),
      packQty: '',
      packUnit: 'g',
      price: '',
    };
    for (const c of NUMERIC) {
      let v = get(c);
      if (v === '' && c !== 'packQty' && c !== 'price') continue;
      if (/^'[=+\-@]/.test(v)) v = v.slice(1); // our own exports neutralise formula-like cells
      const r = c === 'packQty' ? parseQuantity(v) : parseDecimal(v);
      if (!r.ok) {
        problems.push({
          kind: 'row',
          line: row.line,
          column: c,
          error: { code: r.error, path: c },
        });
        bad = true;
        continue;
      }
      (ing as unknown as Record<string, string>)[c] =
        c === 'packQty' && normaliseQuantityInput(v).includes('/')
          ? normaliseQuantityInput(v)
          : normaliseDecimalInput(v).replace(/,/g, '');
    }
    const unitText = get('packUnit');
    const unit = parseUnit(unitText);
    if (!unit) {
      problems.push({
        kind: 'row',
        line: row.line,
        column: 'packUnit',
        error: { code: 'bad-unit', path: 'packUnit', params: { unit: unitText } },
      });
      bad = true;
    } else ing.packUnit = unit;
    const date = get('priceDate');
    if (date) ing.priceDate = normaliseDecimalInput(date);
    const note = get('note');
    if (note) ing.note = note;
    if (!bad) candidates.push({ line: row.line, ing });
  }
  // Same validation as the editor, with errors mapped back to CSV rows.
  const p = emptyProject('import');
  p.ingredients = candidates.map((c) => c.ing);
  const v = validateProject(p);
  const badRows = new Set<number>();
  if (!v.ok)
    for (const e of v.errors) {
      const m = /^ingredients\[(\d+)\](?:\.(\w+))?/.exec(e.path);
      if (!m) continue;
      const k = Number(m[1]);
      badRows.add(k);
      const col = (m[2] ?? '') as IngredientColumn | '';
      problems.push({
        kind: 'row',
        line: candidates[k]!.line,
        column: col,
        error: { ...e, path: col },
      });
    }
  return { ingredients: candidates.filter((_, k) => !badRows.has(k)).map((c) => c.ing), problems };
}

export function describeImportProblem(
  p: ImportProblem,
  lang: Lang,
  describe: (e: ProjectError) => string,
): string {
  const zh = lang === 'zh-HK';
  if (p.kind === 'csv')
    return p.error.code === 'csv-unterminated-quote'
      ? zh
        ? `第 ${p.error.line} 行：引號沒有關上。`
        : `Line ${p.error.line}: a quote is never closed.`
      : zh
        ? `第 ${p.error.line} 行：引號位置不正確。`
        : `Line ${p.error.line}: misplaced quote.`;
  if (p.kind === 'header') {
    if (p.code === 'csv-missing-column')
      return zh ? `缺少欄位「${p.column}」。` : `Missing column "${p.column}".`;
    if (p.code === 'csv-duplicate-column')
      return zh ? `欄位「${p.column}」重複。` : `Column "${p.column}" appears twice.`;
    return zh ? `不認識欄位「${p.column}」，已略過。` : `Unknown column "${p.column}" ignored.`;
  }
  const col = p.column ? (zh ? HEADERS['zh-HK'][p.column] : HEADERS.en[p.column]) : '';
  const where = zh
    ? `第 ${p.line} 行${col ? `「${col}」` : ''}`
    : `Line ${p.line}${col ? `, ${col}` : ''}`;
  return `${where}: ${describe({ ...p.error, path: '' })}`;
}
