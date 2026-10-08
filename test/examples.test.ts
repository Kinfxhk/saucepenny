// SPDX-License-Identifier: AGPL-3.0-or-later
// Every example project is valid, every number in it is verified by the independent
// checker, and the CLI prints exactly the core report for it.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../packages/cli/src/main';
import {
  readProjectJson,
  stringifyProject,
  textReport,
  verifiedIngredientCosts,
  verifiedProject,
} from '../packages/core/src/index';

const dir = fileURLToPath(new URL('../examples/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('examples', () => {
  it('there are three: cha chaan teng, home bakery, social-enterprise lunch', () => {
    expect(files.sort()).toEqual([
      'cha-chaan-teng.json',
      'home-bakery.json',
      'social-enterprise-lunch.json',
    ]);
  });
  for (const f of files)
    it(`${f}: valid, fully verified, CLI = core, saved form round-trips`, () => {
      const text = readFileSync(join(dir, f), 'utf8');
      const r = readProjectJson(text);
      if (!r.ok) throw new Error(JSON.stringify(r.errors));
      const p = r.value.project;
      const v = verifiedProject(p);
      for (const [id, x] of [...v.recipes, ...v.menu]) expect(x.status, `${f} ${id}`).toBe('ok');
      for (const [id, x] of verifiedIngredientCosts(p)) expect(x.status, `${f} ${id}`).toBe('ok');
      const cli = run(['cost', join(dir, f)]);
      expect(cli.code).toBe(0);
      expect(cli.out).toBe(textReport(p));
      expect(cli.out).not.toMatch(/^\s*!/m);
      const again = readProjectJson(stringifyProject(r.value.stored));
      expect(again.ok && textReport(again.value.project)).toBe(textReport(p));
      expect(text).toMatch(/Demo|示範/); // examples are clearly invented
    });
});
