# Calculation rules (rules version 2)

Saucepenny follows these rules exactly. They are ordinary kitchen bookkeeping, written in
our own words. Every number is an exact fraction inside the program; rounding happens
**only when a number is displayed** (and for suggested prices, see rule 7).

## Inputs

- **Ingredient:** what you pay (`price`) for a pack (`pack quantity` + `unit`, for example
  5 斤, 1 kg, 30 pieces, 1 L), and the **usable share** after trimming or peeling
  (yield %, for example onions 90%: of each 1 kg bought, 900 g is usable). Optional:
  density (g/ml) to mix weight and volume, weight per piece (g) to mix pieces and weight.
- **Recipe:** a list of lines (an ingredient or another recipe, a quantity and a unit,
  optionally an extra loss % for that line) and what one batch **yields** (a number of
  portions, or a weight, volume or number of pieces). Cooking loss (for example meat
  losing weight when roasted) is shown by entering the cooked yield; there is no separate
  cooking factor, so the loss is never counted twice.
- **Recipe extras (optional, v0.2):** labour minutes per batch and an hourly rate; an
  overhead as a fixed amount per batch and/or a % of the food cost. Each line may also
  have a **cost counted %** (default 100%).
- **Menu item:** a recipe, how much of it is one portion, the menu price, whether that
  price already includes the service charge, a target food cost % and a rounding rule.

## Rules

1. **Ingredient cost per base unit** = price ÷ (pack quantity in base units × yield).
   Base units are grams, millilitres, pieces or portions. Line quantities are the
   _usable_ amounts.
2. **Line cost** = quantity in base units × ingredient cost per base unit ÷ (1 − line
   loss) × cost counted %. Example: 100 g with a 20% line loss costs as much as 125 g.
   The cost counted % is 100% unless you change it; at 0% (a "pinch", 少量) the line
   costs nothing and its unit does not need to be convertible (for example "1 pinch" of
   salt bought by the kilogram). Reports mark such lines ("pinch, not costed" /
   "cost counted at 50%").
3. **Recipe total** = sum of line costs. **Cost per yield unit** = total ÷ yield.
4. **Sub-recipe line** = quantity (converted to the sub-recipe's yield unit) × the
   sub-recipe's cost per yield unit. Sub-recipes may be nested up to 20 levels.
5. **Cost per portion** = the recipe's cost per yield unit × the portion size.
6. **Food cost %** = cost per portion ÷ net price. The net price excludes the service
   charge: if the menu price already includes a 10% service charge, net price = price ÷
   1.1, and Saucepenny says so next to the result.
7. **Suggested price** = cost per portion ÷ target %, then (if the menu price includes the
   service charge) × (1 + service charge), then rounded **up** with the item's rule: to
   the cent, 0.1, 0.5, 1, or "ending in 8" (the smallest whole amount ending in the digit
   8 that is not lower, for example 41.2 → 48, 48 → 48, 48.01 → 58). The real food cost
   % at the rounded price is shown too; because the price is only ever rounded up, it is
   never above the target. If the cost is 0, the suggested price is 0.
8. **Rounding for display:** amounts are rounded to the cent, halves away from zero
   (0.005 → 0.01). Each line is rounded on its own, so rounded lines may add up to a
   total that differs by a cent or two from the rounded total; reports say so.
9. **Errors are never turned into zero.** Saucepenny refuses to give a number and says
   why when: units cannot be converted (pieces without a weight per piece, weight ↔ volume
   without a density, portions of a recipe that yields litres); a yield % is 0 or above
   100; a recipe yields 0; or recipes use each other in a circle (the whole circle is
   listed). If a menu price is 0, food cost % and gross profit are shown as "—" with the
   reason (the suggested price is still given).

10. **Colour bands:** food cost % at or below the "good" setting (default 30%) is good;
    above the "high" setting (default 35%) is high; in between is watch. The boundaries
    themselves count as good and watch respectively (30% is good, 35% is watch).
11. **Price change impact:** Saucepenny recomputes everything with the new price and
    lists every recipe (cost of one batch) and menu item (cost per portion) whose cost
    changes, including those that use the ingredient only through a sub-recipe. The list is
    checked against the independent checker's own before/after.
12. **Scaling:** a different batch size multiplies every line by new yield ÷ old yield.
    "How much can I make with what I have" = available amount ÷ the amount of that
    ingredient needed per yield unit (through sub-recipes, including line waste %). The
    ingredient's usable yield % is already part of its price, so it does not reduce the
    amount here. If the recipe does not use the ingredient, the answer is "not used".
    The cost counted % is about money only: a 50% line still uses the full amount here,
    and a 0% line is ignored only because its unit may not be convertible.
13. **Labour and overhead (per batch):** labour = minutes ÷ 60 × hourly rate; overhead =
    fixed amount + food cost × overhead %; **full cost** = food cost + labour + overhead,
    and full cost per yield unit = full cost ÷ yield. **Food cost % is unchanged**: it
    never includes labour or overhead. A sub-recipe's own labour and overhead are not
    carried into recipes that use it (enter the time on the recipe you actually cost).
    The overhead % may be 0–1000%.
14. **Recipe weight:** the ingredient weight of one batch = the sum of every line's
    quantity converted to grams, **as entered** (before line loss and cooking loss).
    Volumes need a density, pieces need a weight per piece, and a sub-recipe line in
    litres needs the sub-recipe's density. Lines that cannot be weighed are listed and no
    total is given. Weight per portion = batch weight ÷ number of portions (only for
    recipes that yield portions).
15. **Price history:** when you change an ingredient's price or pack, the old price, pack
    and date are kept (up to 50 entries; the oldest is dropped). A previous price of 0 is
    not kept (it was a placeholder). **Price change** = (new price − old price) ÷ old
    price, shown only when the pack is the same (otherwise "pack changed"), and checked
    against new ÷ old − 1. The price change impact tool (rule 11) can start from any
    kept old price.

## Number input

Numbers may be typed with full-width digits (１２．５) and thousands commas in groups of
three (1,234.5). Rejected, with a message: empty fields, `NaN`/`Infinity`, exponents
(`1e5`), more than one decimal point, badly placed commas (`1,23.4`), and more than 15
significant digits. `-0` is read as 0.

**Fractions (v0.2)** are accepted in quantity fields only (recipe amounts, pack quantity,
batch yield, portion size, "scale to" and "what I have"): `1/2`, `1 1/2` (a whole number,
one space, then a proper fraction), `½`, `1½`, `1 ½`, and full-width or other slash
characters (`１／２`, `1⁄2`). Rejected: a zero denominator, an improper mixed number
(`1 3/2`; write `5/2` instead), signs, and more than 15 significant digits in a part. The
text is kept as typed, so `1/3` stays exactly one third. Prices, percentages and
densities stay decimal.

## Independent check

A separate checker recomputes every displayed recipe total, line cost, cost per portion,
food cost %, suggested price, labour, overhead, full cost, recipe weight and price change
by a different method (it expands every dish into raw ingredient packs first, then prices
them). A number is shown only if both agree exactly.

An independent Python program (`tools/oracle/oracle.py`, standard library only) also
re-derives number parsing, fractions, unit conversion, recipe and menu costing,
labour/overhead, weights and price changes from these rules for many thousands of random
cases, in CI on Linux and Windows.

Units and their legal or standards sources: [units.md](units.md).
