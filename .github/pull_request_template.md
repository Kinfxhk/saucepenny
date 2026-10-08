<!-- Thank you! Please fill in every section; delete hints in brackets. -->

## What and why

[What does this change and which issue does it address?]

## Checklist

- [ ] `npm run check` passes (lint, format, typecheck, tests, licences, hygiene, secret scan).
- [ ] UI changes: `npm run test:e2e` passes.
- [ ] **Checker:** every new or changed number is recomputed by the independent checker in
      `packages/core/src/check/`, and the checker was **not** weakened.
- [ ] **Golden tests:** expected values added or updated, and I checked them by hand.
- [ ] **Property tests:** random projects (fast-check) give engine = checker exactly.
- [ ] **Mutation test:** a deliberately broken version of each new rule is caught.
- [ ] New UI strings exist in both `en` and `zh-HK`.
- [ ] **Clean room:** no code, text, UI, screenshots or price lists copied from other
      products (CONTRIBUTING.md).
- [ ] Commits are signed off (`git commit -s`, DCO).

## AI assistance

- [ ] I did not use AI tools for this change.
- [ ] I used AI tools: [which tools, and for what]. I reviewed every line and can explain it,
      and I did not ask the tool to reproduce other projects' code or text.
