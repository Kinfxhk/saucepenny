# Saucepenny user guide

[繁體中文版](guide.zh-Hant.md)

Saucepenny works out what your recipes cost, the cost per portion, the food cost % of
each menu item and a suggested price. Everything runs in your browser; nothing is
uploaded.

> **Estimates only, not accounting or tax advice.** The results are only as good as the
> prices, yields and quantities you enter. Saucepenny does not calculate nutrition or
> allergens.

## 1. Open Saucepenny

- **Online:** open the published site (see the README). After the first visit it also
  works offline.
- **On your own computer** (Node.js 22 or later):

```sh
npm ci
npm start   # builds the site and serves it at http://127.0.0.1:4893/
```

- **Docker:** see the README. The container only serves the static site.

The first time you open it, the **cha chaan teng example** is loaded so you can look
around. **Data & settings → New empty project** starts from scratch.

## 2. Ingredients

Enter what you pay for one pack: pack size, unit and price, for example 1 斤 of pork
shoulder for $62, a 410 g can of evaporated milk for $11.50 or 30 eggs for $48.

- **Usable %**: the share left after trimming, peeling or boning (for example 88% for
  pork shoulder). The real cost goes up accordingly: $62 ÷ 0.88 per usable 斤.
- **Density (g/ml)**: only needed if you use the ingredient by volume but buy it by
  weight, or the other way round (for example soy sauce bought in ml and used in grams).
- **g per piece**: only needed if you use pieces of something bought by weight (or the
  other way round).
- **Real cost** shows the usable cost per kg, per litre or per piece.

Numbers may be typed with full-width digits (１２．５) and thousands commas (1,250).
Quantities (not prices) may also be fractions: `1/2`, `1 1/2`, `½` or `1½`.

**Price history:** when you change a price or a pack, the old price, pack and date are
kept (up to 50). The ingredient shows the change, for example "↑ 12.9% since 2026-09-01",
when the pack is the same. Old prices are listed in the **Price change** tab.

You can import a list with **Import CSV**. The first row names the columns, in English
or Chinese: `name, pack qty, unit, price, yield %, density g/ml, piece weight g, price
date, note` or `名稱, 包裝數量, 單位, 價錢, 可用率 %, 密度 g/ml, 每件重量 g, 價格日期, 備註`.
Units can be written as `斤`, `兩`, `kg`, `g`, `lb`, `oz`, `ml`, `L`, `杯`, `湯匙`, `茶匙`,
`件` and so on. Rows with problems are listed with their line number and are not
imported; the others are.

## 3. Recipes and sub-recipes

A recipe says how much it **makes** (for example 12 portions, 1 L or 350 g) and what goes
into it. A line can be an ingredient or **another recipe** (a sauce, a syrup, a dough),
so a 叉燒飯 can use 叉燒, which uses 叉燒醬, which uses 糖水.

- **Waste %** on a line is extra loss for that line only (spills, sauce left in the pan).
  10% waste means you need 1 ÷ 0.9 of the amount.
- Each line shows its **cost** and its **share** of the recipe. **Show …** under a
  sub-recipe line opens that sub-recipe.
- **Scale** shows every amount and the cost for a different batch size.
- **How much can I make?** tells you how much of the recipe an amount of one ingredient
  allows (through sub-recipes too).

- **Cost %** on a line is how much of its cost is counted (default 100%). Set it to 0%
  for a pinch of salt or a few spring onions you do not want to cost (少量): the line
  then needs no unit conversion and reports mark it "pinch, not costed".
- **Duplicate recipe** makes a copy to turn into a variation.
- **Ingredient weight** adds up every line in grams as entered (before waste), and per
  portion when the recipe yields portions. Lines in volume or pieces need a density or a
  weight per piece; otherwise they are listed.
- **Labour and overhead (optional):** minutes of work per batch × cost per hour, plus a
  fixed overhead per batch and/or a % of the food cost. Saucepenny shows the **full
  cost** of a batch and per yield unit. Example: 45 minutes at $72 an hour is $54 of
  labour; with $10 fixed and 10% overhead on a $200 food cost, the full cost is
  $200 + $54 + $30 = $284. The food cost % on the menu does not include these.

If recipes use each other in a circle (A uses B, B uses A), Saucepenny names the whole
circle and refuses to give a number. Sub-recipes can be nested up to 20 levels.

### Worked example

From `examples/cha-chaan-teng.json` (`saucepenny cost`):

<!-- doc-test: cost examples/cha-chaan-teng.json -->

```text
叉燒 Char siu (yields 12 portions)
  梅頭肉 Pork shoulder  3 catty (斤)  211.36  94.3%
  ↳ 叉燒醬 Char siu glaze  250 ml (+10.0% waste)  12.66  5.7%
  total 224.03 · per portion 18.67
```

The pork line is 3 斤 × $62 ÷ 0.88 usable = $211.36. The glaze line is 250 ml of a
glaze that costs $22.79 per 500 ml, with 10% waste: 250 × 22.79… ÷ 500 ÷ 0.9 = $12.66.
One portion is $224.03 ÷ 12 = $18.67.

## 4. Menu

Each menu item uses a recipe and a portion of it (for example 1 portion, or 0.5 portion
for an extra topping, or 250 ml of soup).

- **Food cost %** = cost per portion ÷ price without service charge. If the price
  includes the 10% service charge, Saucepenny first takes it out (price ÷ 1.1).
- **Colour bands:** good at or below 30%, high above 35%, watch in between (you can
  change both limits under Data & settings). The band is always written as a word too.
- **Suggested price** = cost per portion ÷ target %, plus service charge if the price
  includes it, then rounded **up** to the cent, 0.1, 0.5, 1 or "ending in 8" (41.2 →
  48). Because it is only ever rounded up, the real food cost % at the suggested price
  (shown next to it) never goes above the target.
- **Gross profit** = price without service charge − cost per portion.

<!-- doc-test: cost examples/cha-chaan-teng.json -->

```text
叉燒飯 Char siu rice (叉燒飯 Char siu rice, 1 portion)
  price 52.00 · cost 23.54
  food cost 45.3% (high) · gross profit 28.46
  target 32.0% → suggested 78.00 (at suggested 30.2%)
```

### Menu engineering (v0.3)

Below the menu table, **Menu engineering** groups your dishes by popularity and margin.
Type how many of each item you sold in a period, or **Import sales CSV** with two columns
`item` (menu item name) and `sold` (Chinese headers `項目`, `售出` also work; repeated
items are added together, and unknown names or bad numbers are listed by line).
**Download sales sheet** gives a ready file with every menu item.

- **Margin** = price without service charge − cost per portion.
- **Share of sales** = sold ÷ total sold. An item is **popular** when its share is at
  least 70% of an equal share (with 4 items: 0.7 ÷ 4 = 17.5%).
- **High margin** when the margin is at least the sales-weighted average margin.
- Groups: **Keep** (popular, high margin), **Raise margin** (popular, low margin),
  **Promote** (high margin, less popular), **Rethink** (low margin, less popular).
  Items without a price or a verified cost are left out and listed.

With the example project and 320 char siu rice, 540 milk tea, 150 iced lemon tea and 40
extra char siu sold (1,050 in all), the weighted average margin is 19.15 and an item is
popular from 17.5%: char siu rice (30.5%, margin 28.46) is **Keep**, milk tea (51.4%,
14.68) is **Raise margin**, and iced lemon tea (14.3%, 15.54) and extra char siu (3.8%,
18.67) are **Rethink**. **Export analysis (CSV)** saves the table. Sales counts are not
saved in the project.

## 5. Price change

### Supplier price lists (v0.3)

**Update prices from a supplier list** reads a CSV with the columns name, pack qty, unit
and price (price date optional; other columns such as a supplier code are ignored). Each
row is matched to one of your ingredients by identical name, or by a match you chose
before on this device; pick the ingredient for any row that is not matched. The table
shows the price now, the new price and the change **per unit** (for example 13 / 1 kg →
28 / 2 kg is +7.7% per unit). Rows with the same price are left unticked. Nothing
changes until you press **Apply**; old prices go into each ingredient's price history.

**Price change** shows what happens if one ingredient's pack price changes: every recipe
and menu item whose cost changes is listed with before, after and the difference,
including those that use it only through a sub-recipe. Below it, **Earlier prices of
this ingredient** lists kept old prices; **Try this price** starts the calculation from
one of them.

<!-- doc-test: impact examples/cha-chaan-teng.json pork-shoulder 70 -->

```text
Recipe · 叉燒 Char siu: 224.03 → 251.30 (+27.27)
Recipe · 叉燒飯 Char siu rice: 23.54 → 25.81 (+2.27)
Menu item · 加叉燒 Extra char siu: 9.33 → 10.47 (+1.14)
```

## 6. Files, printing and privacy

- **Save project (.json)** and **Open project (.json)** move a project between devices
  and are your backup. **Menu costs** and **Recipe costs** export CSV files for a
  spreadsheet; cells that a spreadsheet could run as a formula are prefixed with `'`.
- **Print cost cards** prints the menu table and one card per recipe.
- Your project is saved only in this browser (IndexedDB). **Delete all data on this
  device** removes it and your settings.
- **Storage on this device** (Data tab) shows whether the browser agreed to keep the data
  even when space runs low; **Ask the browser again** repeats the request. Browsers may
  still clear site data, so keep backup files.
- After 20 changes or 14 days without a backup, a reminder offers **Save backup (.json)**;
  **Not now** hides it for 7 days. It never uses the network.
- **Custom measures** (Data tab): add your own measures, such as a scoop of 40 g or a
  bowl of 300 ml, and use them in recipe lines. A measure in use cannot be removed.

## 7. Command line

The same engine runs on the command line (Node.js 22 or later):

```sh
npm run saucepenny -- cost examples/cha-chaan-teng.json
npm run saucepenny -- cost examples/home-bakery.json --lang zh-HK
npm run saucepenny -- cost examples/social-enterprise-lunch.json --csv menu --out menu.csv
npm run saucepenny -- check examples/home-bakery.json
npm run saucepenny -- impact examples/cha-chaan-teng.json sugar 15
```

Exit codes: 0 all numbers verified; 1 usage or file error; 2 some items have problems
(each one explained); 4 internal check failed (please report it).

## 8. How the numbers are checked

Every amount is an exact fraction inside Saucepenny; it is only rounded when shown. A
separate checker recomputes every recipe total, line cost, cost per portion, food cost %
and suggested price by a different method (it first expands each dish into raw
ingredient packs), and a number is shown only if both agree exactly. The full rules are
in [calculation-rules.md](calculation-rules.md); unit constants and their legal sources
are in [units.md](units.md).
