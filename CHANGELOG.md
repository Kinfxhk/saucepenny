# Changelog

All notable changes to Saucepenny are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

- Repository skeleton, licence and notices, cross-platform checks, Linux + Windows CI.
- Exact BigInt rational numbers, strict decimal parser (full-width digits, thousands
  commas), display rounding and suggested-price rounding (to 0.1, 0.5, 1 or ending in 8).
- Unit table with constants cited from Hong Kong Cap. 68 (斤, 兩, lb, oz) and NIST
  Handbook 44 (US cup, tablespoon, teaspoon, fluid ounce); exact conversions including
  density and weight per piece.
- Project data model (ingredients with yield %, density and weight per piece; recipes with
  nested sub-recipes; menu items; custom measures), strict validation with paths, limits,
  migration defaults, and hostile-JSON defences (size, depth, prototype keys).
- Costing engine (recursive, memoised) and an independent checker that expands every
  recipe into raw ingredient packs; numbers are shown only when both agree exactly.
  Tarjan cycle detection with the full cycle path, nesting limit of 20 levels.
- Menu pricing: cost per portion, net price without service charge, food cost %, gross
  profit, colour bands, suggested price rounded up and the real food cost % at it; price
  change impact through sub-recipes; batch scaling and "how much can I make".
- CSV per RFC 4180 with formula-injection protection; ingredient CSV import (English or
  Chinese headers, 斤/兩, full-width digits, thousands commas) with row-level errors;
  recipe and menu CSV exports; bilingual error messages.
- Command line: `saucepenny cost | check | impact`, printing the same verified text as the
  core report.
- Written calculation rules (docs/calculation-rules.md).
