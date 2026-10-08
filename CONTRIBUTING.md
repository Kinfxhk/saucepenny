# Contributing to Saucepenny

Thank you for helping. Saucepenny exists so that small food businesses, social
enterprises, NGO kitchens and cookery classes can cost recipes and price menus for free,
offline and without an account. Correctness and legal cleanliness matter as much as
features.

## Clean-room rule (mandatory)

1. **Do not copy code, UI, text, calculation-sheet layouts, icons, colours or assets**
   from any commercial or open-source recipe-costing, inventory or kitchen-management
   product, including permissively licensed ones, so the provenance of every line stays
   clear. The costing rules are general bookkeeping arithmetic, written down in our own
   words in [docs/calculation-rules.md](docs/calculation-rules.md).
2. Work only from general knowledge and the written descriptions in this repository. Do
   not use screenshots or recordings of other products as templates.
3. **No trademarks as branding.** Other products may never be named in the UI, engine
   strings, examples or docs (`npm run check:hygiene` enforces this).
4. **Example data is invented.** Never use a real supplier's price list.
5. **Unit constants** must cite a primary source (law or standards body) in
   [docs/units.md](docs/units.md). Unverifiable constants are not merged.
6. **Third-party code** must be an npm dependency under an AGPL-3.0-compatible licence.
   Do not paste snippets of unknown origin, including from Q&A sites or AI tools.

## Correctness rule

- All money and quantities are exact rationals (`packages/core/src/num`). ESLint bans
  `parseFloat`, `toFixed`, `Math.round` and float literals in `num/`, `units/`, `cost/`
  and `check/`.
- Every number the UI or CLI shows is recomputed by the independent checker in
  `packages/core/src/check/`, which must never import the costing engine (ESLint and the
  hygiene script enforce this). If they disagree, the number is not shown.
- A change to a rule needs golden tests, property tests and a mutation test showing that
  a deliberately broken version is caught. Never weaken the checker to make the engine
  pass.
- Errors are reported, never silently treated as zero.

## Cross-platform rule

CI runs on Linux and Windows (Node 22 and 24). Start child processes with
`process.execPath` (see `scripts/lib/proc.mjs`), build paths with `node:path`, and never
assert against a hard-coded path string. Text files are checked out with LF everywhere
(`.gitattributes`).

## AI-assisted development

**How this project is made:** Saucepenny is written with AI coding agents working under
the maintainer's direction. Most of the code, tests and documentation in this repository
were drafted that way and then checked by the same gates that apply to every
contribution: the clean-room rules above, the independent checker, golden, property and
mutation tests, the licence allowlist, the hygiene check and the secret scan. We say this
openly because a policy that pretended otherwise would be useless.

You may use AI tools for your contribution too, on these conditions:

1. **Review it yourself.** Read every line you submit and be able to explain why it is
   correct. You are responsible for it exactly as if you had typed it. Check golden-test
   expectations by hand; do not let a tool write both a rule and its expected answers.
2. **No reproduction of other work.** Do not ask an AI tool to reproduce, translate or
   paraphrase code, text, UI or price lists from other products, and do not paste such
   material into prompts. If a tool says its output matches existing code (or shows a
   licence or attribution), do not use that output.
3. **DCO covers all of it.** Your sign-off certifies that you have the right to submit the
   whole contribution, including AI-assisted parts.
4. **Disclose it.** Say in the pull request which AI tools you used and for what. The
   pull request template asks for this. Disclosure is not a mark against a contribution;
   it helps reviewers know where to look harder.

## Developer Certificate of Origin

All commits must be signed off (`git commit -s`), certifying the
[Developer Certificate of Origin 1.1](https://developercertificate.org/): you wrote the
change or otherwise have the right to submit it under AGPL-3.0-or-later.

## Development

```bash
npm ci
npm run check      # lint, format, typecheck, tests, licences, hygiene, secrets
npm run test:e2e   # headless browser tests
```

`packages/core` must stay **pure**: no I/O, no clock, no `Math.random()`.

## Licence

By contributing you agree that your contribution is licensed under AGPL-3.0-or-later.
