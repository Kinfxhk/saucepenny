// SPDX-License-Identifier: AGPL-3.0-or-later
//
// CSV per RFC 4180: comma separated, CRLF line ends, fields quoted when they contain a
// comma, quote, CR or LF (quotes doubled). Exported cells that a spreadsheet could run as
// a formula (starting with = + - @, Tab or CR) get a leading apostrophe.

export const BOM = '\uFEFF';

const FORMULA_START = /^[=+\-@\t\r]/;

/** Neutralise a cell a spreadsheet would treat as a formula. */
export function neutralise(cell: string): string {
  return FORMULA_START.test(cell) ? `'${cell}` : cell;
}

export function quoteCell(cell: string): string {
  return /[",\r\n]/.test(cell) || /^\s|\s$/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export interface CsvWriteOptions {
  /** prefix formula-like cells (default true; only tests turn it off) */
  neutralise?: boolean;
  /** start with a UTF-8 byte order mark so spreadsheet apps read Chinese correctly */
  bom?: boolean;
}

export function toCsv(rows: readonly (readonly string[])[], opts: CsvWriteOptions = {}): string {
  const safe = opts.neutralise ?? true;
  const body = rows
    .map((r) => r.map((c) => quoteCell(safe ? neutralise(c) : c)).join(','))
    .map((line) => `${line}\r\n`)
    .join('');
  return (opts.bom ? BOM : '') + body;
}

export type CsvParseError = { code: 'csv-unterminated-quote' | 'csv-stray-quote'; line: number };
export type CsvRow = { line: number; cells: string[] };
export type CsvParseResult = { ok: true; rows: CsvRow[] } | { ok: false; error: CsvParseError };

/**
 * Parse CSV text: optional BOM; CRLF, LF or CR line ends; quoted fields with doubled quotes,
 * commas and line breaks inside. Blank lines are skipped. `line` is the 1-based line on
 * which the record starts.
 */
export function parseCsv(text: string): CsvParseResult {
  const s = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false; // inside quotes
  let wasQuoted = false; // current cell started with a quote
  let line = 1;
  let start = 1;
  let i = 0;
  const endRecord = () => {
    cells.push(cell);
    if (!(cells.length === 1 && cells[0] === '' && !wasQuoted)) rows.push({ line: start, cells });
    cells = [];
    cell = '';
    wasQuoted = false;
  };
  while (i < s.length) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        const next = s[i];
        if (next !== undefined && next !== ',' && next !== '\r' && next !== '\n')
          return { ok: false, error: { code: 'csv-stray-quote', line } };
        continue;
      }
      if (ch === '\n' || (ch === '\r' && s[i + 1] !== '\n')) line++;
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      if (cell !== '') return { ok: false, error: { code: 'csv-stray-quote', line } };
      quoted = true;
      wasQuoted = true;
      i++;
      continue;
    }
    if (ch === ',') {
      cells.push(cell);
      cell = '';
      wasQuoted = false;
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      endRecord();
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
      line++;
      start = line;
      continue;
    }
    cell += ch;
    i++;
  }
  if (quoted) return { ok: false, error: { code: 'csv-unterminated-quote', line: start } };
  if (cell !== '' || cells.length > 0 || wasQuoted) endRecord();
  return { ok: true, rows };
}
