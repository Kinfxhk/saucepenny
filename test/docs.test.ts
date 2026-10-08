// SPDX-License-Identifier: AGPL-3.0-or-later
// Doc tests:
// - every command in a ```sh block of the README and docs/ is checked; `npm run
//   saucepenny -- …` commands are really executed (outputs go to a temporary folder);
//   other npm commands must name scripts that exist (CI runs those scripts itself);
// - every ```text block preceded by `<!-- doc-test: <cli args> -->` must appear, line by
//   line, in the real CLI output, so the worked examples in the guide cannot go stale.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { run } from '../packages/cli/src/main';

const root = fileURLToPath(new URL('../', import.meta.url));
const docs = [
  'README.md',
  ...readdirSync(join(root, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f}`),
];
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const work = mkdtempSync(join(tmpdir(), 'saucepenny-docs-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const read = (file: string) => readFileSync(join(root, file), 'utf8').replace(/\r\n/g, '\n');

function commands(file: string): string[] {
  const out: string[] = [];
  for (const m of read(file).matchAll(/```sh\n([\s\S]*?)```/g))
    for (const line of m[1]!.split('\n')) {
      const cmd = line.replace(/\s+#.*$/, '').trim();
      if (cmd) out.push(cmd);
    }
  return out;
}

/** Map a documented path to a real one: examples/ from the repo, outputs in a temp folder. */
function mapPath(arg: string): string {
  if (isAbsolute(arg)) return arg;
  if (arg.startsWith('examples/')) return join(root, arg);
  if (/\.(json|csv)$/.test(arg)) return join(work, arg);
  return arg;
}

const all = docs.flatMap((f) => commands(f).map((cmd) => ({ file: f, cmd })));
const excerpts = docs.flatMap((file) =>
  [...read(file).matchAll(/<!-- doc-test: (.+?) -->\s*```text\n([\s\S]*?)```/g)].map((m) => ({
    file,
    args: m[1]!.trim().split(/\s+/),
    lines: m[2]!.split('\n').filter((l) => l.trim() !== ''),
  })),
);

describe('documented commands', () => {
  it('there are some', () => {
    expect(all.filter((c) => c.cmd.startsWith('npm run saucepenny')).length).toBeGreaterThanOrEqual(
      5,
    );
  });

  for (const { file, cmd } of all) {
    it(`${file}: ${cmd}`, () => {
      const words = cmd.split(/\s+/);
      if (cmd.startsWith('npm run saucepenny -- ')) {
        const r = run(words.slice(4).map(mapPath));
        expect(r.code, r.err).toBe(0);
      } else if (words[0] === 'npm') {
        const [, sub, name] = words;
        if (sub === 'run') expect(pkg.scripts, cmd).toHaveProperty(name!);
        else if (sub === 'start' || sub === 'test') expect(pkg.scripts).toHaveProperty(sub);
        else expect(['ci', 'install'], cmd).toContain(sub);
      } else if (words[0] === 'docker') {
        expect(readFileSync(join(root, 'Dockerfile'), 'utf8')).toMatch(/^FROM /m);
      } else if (words[0] === 'npx') {
        expect(['playwright', 'vitest', 'prettier', 'eslint', 'tsc'], cmd).toContain(words[1]);
      } else throw new Error(`unknown documented command: ${cmd}`);
    });
  }
});

describe('worked examples in the docs match the real output', () => {
  it('there are some in both languages', () => {
    expect(excerpts.filter((e) => e.file === 'docs/guide.md').length).toBeGreaterThanOrEqual(3);
    expect(
      excerpts.filter((e) => e.file === 'docs/guide.zh-Hant.md').length,
    ).toBeGreaterThanOrEqual(3);
  });
  for (const e of excerpts)
    it(`${e.file}: saucepenny ${e.args.join(' ')}`, () => {
      const r = run(e.args.map(mapPath));
      expect(r.code, r.err).toBe(0);
      const out = r.out.split('\n');
      for (const line of e.lines) expect(out, line).toContain(line);
    });
});
