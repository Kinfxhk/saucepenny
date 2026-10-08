# Third-party notices

Saucepenny is licensed under AGPL-3.0-or-later. The core (`packages/core`) and the
browser UI (`packages/web`) have **no third-party runtime dependencies**: the exact
rational arithmetic, unit tables, data model, costing engine, independent checker, CSV
and JSON code and the UI are original code written for this project.

The full dependency list with licences is produced by `npm run check:licenses`, which
also enforces an AGPL-3.0-compatible allowlist in CI (it fails closed on unknown,
missing or malformed licence expressions).

## Development-only tools (not shipped)

Vite, Vitest, fast-check, Playwright, axe-core (`@axe-core/playwright`, MPL-2.0),
ESLint, Prettier, TypeScript and tsx are used only to build and test Saucepenny.
MPL-2.0 is accepted for development tooling only.

## Code of Conduct

`CODE_OF_CONDUCT.md` is the Contributor Covenant 3.0 (CC BY-SA 4.0), with attribution
kept at the end of the file.

## Secret scanning

CI runs [gitleaks](https://github.com/gitleaks/gitleaks) (MIT), downloaded at a pinned
version with retries and checked against its published SHA-256 checksums. It is not part
of the repository or of any release artefact.
