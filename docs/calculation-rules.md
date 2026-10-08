# Calculation rules (rules version 1)

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
- **Menu item:** a recipe, how much of it is one portion, the menu price, whether that
  price already includes the service charge, a target food cost % and a rounding rule.

## Rules

1. **Ingredient cost per base unit** = price ÷ (pack quantity in base units × yield).
   Base units are grams, millilitres, pieces or portions. Line quantities are the
   _usable_ amounts.
2. **Line cost** = quantity in base units × ingredient cost per base unit ÷ (1 − line
   loss). Example: 100 g with a 20% line loss costs as much as 125 g.
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

## Number input

Numbers may be typed with full-width digits (１２．５) and thousands commas in groups of
three (1,234.5). Rejected, with a message: empty fields, `NaN`/`Infinity`, exponents
(`1e5`), more than one decimal point, badly placed commas (`1,23.4`), and more than 15
significant digits. `-0` is read as 0.

## Independent check

A separate checker recomputes every displayed recipe total, line cost, cost per portion,
food cost % and suggested price by a different method (it expands every dish into raw
ingredient packs first, then prices them). A number is shown only if both agree exactly.

Units and their legal or standards sources: [units.md](units.md).
