// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Version handling. v0.1 writes version 1, v0.2 writes version 2. Files without optional sections (settings,
// measures, menu) are completed with defaults; files from a newer Saucepenny are refused
// with a clear message instead of being half-read.

import { DEFAULT_SETTINGS } from './defaults';
import type { ProjectError } from './errors';
import { PROJECT_SCHEMA, PROJECT_VERSION } from './types';

export type MigrateResult =
  | { ok: true; value: Record<string, unknown>; migrated: boolean }
  | { ok: false; errors: ProjectError[] };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function migrate(input: unknown): MigrateResult {
  if (!isPlainObject(input) || input.schema !== PROJECT_SCHEMA)
    return { ok: false, errors: [{ code: 'not-a-project', path: '' }] };
  const v = input.version;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1)
    return { ok: false, errors: [{ code: 'unsupported-version', path: 'version' }] };
  if (v > PROJECT_VERSION)
    return {
      ok: false,
      errors: [{ code: 'newer-version', path: 'version', params: { version: v } }],
    };
  // 1 → 2 (v0.2): every new field is optional, so a version 1 file is a valid version 2
  // file as it stands; it is marked migrated so it is saved back as version 2.
  let migrated = v < PROJECT_VERSION;
  const out: Record<string, unknown> = { ...input, version: PROJECT_VERSION };
  if (out.settings === undefined) {
    out.settings = { ...DEFAULT_SETTINGS };
    migrated = true;
  } else if (isPlainObject(out.settings)) {
    const s: Record<string, unknown> = { ...out.settings };
    for (const [k, def] of Object.entries(DEFAULT_SETTINGS))
      if (s[k] === undefined) {
        s[k] = def;
        migrated = true;
      }
    out.settings = s;
  }
  for (const key of ['measures', 'ingredients', 'recipes', 'menu'])
    if (out[key] === undefined) {
      out[key] = [];
      migrated = true;
    }
  return { ok: true, value: out, migrated };
}
