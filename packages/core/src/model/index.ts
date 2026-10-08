// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Result } from './errors';
import { parseJsonSafely } from './json';
import { validateProject, type Validated } from './validate';

export * from './types';
export * from './errors';
export * from './limits';
export * from './json';
export * from './defaults';
export * from './migrate';
export * from './validate';

/** Read an untrusted project file: size/depth/key defences, then strict validation. */
export function readProjectJson(text: string): Result<Validated> {
  const parsed = parseJsonSafely(text);
  if (!parsed.ok) return parsed;
  return validateProject(parsed.value);
}
