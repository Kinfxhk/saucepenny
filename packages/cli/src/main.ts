// SPDX-License-Identifier: AGPL-3.0-or-later
// Saucepenny command line. Same core (and the same verified numbers) as the web UI.
//
//   saucepenny cost <project.json> [--lang en|zh-HK] [--csv menu|recipes] [--out FILE]
//   saucepenny check <project.json> [--lang en|zh-HK]
//   saucepenny impact <project.json> <ingredient id or name> <new price> [--lang en|zh-HK]
//   saucepenny --version | --help
//
// Exit codes: 0 ok; 1 usage or input error; 2 some recipe or menu item has a problem (each
// is explained); 4 internal check failed (engine and checker disagree — please report).

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import {
  describeError,
  ENGINE_VERSION,
  impactReport,
  LIMITS,
  menuCsv,
  parseDecimal,
  readProjectJson,
  recipesCsv,
  textReport,
  verifiedProject,
  type Lang,
  type Project,
} from '@saucepenny/core';

export class UsageError extends Error {}

export const HELP = `Saucepenny ${ENGINE_VERSION} — recipe costing and menu pricing (estimates only, not accounting or tax advice)

Usage:
  saucepenny cost <project.json> [--lang en|zh-HK] [--csv menu|recipes] [--out FILE]
  saucepenny check <project.json> [--lang en|zh-HK]
  saucepenny impact <project.json> <ingredient id or name> <new price> [--lang en|zh-HK]
  saucepenny --version | --help

Exit codes: 0 ok, 1 usage or input error, 2 some items have problems, 4 internal check failed.
`;

interface Opts {
  positional: string[];
  flags: Map<string, string | true>;
}

export function parseArgs(argv: string[]): Opts {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  const valued = new Set(['--lang', '--csv', '--out']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const [k, v] = eq >= 0 ? [a.slice(0, eq), a.slice(eq + 1)] : [a, undefined];
      if (valued.has(k)) {
        const val = v ?? argv[++i];
        if (val === undefined) throw new UsageError(`${k} needs a value`);
        flags.set(k, val);
      } else if (k === '--help' || k === '--version') flags.set(k, true);
      else throw new UsageError(`unknown option ${k}`);
    } else positional.push(a);
  }
  return { positional, flags };
}

function langOf(o: Opts): Lang {
  const l = o.flags.get('--lang') ?? 'en';
  if (l !== 'en' && l !== 'zh-HK') throw new UsageError('--lang must be en or zh-HK');
  return l;
}

function readText(path: string): string {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    throw new UsageError(`cannot read ${path}`);
  }
  if (size > LIMITS.fileBytes)
    throw new UsageError(`${path} is larger than ${LIMITS.fileBytes} bytes`);
  return readFileSync(path, 'utf8');
}

export interface RunResult {
  code: number;
  out: string;
  err: string;
}

function load(path: string | undefined, lang: Lang): Project | RunResult {
  if (!path) throw new UsageError('missing <project.json>');
  const r = readProjectJson(readText(path));
  if (!r.ok)
    return { code: 1, out: '', err: r.errors.map((e) => describeError(e, lang)).join('\n') + '\n' };
  return r.value.project;
}

/** 0 when every number is verified, 2 when some items have explained problems, 4 on mismatch. */
export function statusCode(project: Project): number {
  const v = verifiedProject(project);
  const all = [...v.recipes.values(), ...v.menu.values()];
  if (all.some((x) => x.status === 'mismatch')) return 4;
  if (all.some((x) => x.status === 'error')) return 2;
  return 0;
}

export function run(argv: string[]): RunResult {
  try {
    const o = parseArgs(argv);
    if (o.flags.has('--version')) return { code: 0, out: `${ENGINE_VERSION}\n`, err: '' };
    const [cmd, file, ...rest] = o.positional;
    if (o.flags.has('--help') || !cmd)
      return { code: cmd || o.flags.has('--help') ? 0 : 1, out: HELP, err: '' };
    const lang = langOf(o);
    if (cmd === 'cost') {
      if (rest.length) throw new UsageError('cost takes one project file');
      const p = load(file, lang);
      if ('code' in p) return p;
      const csv = o.flags.get('--csv');
      if (csv !== undefined && csv !== 'menu' && csv !== 'recipes')
        throw new UsageError('--csv must be menu or recipes');
      const text =
        csv === 'menu'
          ? menuCsv(p, lang)
          : csv === 'recipes'
            ? recipesCsv(p, lang)
            : textReport(p, lang);
      const out = o.flags.get('--out');
      if (typeof out === 'string') {
        writeFileSync(out, text, 'utf8');
        return { code: statusCode(p), out: '', err: '' };
      }
      return { code: statusCode(p), out: text, err: '' };
    }
    if (cmd === 'check') {
      if (rest.length) throw new UsageError('check takes one project file');
      const p = load(file, lang);
      if ('code' in p) return p;
      const v = verifiedProject(p);
      const lines: string[] = [];
      for (const [id, r] of v.recipes)
        if (r.status === 'error') lines.push(describeError(r.error, lang, p));
        else if (r.status === 'mismatch')
          lines.push(`internal check failed: recipe ${id} (${r.detail})`);
      for (const [id, m] of v.menu)
        if (m.status === 'error') lines.push(describeError(m.error, lang, p));
        else if (m.status === 'mismatch')
          lines.push(`internal check failed: menu ${id} (${m.detail})`);
      const n = v.recipes.size + v.menu.size;
      const okCount = [...v.recipes.values(), ...v.menu.values()].filter(
        (x) => x.status === 'ok',
      ).length;
      const summary =
        lang === 'en'
          ? `${okCount} of ${n} recipes and menu items verified (engine and independent checker agree exactly).`
          : `${n} 個食譜及餐牌項目中，${okCount} 個已核實（計算引擎與獨立檢查器結果完全相同）。`;
      return { code: statusCode(p), out: [...lines, summary, ''].join('\n'), err: '' };
    }
    if (cmd === 'impact') {
      const [who, priceText, ...extra] = rest;
      if (!who || !priceText || extra.length)
        throw new UsageError('impact needs <project.json> <ingredient> <new price>');
      const p = load(file, lang);
      if ('code' in p) return p;
      const matches = [...p.ingredients.values()].filter((i) => i.id === who || i.name === who);
      if (matches.length !== 1)
        throw new UsageError(
          matches.length
            ? `"${who}" matches more than one ingredient; use its id`
            : `no ingredient "${who}"`,
        );
      const price = parseDecimal(priceText);
      if (!price.ok || price.value.n < 0n) throw new UsageError(`bad price "${priceText}"`);
      return { code: 0, out: impactReport(p, matches[0]!.id, price.value, lang), err: '' };
    }
    throw new UsageError(`unknown command "${cmd}"`);
  } catch (e) {
    if (e instanceof UsageError)
      return { code: 1, out: '', err: `saucepenny: ${e.message}\n${HELP}` };
    throw e;
  }
}

const isMain = process.argv[1] !== undefined && /main\.[cm]?[jt]s$/.test(process.argv[1]);
if (isMain) {
  const r = run(process.argv.slice(2));
  if (r.out) process.stdout.write(r.out);
  if (r.err) process.stderr.write(r.err);
  process.exitCode = r.code;
}
