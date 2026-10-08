// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sales counts for menu engineering, read from a CSV with an item column (menu item name or
// id) and a sold column, in English or Chinese. Rows for the same item are added together
// (and reported); unknown items and bad numbers are reported by line. Nothing is stored.

import { normaliseDecimalInput } from '../num/index';
import { parseCsv, toCsv, type CsvParseError } from './csv';

/** The largest count accepted for one item. */
export const MAX_SOLD = 1_000_000_000;

export type SalesProblem =
  | { kind: 'csv'; error: CsvParseError }
  | { kind: 'header'; column: 'item' | 'sold' }
  | { kind: 'row'; line: number; code: 'unknown-item' | 'ambiguous-item'; value: string }
  | { kind: 'row'; line: number; code: 'bad-sold'; value: string }
  | { kind: 'row'; line: number; code: 'too-many-sold'; value: string };

export interface SalesImport {
  /** menu item id → portions sold */
  sold: Map<string, number>;
  /** ids that appeared on more than one row (their counts were added) */
  merged: string[];
  problems: SalesProblem[];
}

/** How names are compared: Unicode-normalised, trimmed, single spaces, lower case. */
export const nameKey = (s: string): string =>
  s.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

const headerKey = (h: string) =>
  h
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
const ITEM = new Set([
  'item',
  'menuitem',
  'name',
  'dish',
  'id',
  '項目',
  '餐牌項目',
  '名稱',
  '菜式',
]);
const SOLD = new Set([
  'sold',
  'qty',
  'quantity',
  'count',
  'portions',
  '售出',
  '數量',
  '銷量',
  '份數',
]);

/** A whole number such as 12, 1,200 or full-width １２ (commas only between groups of 3). */
export function parseSold(text: string): number | 'bad' | 'too-many' {
  const t = normaliseDecimalInput(text);
  if (!/^(\d+|\d{1,3}(,\d{3})+)$/.test(t)) return 'bad';
  const n = Number(t.replace(/,/g, ''));
  return n > MAX_SOLD ? 'too-many' : n;
}

export function importSalesCsv(
  text: string,
  menu: readonly { id: string; name: string }[],
): SalesImport {
  const sold = new Map<string, number>();
  const merged = new Set<string>();
  const problems: SalesProblem[] = [];
  const parsed = parseCsv(text);
  if (!parsed.ok) return { sold, merged: [], problems: [{ kind: 'csv', error: parsed.error }] };
  const [header, ...body] = parsed.rows;
  let itemCol = -1;
  let soldCol = -1;
  header?.cells.forEach((h, i) => {
    const k = headerKey(h);
    if (itemCol < 0 && ITEM.has(k)) itemCol = i;
    else if (soldCol < 0 && SOLD.has(k)) soldCol = i;
  });
  if (itemCol < 0) problems.push({ kind: 'header', column: 'item' });
  if (soldCol < 0) problems.push({ kind: 'header', column: 'sold' });
  if (problems.length) return { sold, merged: [], problems };
  const byId = new Map(menu.map((m) => [m.id, m.id]));
  const byName = new Map<string, string | null>(); // null: two items share the name
  for (const m of menu) {
    const k = nameKey(m.name);
    byName.set(k, byName.has(k) ? null : m.id);
  }
  for (const row of body) {
    let item = (row.cells[itemCol] ?? '').trim();
    if (/^'[=+\-@]/.test(item)) item = item.slice(1); // our own exports neutralise these
    const count = (row.cells[soldCol] ?? '').trim();
    if (item === '' && count === '') continue;
    const named = byName.get(nameKey(item));
    const id = named ?? byId.get(item);
    if (id === undefined) {
      problems.push({
        kind: 'row',
        line: row.line,
        code: named === null ? 'ambiguous-item' : 'unknown-item',
        value: item,
      });
      continue;
    }
    const n = parseSold(count);
    if (n === 'bad' || n === 'too-many') {
      problems.push({
        kind: 'row',
        line: row.line,
        code: n === 'bad' ? 'bad-sold' : 'too-many-sold',
        value: count,
      });
      continue;
    }
    const prev = sold.get(id);
    const total = (prev ?? 0) + n;
    if (total > MAX_SOLD) {
      problems.push({ kind: 'row', line: row.line, code: 'too-many-sold', value: count });
      continue;
    }
    if (prev !== undefined) merged.add(id);
    sold.set(id, total);
  }
  return { sold, merged: [...merged], problems };
}

export function describeSalesProblem(p: SalesProblem, zh: boolean): string {
  if (p.kind === 'csv')
    return zh ? `第 ${p.error.line} 行：引號有誤。` : `Line ${p.error.line}: quote problem.`;
  if (p.kind === 'header')
    return p.column === 'item'
      ? zh
        ? '缺少「項目」欄（餐牌項目名稱）。'
        : 'Missing an "item" column (menu item name).'
      : zh
        ? '缺少「售出」欄（售出份數）。'
        : 'Missing a "sold" column (portions sold).';
  const where = zh ? `第 ${p.line} 行` : `Line ${p.line}`;
  switch (p.code) {
    case 'unknown-item':
      return zh
        ? `${where}：餐牌沒有「${p.value}」，已略過。`
        : `${where}: no menu item "${p.value}"; skipped.`;
    case 'ambiguous-item':
      return zh
        ? `${where}：有多於一個餐牌項目叫「${p.value}」，請改用不同名稱。`
        : `${where}: more than one menu item is called "${p.value}"; rename one.`;
    case 'bad-sold':
      return zh
        ? `${where}：「${p.value}」不是整數份數，已略過。`
        : `${where}: "${p.value}" is not a whole number of portions; skipped.`;
    case 'too-many-sold':
      return zh
        ? `${where}：份數太大（上限 ${MAX_SOLD}）。`
        : `${where}: count too large (limit ${MAX_SOLD}).`;
  }
}

/** Sales counts template / export: one row per menu item. */
export function salesToCsv(rows: readonly { name: string; sold: number }[], zh: boolean): string {
  const out = [zh ? ['項目', '售出'] : ['item', 'sold']];
  for (const r of rows) out.push([r.name, String(r.sold)]);
  return toCsv(out, { bom: true });
}
