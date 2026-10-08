// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Defensive JSON reading for untrusted project files: size limit before anything else, a
// nesting-depth pre-scan (so hostile files cannot exhaust the stack), JSON.parse, then a
// walk that rejects prototype-polluting keys anywhere in the tree.

import type { ProjectError, Result } from './errors';
import { LIMITS } from './limits';

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** UTF-8 byte length without allocating a buffer. */
export function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** Maximum nesting of arrays/objects in JSON text, ignoring brackets inside strings. */
export function jsonDepth(text: string, stopAbove = Infinity): number {
  let depth = 0;
  let maxDepth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') {
      depth++;
      if (depth > maxDepth) maxDepth = depth;
      if (maxDepth > stopAbove) return maxDepth;
    } else if (c === '}' || c === ']') depth--;
  }
  return maxDepth;
}

function findForbiddenKey(root: unknown): string | undefined {
  const stack: [unknown, string][] = [[root, '']];
  while (stack.length) {
    const [v, path] = stack.pop()!;
    if (v === null || typeof v !== 'object') continue;
    if (Array.isArray(v)) {
      v.forEach((x, i) => stack.push([x, `${path}[${i}]`]));
      continue;
    }
    for (const key of Object.keys(v)) {
      const p = path ? `${path}.${key}` : key;
      if (FORBIDDEN_KEYS.has(key)) return p;
      stack.push([(v as Record<string, unknown>)[key], p]);
    }
  }
  return undefined;
}

export function parseJsonSafely(text: string): Result<unknown> {
  const fail = (e: ProjectError): Result<unknown> => ({ ok: false, errors: [e] });
  if (typeof text !== 'string') return fail({ code: 'invalid-json', path: '' });
  if (text.length > LIMITS.fileBytes || utf8Length(text) > LIMITS.fileBytes)
    return fail({ code: 'file-too-large', path: '', params: { max: LIMITS.fileBytes } });
  const depth = jsonDepth(text, LIMITS.jsonDepth);
  if (depth > LIMITS.jsonDepth)
    return fail({ code: 'too-deep', path: '', params: { max: LIMITS.jsonDepth } });
  let value: unknown;
  try {
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return fail({ code: 'invalid-json', path: '' });
  }
  const bad = findForbiddenKey(value);
  if (bad !== undefined) return fail({ code: 'forbidden-key', path: bad });
  return { ok: true, value };
}

/** Stable, pretty JSON for export (keys in model order, LF line endings, final newline). */
export function stringifyProject(stored: unknown): string {
  return JSON.stringify(stored, null, 2) + '\n';
}
