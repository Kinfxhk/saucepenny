#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Prints release notes for one version, taken from CHANGELOG.md, plus the site checksum,
// the disclaimer and the support link.
// Usage: node scripts/release-notes.mjs [version]   (default: root package.json version)
import { existsSync, readFileSync } from 'node:fs';

const version = process.argv[2] ?? JSON.parse(readFileSync('package.json', 'utf8')).version;
const changelog = readFileSync('CHANGELOG.md', 'utf8').replace(/\r\n/g, '\n');
const start = changelog.indexOf(`## [${version}]`);
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
const rest = changelog.slice(start);
const next = rest.slice(1).search(/^## \[|^\[[^\]]+\]: /m);
const body = (next < 0 ? rest : rest.slice(0, next + 1)).split('\n').slice(1).join('\n').trim();

const lines = [body, ''];
const sumFile = `release/saucepenny-site-v${version}.zip.sha256`;
if (existsSync(sumFile)) {
  lines.push(
    '### Static site download',
    '',
    'SHA-256:',
    '',
    '```',
    readFileSync(sumFile, 'utf8').trim(),
    '```',
    '',
  );
}
lines.push(
  '### Please note · 請注意',
  '',
  '- **Estimates only, not accounting or tax advice.** Results depend entirely on the prices, yields and quantities you enter. Check important prices yourself.',
  '- **只供估算，並非會計或稅務意見。** 結果完全取決於你輸入的價錢、可用率及用量；重要價錢請自行核對。',
  '- Saucepenny is an independent open-source project and is not affiliated with any other recipe-costing product or company. 菜本易是獨立開源項目，與任何其他食譜成本產品或公司並無關連。',
  '',
  'If Saucepenny helps you, you can support it at https://buymeacoffee.com/kinfxhk · 如果菜本易對你有幫助，歡迎到 Buy Me a Coffee 支持。',
);
process.stdout.write(lines.join('\n') + '\n');
