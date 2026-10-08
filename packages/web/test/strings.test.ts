// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { catalogues, ui } from '../src/strings';

describe('interface text', () => {
  it('English and Chinese have the same keys and no empty strings', () => {
    expect(Object.keys(catalogues['zh-HK']).sort()).toEqual(Object.keys(catalogues.en).sort());
    for (const lang of ['en', 'zh-HK'] as const)
      for (const [k, v] of Object.entries(catalogues[lang]))
        expect(v.trim(), `${lang} ${k}`).not.toBe('');
  });
  it('placeholders match between languages', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(catalogues.en) as (keyof typeof catalogues.en)[])
      expect(ph(catalogues['zh-HK'][k]), k).toEqual(ph(catalogues.en[k]));
  });
  it('fills parameters', () => {
    expect(ui('en', 'ing.count', { n: 3 })).toBe('3 ingredients');
    expect(ui('zh-HK', 'ing.count', { n: 3 })).toBe('3 項食材');
  });
  it('the disclaimer and the no-affiliation line are in both languages', () => {
    expect(catalogues.en['footer.disclaimer']).toBe(
      'Estimates only, not accounting or tax advice.',
    );
    expect(catalogues['zh-HK']['footer.disclaimer']).toBe('只供估算，並非會計或稅務意見。');
    expect(catalogues['zh-HK']['footer.affiliation']).toContain('並無關連');
  });
});
