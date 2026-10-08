# Changelog

All notable changes to Saucepenny are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.1] - 2026-10-08

### Fixed

- The recipe table (with the new Cost % column) no longer runs past the edge of the page
  on a 1280-pixel-wide window; a browser test now checks there is no sideways scrolling.
- Before your first change, the Data tab said "Checking storage…" forever. It now says
  that Saucepenny will ask the browser to keep your project after your first change (or
  that storage is already kept), without asking for the bundled example.

## [0.2.0] - 2026-10-08

Improvements from what users of other recipe-costing tools ask for most. 根據其他食譜
成本工具用戶最常提出的需要而改進。Calculation rules version 2.

### Added

- **Fractions** in quantity fields (amounts, pack quantity, yield, portion size, scale to,
  what I have): `1/2`, `1 1/2`, `½`, `1½`, full-width `１／２`. Kept as typed, exact.
  Zero denominators and improper mixed numbers are refused with a message.
- **Duplicate recipe** (name gets " (copy)" / "（副本）").
- **Custom measures UI** in the Data tab: add, rename, change amount and unit, remove
  (refused while a recipe uses the measure).
- **Labour and overhead** per batch: labour minutes × hourly rate, fixed overhead,
  overhead % of food cost, full cost and full cost per yield unit (rule 13), checked by
  the independent checker. Food cost % is unchanged. Shown in reports, CSV and print.
- **Price history**: changing a price or pack keeps the old one (up to 50), the
  Ingredients tab shows the change %, and the Price change tab lists old prices with
  "Try this price" (rule 15).
- **Cost counted %** per line (default 100%); 0% is a "pinch" (少量) whose unit needs no
  conversion. Reports and CSV mark such lines. "How much can I make" still uses the full
  amount.
- **Recipe weight**: ingredient weight per batch and per portion, as entered (rule 14);
  lines that cannot be weighed are listed.
- **Persistent storage**: Saucepenny asks the browser to keep its data
  (`navigator.storage.persist()`), shows the result in the Data tab, and falls back
  quietly where the browser does not support it.
- **Backup reminder** after 20 changes or 14 days without a backup file; "Not now" snoozes
  it for 7 days. No network is used.
- **Independent Python oracle** (`tools/oracle/oracle.py`, standard library only, in CI on
  Linux and Windows): many thousands of random cases for number and fraction parsing,
  unit conversion, recipe and menu costing (including food cost bands at their exact
  boundaries), labour/overhead, weights and price changes.

### Changed

- Project files are now version 2 (new optional fields only). Version 1 files open
  unchanged and are saved as version 2.
- Edits are saved at most one second after typing (previously only after a pause), and
  pending changes are saved when the page is hidden or closed.

## [0.1.0] - 2026-10-08

First public release.

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
- Web app: ingredient table with real cost per kg/L/piece, recipe editor with live cost
  and share per line, expandable sub-recipes, scaling and "how much can I make", menu
  table with colour bands and suggested prices, price change impact, CSV import/export,
  printable cost cards, IndexedDB storage with "delete all data", offline service worker,
  English and Traditional Chinese, dark mode and large text.
- Faster exact arithmetic (Knuth's gcd-saving addition and cross-cancelling
  multiplication); editing one line in a 1,000-ingredient × 500-recipe project updates in
  about 20 ms in headless Chrome.
- Written calculation rules (docs/calculation-rules.md).
- Three worked examples (cha chaan teng, home bakery, social-enterprise lunch) checked
  by the test suite, user guides in English and Traditional Chinese whose excerpts and
  commands are tested, and release instructions (docs/RELEASING.md).
