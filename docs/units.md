# Units and their sources

Saucepenny converts every quantity to a **base unit** (gram for mass, millilitre for
volume, "piece" for counts) using **exact rational factors**. No factor below is rounded.
Each constant was checked against the primary source on 2026-10-08 before it was added.

## Mass (base unit: gram)

| Unit                   | Factor (grams, exact)    | Source                                                                                                              |
| ---------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| mg                     | 1/1000                   | SI prefix                                                                                                           |
| g                      | 1                        | SI                                                                                                                  |
| kg                     | 1000                     | SI                                                                                                                  |
| lb (avoirdupois pound) | 453.59237                | Cap. 68, First Schedule: "1 pound = 0.453 592 37 kilogram exactly"; NIST HB 44 App. C: "453.592 37 grams (exactly)" |
| oz (avoirdupois ounce) | 28.349523125 (= lb ÷ 16) | Cap. 68, First Schedule: "1 ounce = 1/16 pound"; NIST HB 44 App. C: 16 ounces = 1 avoirdupois pound                 |
| 斤 catty (kan)         | 604.78982                | Cap. 68, First Schedule (c) Chinese Units: "1 catty (kan) = 0.604 789 82 kilogram"（1斤 = 0.604 789 82公斤）        |
| 兩 tael (leung)        | 37.79936375 (= 斤 ÷ 16)  | Cap. 68, First Schedule (c): "1 tael (leung) = 1/16 catty"（1兩 = 1/16斤）                                          |

The tael is defined in the Ordinance as 1/16 catty, so Saucepenny uses exactly
604.78982 ÷ 16 = 37.79936375 g (not a rounded 37.8 g). A test checks that
斤 → 兩 → g equals 斤 → g exactly. The troy tael (金衡兩, used for gold) is a different
unit and is **not** included.

## Volume (base unit: millilitre)

| Unit     | Factor (millilitres, exact)   | Source                                                                                                                                                                                     |
| -------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ml       | 1                             | SI                                                                                                                                                                                         |
| L        | 1000                          | SI                                                                                                                                                                                         |
| US fl oz | 29.5735295625                 | NIST HB 44 App. C: 1 gallon = 231 cubic inches (exactly) = 128 fluid ounces (exactly); 1 inch = 2.54 centimetres (exactly), so 1 in³ = 16.387064 mL and 1 fl oz = 231 × 16.387064 ÷ 128 mL |
| US cup   | 236.5882365 (= 8 US fl oz)    | NIST HB 44 App. C: "1 cup, measuring = 8 fluid ounces (exactly)"                                                                                                                           |
| US tbsp  | 14.78676478125 (= ½ US fl oz) | NIST HB 44 App. C: "1 tablespoon, measuring = ½ fluid ounce (exactly)"                                                                                                                     |
| US tsp   | 4.92892159375 (= ⅓ US tbsp)   | NIST HB 44 App. C: "1 teaspoon, measuring = ⅓ tablespoon (exactly)"                                                                                                                        |

Notes:

- The **US** fluid ounce, cup and spoons are used and labelled "US". Cap. 68 also defines
  an imperial "fluid ounce" (1/20 imperial pint), which is a different, slightly smaller
  unit; it is **not** included, to avoid confusion.
- Metric "cups" (250 ml) and the US nutrition-label cup (240 ml) are **not** built in. If
  your recipes use one of them, add a custom measure (for example "my cup = 250 ml").
- NIST describes tablespoons and teaspoons as imprecise in everyday use (real spoons
  vary); Saucepenny uses their exact definitions.

## Counts (base unit: piece)

件, 隻, 個 and "piece" are all the same count unit. To use a count with a weight or volume
(for example, eggs bought by the dozen but used by the gram), enter the **weight per
piece** for that ingredient. Without it, Saucepenny reports an error instead of guessing.

## Mass ↔ volume

Converting between mass and volume needs the ingredient's **density** in g/ml (for
example, water ≈ 1, but flour, oil and syrup differ). Without a density, Saucepenny
reports an error instead of guessing.

## Sources

- Hong Kong e-Legislation, _Weights and Measures Ordinance_ (Cap. 68), First Schedule
  (English and Chinese versions), <https://www.elegislation.gov.hk/hk/cap68>.
- NIST Handbook 44 (2026), Appendix C, _General Tables of Units of Measurement_,
  <https://doi.org/10.6028/NIST.HB.44-2026>.
