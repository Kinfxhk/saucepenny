#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Repository hygiene gate for Saucepenny:
//  - required notice files and README statements exist (disclaimer, not-affiliated,
//    commitments, AI-assisted development, Buy Me a Coffee);
//  - the web UI never loads anything from another origin (no CDN, fonts, analytics);
//  - other recipe-costing products' names never appear in UI, engine, example or doc strings;
//  - the independent checker never imports the costing engine (also enforced by ESLint);
//  - tests never assert against hard-coded OS-specific paths;
//  - the AGPL section 13 source link and the CSP stay in the page.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { findHardcodedPathAssertions } from './lib/path-assert.mjs';

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .map((f) => f.trim())
  .filter((f) => f && existsSync(f));

const problems = [];
const read = (f) => readFileSync(f, 'utf8');
const REPO = 'https://github.com/Kinfxhk/saucepenny';

for (const required of [
  'LICENSE',
  'NOTICE',
  'THIRD_PARTY_NOTICES.md',
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'CHANGELOG.md',
  '.gitattributes',
  '.github/pull_request_template.md',
  'docs/units.md',
]) {
  if (!existsSync(required)) problems.push(`missing required file: ${required}`);
}
if (existsSync('LICENSE') && !read('LICENSE').includes('GNU AFFERO GENERAL PUBLIC LICENSE'))
  problems.push('LICENSE is not the AGPL text');
if (existsSync('.gitattributes') && !/^\* text=auto eol=lf$/m.test(read('.gitattributes')))
  problems.push('.gitattributes must contain "* text=auto eol=lf"');

if (existsSync('README.md')) {
  const readme = read('README.md');
  const needles = {
    'https://buymeacoffee.com/kinfxhk': 'Buy Me a Coffee link',
    [REPO]: 'repository link',
    'not accounting or tax advice': 'English disclaimer',
    並非會計或稅務意見: 'Chinese disclaimer',
    'not affiliated': 'English not-affiliated statement',
    並無關連: 'Chinese not-affiliated statement',
    '## Commitments': 'commitments section',
    'AI-assisted development': 'AI-assisted development policy link',
    'CODE_OF_CONDUCT.md': 'Code of Conduct link',
  };
  for (const [needle, what] of Object.entries(needles))
    if (!readme.includes(needle)) problems.push(`README.md lacks the ${what} ("${needle}")`);
}

// --- No other products' names in UI / engine / example / doc strings. ----------------------
const COMPETITORS =
  /\bmeez\b|dish\s*cost|\bgrocy\b|\bladle\b|market\s*man\b|apicbase|reciprofity|craftable|restaurant\s*365|xtra\s*chef|galley\s+solutions|costbrain|recipe\s*cost\s*calculator\.net/i;
const BRAND_FILES = files.filter(
  (f) =>
    /^packages\/(web|core|cli)\/(src|public)\//.test(f) ||
    f === 'packages/web/index.html' ||
    /^examples\//.test(f) ||
    /^docs\/.*\.md$/.test(f),
);
for (const f of BRAND_FILES) {
  if (/\/licenses\//.test(f)) continue;
  if (!/\.(ts|html|css|json|webmanifest|svg|md|csv)$/.test(f)) continue;
  const m = read(f).match(COMPETITORS);
  if (m)
    problems.push(`${f}: other product name "${m[0]}" must not appear in UI/engine/examples/docs`);
}

// --- The checker must not import the costing engine. -------------------------------------
for (const f of files.filter((x) => /^packages\/core\/src\/check\/.*\.ts$/.test(x))) {
  for (const m of read(f).matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    if (/(^|\/)(cost|api)(\/|\.ts$|$)/.test(m[1]) || /^\.\.(\/index(\.ts)?)?\/?$/.test(m[1]))
      problems.push(`${f}: the independent checker must not import "${m[1]}"`);
  }
}

// --- Tests must not assert hard-coded OS paths. ------------------------------------------
for (const f of files.filter(
  (x) => /\.(test|spec)\.(ts|mjs|js)$/.test(x) && !x.startsWith('test/scripts/fixtures/'),
)) {
  for (const hit of findHardcodedPathAssertions(read(f)))
    problems.push(`${f}:${hit.line}: hard-coded path assertion "${hit.literal}" (use node:path)`);
}

// --- The web UI must not load third-party resources. ---------------------------------------
const ALLOWED_LINKS = [REPO, 'https://buymeacoffee.com/kinfxhk', 'https://www.gnu.org/licenses/'];
const WEB_FILES = files.filter(
  (f) => /^packages\/web\/(src|public)\//.test(f) || f === 'packages/web/index.html',
);
for (const f of WEB_FILES) {
  if (/\/licenses\//.test(f) || !/\.(ts|html|css|json|webmanifest|js|svg)$/.test(f)) continue;
  const text = read(f);
  for (const m of text.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) {
    const url = m[0];
    if (url.startsWith('http://www.w3.org/')) continue; // XML namespaces, not loads
    if (!ALLOWED_LINKS.some((a) => url.startsWith(a)))
      problems.push(`${f}: external URL not allowed in the web UI: ${url}`);
  }
  if (/(src|srcset)\s*=\s*["']https?:/i.test(text) || /url\(\s*["']?https?:/i.test(text))
    problems.push(`${f}: loads a resource from another origin`);
}

const PAGE = 'packages/web/index.html';
if (existsSync(PAGE)) {
  const html = read(PAGE);
  if (!/http-equiv="Content-Security-Policy"[^>]*default-src 'self'/s.test(html))
    problems.push(`${PAGE}: missing CSP meta with default-src 'self'`);
  if (!html.includes('id="source-link"'))
    problems.push(`${PAGE}: missing footer source link (AGPL section 13)`);
}

if (problems.length) {
  console.error('Repository hygiene check FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.info(`Repository hygiene check passed (${files.length} files).`);
