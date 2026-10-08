// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../src/index';

const pkg = (rel: string) =>
  JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as { version: string };

describe('versions', () => {
  it('engine version matches every package.json', () => {
    for (const rel of [
      '../../../package.json',
      '../package.json',
      '../../cli/package.json',
      '../../web/package.json',
    ])
      expect(pkg(rel).version).toBe(ENGINE_VERSION);
  });
});
