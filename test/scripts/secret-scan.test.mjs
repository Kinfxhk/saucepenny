// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/secret-scan.mjs', import.meta.url));
const run = (env) =>
  spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, CI: '', ...env, SECRET_SCAN_FORCE_FALLBACK: '1' },
  });

describe('secret scan fallback', () => {
  it('says loudly that it is the FALLBACK, never pretending to be gitleaks', () => {
    const r = run({});
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/FALLBACK/);
    expect(r.stderr).toMatch(/not gitleaks/);
    expect(r.stdout + r.stderr).not.toMatch(/Secret scan passed \(gitleaks\)/);
  });

  it.runIf(process.platform === 'linux')('fails on Linux CI when gitleaks is missing', () => {
    const r = run({ CI: 'true' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/gitleaks is required on Linux CI/);
  });
});
