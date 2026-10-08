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

## 5. Price change

**Price change** shows what happens if one ingredient's pack price changes: every recipe
and menu item whose cost changes is listed with before, after and the difference,
including those that use it only through a sub-recipe.

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
