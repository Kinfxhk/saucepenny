// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  dec,
  impactReport,
  menuCsv,
  stringifyProject,
  textReport,
  validateProject,
} from '@saucepenny/core';
import { sampleStored } from '../../core/test/helpers/fixtures';
import { parseArgs, run } from '../src/main';

const root = resolve(import.meta.dirname, '..', '..', '..');
const dir = mkdtempSync(join(tmpdir(), 'saucepenny-cli-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const stored = sampleStored();
const file = join(dir, 'sample.json');
writeFileSync(file, stringifyProject(stored));
const project = (() => {
  const r = validateProject(stored);
  if (!r.ok) throw new Error('sample');
  return r.value.project;
})();

describe('argument parsing', () => {
  it('accepts --flag value and --flag=value; rejects unknown flags', () => {
    expect(parseArgs(['cost', 'a.json', '--lang', 'zh-HK']).flags.get('--lang')).toBe('zh-HK');
    expect(parseArgs(['cost', '--csv=menu']).flags.get('--csv')).toBe('menu');
    expect(run(['cost', file, '--bogus']).code).toBe(1);
    expect(run(['cost', file, '--lang']).code).toBe(1);
    expect(run(['cost', file, '--lang', 'fr']).code).toBe(1);
  });
  it('--version, --help, no command, unknown command', () => {
    expect(run(['--version'])).toEqual({ code: 0, out: '0.1.0\n', err: '' });
    expect(run(['--help']).out).toMatch(/not accounting or tax advice/);
    expect(run([]).code).toBe(1);
    expect(run(['bake', file]).code).toBe(1);
  });
});

describe('cost', () => {
  it('prints exactly the core text report (byte for byte), exit 0', () => {
    const r = run(['cost', file]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(textReport(project));
    expect(run(['cost', file, '--lang', 'zh-HK']).out).toBe(textReport(project, 'zh-HK'));
  });
  it('--csv menu --out writes the same bytes as the core CSV', () => {
    const out = join(dir, 'menu.csv');
    expect(run(['cost', file, '--csv', 'menu', '--out', out]).code).toBe(0);
    expect(readFileSync(out, 'utf8')).toBe(menuCsv(project));
  });
  it('a recipe cycle gives exit 2 with the circle explained, never a number', () => {
    const s = sampleStored();
    s.recipes[0]!.lines.push({ ref: { kind: 'recipe', id: 'charsiu' }, qty: '1', unit: 'portion' });
    const f = join(dir, 'cycle.json');
    writeFileSync(f, stringifyProject(s));
    const r = run(['cost', f]);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/circle: (糖水 → 叉燒|叉燒 → 糖水)/);
  });
  it('bad files: missing, not JSON, hostile key, wrong field', () => {
    expect(run(['cost', join(dir, 'nope.json')]).code).toBe(1);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{"schema":');
    expect(run(['cost', bad])).toMatchObject({ code: 1, err: 'This is not a valid JSON file.\n' });
    writeFileSync(bad, '{"__proto__":{"x":1}}');
    expect(run(['cost', bad]).err).toMatch(/forbidden key/);
    const s = sampleStored();
    s.ingredients[0]!.yieldPercent = '0';
    writeFileSync(bad, stringifyProject(s));
    const r = run(['check', bad, '--lang', 'zh-HK']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('可用率須大於 0%');
  });
});

describe('check and impact', () => {
  it('check: all verified, exit 0', () => {
    const r = run(['check', file]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('5 of 5 recipes and menu items verified');
  });
  it('impact by name or id equals the core report', () => {
    const r = run(['impact', file, '砂糖', '15']);
    expect(r.code).toBe(0);
    expect(r.out).toBe(impactReport(project, 'sugar', dec('15')));
    expect(run(['impact', file, 'sugar', '１５']).out).toBe(r.out);
    expect(run(['impact', file, 'nobody', '1']).code).toBe(1);
    expect(run(['impact', file, 'sugar', '-1']).code).toBe(1);
    expect(run(['impact', file, 'sugar']).code).toBe(1);
  });
});

describe('real process', () => {
  const cli = join(root, 'packages', 'cli', 'src', 'main.ts');
  it('runs with node --import tsx the same way on every OS, output identical to core', () => {
    const out = execFileSync(process.execPath, ['--import', 'tsx', cli, 'cost', file], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(out).toBe(textReport(project));
  });
  it('exit codes reach the shell', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', cli, 'cost'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/missing <project.json>/);
  });
});
