// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Mutation-testing helper: copy one folder of packages/core/src next to itself with a single
// deliberate change, import it, and let the caller run its golden table against it. Relative
// imports to sibling folders (../num, ../units, …) keep working because the copy sits beside
// the original. Copies are removed after the test file finishes.

import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const srcDir = fileURLToPath(new URL('../../src', import.meta.url));
const created: string[] = [];
let counter = 0;

export interface Mutant {
  name: string;
  file: string; // e.g. 'units/table.ts'
  from: string;
  to: string;
}

/** Number of times `from` occurs in the original file (must be exactly 1). */
export function occurrences(m: Mutant): number {
  return readFileSync(join(srcDir, m.file), 'utf8').split(m.from).length - 1;
}

export async function loadMutant<T>(m: Mutant): Promise<T> {
  const [folder, ...rest] = m.file.split('/');
  const dir = join(srcDir, `${folder}-mutant-${process.pid}-${counter++}`);
  created.push(dir);
  cpSync(join(srcDir, folder!), dir, { recursive: true });
  const target = join(dir, ...rest);
  const text = readFileSync(target, 'utf8');
  if (text.split(m.from).length - 1 !== 1)
    throw new Error(`mutant "${m.name}" does not apply once`);
  writeFileSync(target, text.replace(m.from, m.to));
  return (await import(pathToFileURL(join(dir, 'index.ts')).href)) as T;
}

export function cleanupMutants(): void {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
}
