#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Independent Python oracle for Saucepenny (standard library only).

It shares no code with the TypeScript engine. It builds random cases, works out every
expected number itself with exact fractions (fractions.Fraction), runs the same cases
through the real TypeScript code (tools/oracle/bridge.ts, via node), and compares the
results exactly. Covered: quantity parsing (decimals and fractions), unit conversion,
recipe costing with sub-recipes, waste, counted cost %, labour/overhead, ingredient weight,
menu pricing (net price, food cost %, gross profit, band, suggested price) and price
history.

    python3 tools/oracle/oracle.py [--seed N] [--projects N] [--quick]

Unit factors are typed in here again from the legal definitions (Hong Kong Cap. 68 for
pound, ounce, catty and tael; NIST Handbook 44 for US volume units), not read from the
TypeScript table.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import re
import subprocess
import sys
import unicodedata
from fractions import Fraction as F

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ---- units, from the definitions -------------------------------------------------------
POUND = F("0.45359237") * 1000          # g, Cap. 68
CATTY = F("0.60478982") * 1000          # g, Cap. 68
CUBIC_INCH = F("2.54") ** 3             # ml (cm³)
GALLON = 231 * CUBIC_INCH               # US gallon
FLOZ = GALLON / 128
UNITS = {
    "mg": ("mass", F(1, 1000)), "g": ("mass", F(1)), "kg": ("mass", F(1000)),
    "oz": ("mass", POUND / 16), "lb": ("mass", POUND),
    "catty": ("mass", CATTY), "tael": ("mass", CATTY / 16),
    "ml": ("volume", F(1)), "l": ("volume", F(1000)),
    "floz": ("volume", FLOZ), "cup": ("volume", FLOZ * 8),
    "tbsp": ("volume", FLOZ / 2), "tsp": ("volume", FLOZ / 6),
    "piece": ("count", F(1)),
}
UNIT_IDS = list(UNITS)


# ---- quantity parsing, written again from docs/calculation-rules.md ----------------------
VULGAR = {"½": (1, 2), "⅓": (1, 3), "⅔": (2, 3), "¼": (1, 4), "¾": (3, 4), "⅕": (1, 5),
          "⅖": (2, 5), "⅗": (3, 5), "⅘": (4, 5), "⅙": (1, 6), "⅚": (5, 6), "⅐": (1, 7),
          "⅛": (1, 8), "⅜": (3, 8), "⅝": (5, 8), "⅞": (7, 8), "⅑": (1, 9), "⅒": (1, 10)}
FOLD = {"．": ".", "，": ",", "＋": "+", "－": "-", "−": "-", "／": "/", "⁄": "/"}


def fold(s: str) -> str:
    out = []
    for ch in s:
        o = ord(ch)
        if 0xFF10 <= o <= 0xFF19:
            out.append(chr(o - 0xFF10 + 48))
        else:
            out.append(FOLD.get(ch, ch))
    s = "".join(out).strip(" \t\n\r\u3000")
    res = []
    for i, ch in enumerate(s):
        if ch in VULGAR:
            n, d = VULGAR[ch]
            if res and res[-1].isdigit():
                res.append(" ")
            res.append(f"{n}/{d}")
        else:
            res.append(ch)
    return re.sub(r"[ \t\n\r\u3000]+", " ", "".join(res))


def sig(digits: str) -> int:
    return len(digits.lstrip("0"))


def parse_quantity(text: str):
    """('ok', Fraction) or ('err', code)."""
    s = fold(text)
    if s == "":
        return ("err", "empty")
    if "/" in s:
        m = re.fullmatch(r"(?:([0-9]+) )?([0-9]+)/([0-9]+)", s)
        if not m:
            return ("err", "bad-fraction")
        w, n, d = m.group(1), m.group(2), m.group(3)
        if any(sig(x) > 15 for x in (w or "", n, d)):
            return ("err", "too-many-digits")
        if int(d) == 0:
            return ("err", "zero-denominator")
        if w is None:
            return ("ok", F(int(n), int(d)))
        if int(n) >= int(d):
            return ("err", "bad-fraction")
        return ("ok", int(w) + F(int(n), int(d)))
    m = re.fullmatch(r"([+-]?)([0-9,]*)(?:\.([0-9]+))?", s)
    if not m or (m.group(2) == "" and m.group(3) is None):
        return ("err", "*")
    sign, ip, fp = m.group(1), m.group(2), m.group(3) or ""
    if "," in ip and not re.fullmatch(r"[0-9]{1,3}(,[0-9]{3})+", ip):
        return ("err", "*")
    ip = ip.replace(",", "")
    if sig(ip + fp) > 15:
        return ("err", "*")
    v = F(int(ip or "0")) + (F(int(fp), 10 ** len(fp)) if fp else 0)
    return ("ok", -v if sign == "-" else v)


# ---- text forms of exact values ---------------------------------------------------------
FW = str.maketrans("0123456789/", "０１２３４５６７８９／")


def qty_text(rng: random.Random, v: F) -> str:
    """A way a user might type the (positive) quantity v."""
    if v.denominator == 1 and rng.random() < 0.4:
        t = str(v.numerator)
        if v.numerator >= 1000 and rng.random() < 0.3:
            t = f"{v.numerator:,}"
        return t.translate(FW) if rng.random() < 0.1 else t
    d = v.denominator
    whole, rest = divmod(v.numerator, d)
    forms = [f"{v.numerator}/{d}"]
    if whole and rest:
        forms.append(f"{whole} {rest}/{d}")
        for ch, (n, dd) in VULGAR.items():
            if F(n, dd) == F(rest, d):
                forms += [f"{whole}{ch}", f"{whole} {ch}"]
    if not whole:
        for ch, (n, dd) in VULGAR.items():
            if F(n, dd) == v:
                forms.append(ch)
    if set(_factors(d)) <= {2, 5}:
        k = 0
        while (10 ** k) % d:
            k += 1
        scaled = v.numerator * (10 ** k // d)
        t = str(scaled).rjust(k + 1, "0")
        forms.append(f"{t[:-k]}.{t[-k:]}" if k else t)
    t = rng.choice(forms)
    return t.translate(FW) if rng.random() < 0.1 else t


def _factors(n: int):
    out, p = [], 2
    while p * p <= n:
        while n % p == 0:
            out.append(p)
            n //= p
        p += 1
    if n > 1:
        out.append(n)
    return out


def dec_text(v: F) -> str:
    """Exact decimal text of a value with a power-of-ten denominator."""
    k = 0
    while (v.numerator * 10 ** k) % v.denominator:
        k += 1
    n = v.numerator * 10 ** k // v.denominator
    t = str(n).rjust(k + 1, "0")
    return f"{t[:-k]}.{t[-k:]}" if k else t


def rand_qty(rng: random.Random, lo=1, hi=2000) -> F:
    kind = rng.random()
    if kind < 0.35:
        return F(rng.randint(lo, hi))
    if kind < 0.65:
        return F(rng.randint(lo * 100, hi * 100), 100)
    d = rng.choice([2, 3, 4, 8, 16, 5, 6, 12])
    return F(rng.randint(lo * d, hi * d) + rng.randint(1, d - 1), d)


def rand_money(rng: random.Random, hi=500) -> F:
    return F(rng.randint(0, hi * 100), 100)


# ---- independent costing ------------------------------------------------------------------
def to_base(qty, unit, target_dim, measures, density=None, piece=None):
    """qty of unit → base units (g/ml/piece/portion) of target_dim; None if impossible."""
    if unit == "portion":
        dim, f = "portion", F(1)
    elif unit.startswith("measure:"):
        m = measures[unit[8:]]
        dim, f = UNITS[m["unit"]][0], UNITS[m["unit"]][1] * m["amount"]
    else:
        dim, f = UNITS[unit]
    base = qty * f
    if dim == target_dim:
        return base
    if "portion" in (dim, target_dim):
        return None
    per_gram = {"mass": F(1), "volume": density, "count": piece}
    a, b = per_gram[dim], per_gram[target_dim]
    if not a or not b:
        return None
    return base * a / b


def unit_dim(unit, measures):
    if unit == "portion":
        return "portion"
    if unit.startswith("measure:"):
        return UNITS[measures[unit[8:]]["unit"]][0]
    return UNITS[unit][0]


def unit_factor(unit, measures):
    if unit == "portion":
        return F(1)
    if unit.startswith("measure:"):
        m = measures[unit[8:]]
        return UNITS[m["unit"]][1] * m["amount"]
    return UNITS[unit][1]


def cost_project(P):
    """Expected numbers for a project in the oracle's own form (values are Fractions)."""
    measures = {m["id"]: m for m in P["measures"]}
    ings = {g["id"]: g for g in P["ingredients"]}
    recs = {r["id"]: r for r in P["recipes"]}
    results = {}

    def recipe(rid):
        if rid in results:
            return results[rid]
        r = recs[rid]
        lines, total, ok = [], F(0), True
        for ln in r["lines"]:
            if ln["share"] == 0:
                lines.append(F(0))
                continue
            if ln["kind"] == "ingredient":
                g = ings[ln["id"]]
                gdim = unit_dim(g["packUnit"], measures)
                per_base = g["price"] / (g["packQty"] * unit_factor(g["packUnit"], measures) * g["yield"])
                qb = to_base(ln["qty"], ln["unit"], gdim, measures, g.get("density"), g.get("piece"))
                if qb is None:
                    ok = False
                    break
                c = qb * per_base
            else:
                child = recipe(ln["id"])
                if child is None:
                    ok = False
                    break
                cr = recs[ln["id"]]
                cdim = unit_dim(cr["yieldUnit"], measures)
                qb = to_base(ln["qty"], ln["unit"], cdim, measures, cr.get("density"))
                if qb is None:
                    ok = False
                    break
                c = qb * child["total"] / (cr["yieldQty"] * unit_factor(cr["yieldUnit"], measures))
            c = c / (1 - ln["waste"]) * ln["share"]
            lines.append(c)
            total += c
        res = None
        if ok:
            e = r["extras"]
            labour = e["minutes"] * e["rate"] / 60
            overhead = e["fixed"] + total * e["pct"] / 100
            has = (e["minutes"] != 0 and e["rate"] != 0) or e["fixed"] != 0 or e["pct"] != 0
            res = {"total": total, "perYieldUnit": total / r["yieldQty"], "lines": lines,
                   "extras": {"labour": labour, "overhead": overhead,
                              "full": total + labour + overhead,
                              "fullPerYieldUnit": (total + labour + overhead) / r["yieldQty"]} if has else None}
        results[rid] = res
        return res

    out_r = {}
    for rid, r in recs.items():
        res = recipe(rid)
        grams, missing = F(0), []
        for j, ln in enumerate(r["lines"]):
            if ln["kind"] == "ingredient":
                g = ings[ln["id"]]
                w = to_base(ln["qty"], ln["unit"], "mass", measures, g.get("density"), g.get("piece"))
            else:
                w = to_base(ln["qty"], ln["unit"], "mass", measures, recs[ln["id"]].get("density"))
            if w is None:
                missing.append(j)
            else:
                grams += w
        weight = {"missing": missing} if missing else {
            "grams": grams, "perPortion": grams / r["yieldQty"] if r["yieldUnit"] == "portion" else None}
        out_r[rid] = {"res": res, "weight": weight}

    s = P["settings"]
    out_m = {}
    for m in P["menu"]:
        rr = results.get(m["recipeId"])
        r = recs[m["recipeId"]]
        if rr is None:
            out_m[m["id"]] = None
            continue
        ydim = unit_dim(r["yieldUnit"], measures)
        qb = to_base(m["portionQty"], m["portionUnit"], ydim, measures, r.get("density"))
        if qb is None:
            out_m[m["id"]] = None
            continue
        per_base = rr["total"] / (r["yieldQty"] * unit_factor(r["yieldUnit"], measures))
        pc = qb * per_base
        sc = s["service"] / 100
        net = m["price"] / (1 + sc) if m["incl"] else m["price"]
        food = None if net == 0 else pc / net
        gp = None if net == 0 else net - pc
        band = None
        if food is not None:
            band = "good" if food <= s["good"] / 100 else "high" if food > s["high"] / 100 else "watch"
        sugg, sugg_food = F(0), F(0)
        if pc != 0:
            listed = pc / (m["target"] / 100) * ((1 + sc) if m["incl"] else 1)
            rule = m["rounding"]
            if rule == "ending-8":
                c = math.ceil(listed)
                while c % 10 != 8:
                    c += 1
                sugg = F(c)
            else:
                step = {"none": F(1, 100), "0.1": F(1, 10), "0.5": F(1, 2), "1": F(1)}[rule]
                sugg = math.ceil(listed / step) * step
            sugg_food = pc / (sugg / (1 + sc) if m["incl"] else sugg)
        out_m[m["id"]] = {"portionCost": pc, "netPrice": net, "foodCost": food, "grossProfit": gp,
                          "band": band, "suggestedPrice": sugg, "suggestedFoodCost": sugg_food}
    return out_r, out_m


# ---- random projects ------------------------------------------------------------------------
def rand_project(rng: random.Random, idx: int):
    """(oracle form with Fractions, stored JSON form with text)."""
    P = {"measures": [], "ingredients": [], "recipes": [], "menu": []}
    S = {"schema": "saucepenny/project", "version": 2, "name": f"oracle {idx}",
         "measures": [], "ingredients": [], "recipes": [], "menu": []}
    service = F(rng.choice([0, 10, 12, 15]))
    good = F(rng.randint(20, 32))
    high = good + rng.randint(0, 10)
    P["settings"] = {"service": service, "good": good, "high": high}
    S["settings"] = {"currency": "HKD", "serviceChargePercent": str(service),
                     "goodPercent": str(good), "highPercent": str(high)}
    for k in range(rng.randint(0, 2)):
        amt, u = rand_qty(rng, 1, 400), rng.choice(UNIT_IDS)
        P["measures"].append({"id": f"m{k}", "amount": amt, "unit": u})
        S["measures"].append({"id": f"m{k}", "name": f"measure {k}", "amount": qty_text(rng, amt), "unit": u})
    units = UNIT_IDS + [f"measure:m{k}" for k in range(len(P["measures"]))]
    for k in range(rng.randint(2, 7)):
        pq, pu, price = rand_qty(rng, 1, 50), rng.choice(units), rand_money(rng)
        y = F(rng.randint(30, 100)) if rng.random() < 0.6 else F(rng.randint(3000, 10000), 100)
        g = {"id": f"i{k}", "packQty": pq, "packUnit": pu, "price": price, "yield": y / 100}
        sg = {"id": f"i{k}", "name": f"ingredient {k}", "packQty": qty_text(rng, pq),
              "packUnit": pu, "price": dec_text(price)}
        if rng.random() < 0.7 or y != 100:
            sg["yieldPercent"] = dec_text(y)
        if rng.random() < 0.6:
            d = F(rng.randint(30, 200), 100)
            g["density"], sg["density"] = d, dec_text(d)
        if rng.random() < 0.5:
            w = rand_qty(rng, 1, 300)
            g["piece"], sg["pieceWeight"] = w, dec_text(w) if w.denominator in (1, 2, 4, 5, 10, 20, 25, 50, 100) else str(round(w))
            g["piece"] = F(sg["pieceWeight"])
        P["ingredients"].append(g)
        S["ingredients"].append(sg)
    for k in range(rng.randint(1, 5)):
        yq = rand_qty(rng, 1, 40)
        yu = rng.choice(["portion"] * 4 + units)
        r = {"id": f"r{k}", "yieldQty": yq, "yieldUnit": yu, "lines": []}
        sr = {"id": f"r{k}", "name": f"recipe {k}", "yieldQty": qty_text(rng, yq), "yieldUnit": yu, "lines": []}
        if rng.random() < 0.4:
            d = F(rng.randint(50, 150), 100)
            r["density"], sr["density"] = d, dec_text(d)
        for _ in range(rng.randint(1, 5)):
            if k and rng.random() < 0.3:
                ref = ("recipe", f"r{rng.randrange(k)}")
            else:
                ref = ("ingredient", f"i{rng.randrange(len(P['ingredients']))}")
            q = rand_qty(rng, 0, 500)
            if q == 0:
                q = F(1, 2)
            u = rng.choice(units + (["portion"] if ref[0] == "recipe" else []))
            waste = F(rng.choice([0, 0, 5, 10, 12.5, 33])) if rng.random() < 0.5 else F(0)
            share = F(rng.choice([0, 25, 50, 100, 100, 100, 12.5]))
            ln = {"kind": ref[0], "id": ref[1], "qty": q, "unit": u, "waste": F(waste) / 100, "share": share / 100}
            sl = {"ref": {"kind": ref[0], "id": ref[1]}, "qty": qty_text(rng, q), "unit": u}
            if waste:
                sl["wastePercent"] = dec_text(F(waste))
            if share != 100 or rng.random() < 0.1:
                sl["costPercent"] = dec_text(share)
            r["lines"].append(ln)
            sr["lines"].append(sl)
        e = {"minutes": F(0), "rate": F(0), "fixed": F(0), "pct": F(0)}
        if rng.random() < 0.6:
            e = {"minutes": F(rng.randint(0, 600)), "rate": rand_money(rng, 200),
                 "fixed": rand_money(rng, 50), "pct": F(rng.choice([0, 5, 10, 12.5, 100, 250]))}
            sr.update({"labourMinutes": str(e["minutes"]), "labourRate": dec_text(e["rate"]),
                       "overheadFixed": dec_text(e["fixed"]), "overheadPercent": dec_text(e["pct"])})
        r["extras"] = e
        P["recipes"].append(r)
        S["recipes"].append(sr)
    for k in range(rng.randint(0, 4)):
        rec = rng.choice(P["recipes"])
        pq = rand_qty(rng, 1, 3)
        pu = "portion" if rec["yieldUnit"] == "portion" and rng.random() < 0.8 else rng.choice(units)
        price = rand_money(rng, 200)
        incl = rng.random() < 0.5
        target = F(rng.randint(15, 60))
        rounding = rng.choice(["none", "0.1", "0.5", "1", "ending-8"])
        P["menu"].append({"id": f"d{k}", "recipeId": rec["id"], "portionQty": pq, "portionUnit": pu,
                          "price": price, "incl": incl, "target": target, "rounding": rounding})
        S["menu"].append({"id": f"d{k}", "name": f"dish {k}", "recipeId": rec["id"],
                          "portionQty": qty_text(rng, pq), "portionUnit": pu, "price": dec_text(price),
                          "priceIncludesService": incl, "targetPercent": str(target), "rounding": rounding})
    return P, S


def boundary_project(rng: random.Random, idx: int):
    """A dish whose food cost % lands exactly on the "good" or the "high" limit."""
    good = rng.randint(20, 32)
    high = good + rng.randint(0, 8)
    limit = rng.choice([good, high])
    k = rng.randint(1, 50)
    grams = rng.randint(1, 900)
    kg_price = F(limit * k)          # money per kg
    pc = kg_price * grams / 1000     # portion cost
    price = pc * 100 / limit         # = k × grams / 10: exact decimal
    incl = rng.random() < 0.5
    service = F(rng.choice([0, 10]))
    listed = price * (1 + service / 100) if incl else price
    if listed.denominator not in (1, 2, 5, 10, 20, 50, 100, 4, 25):
        incl, listed = False, price
    S = {"schema": "saucepenny/project", "version": 2, "name": f"boundary {idx}",
         "settings": {"currency": "HKD", "serviceChargePercent": str(service),
                      "goodPercent": str(good), "highPercent": str(high)},
         "measures": [],
         "ingredients": [{"id": "i0", "name": "x", "packQty": "1", "packUnit": "kg", "price": dec_text(kg_price)}],
         "recipes": [{"id": "r0", "name": "r", "yieldQty": "1", "yieldUnit": "portion",
                      "lines": [{"ref": {"kind": "ingredient", "id": "i0"}, "qty": str(grams), "unit": "g"}]}],
         "menu": [{"id": "d0", "name": "d", "recipeId": "r0", "portionQty": "1", "portionUnit": "portion",
                   "price": dec_text(listed), "priceIncludesService": incl, "targetPercent": "30",
                   "rounding": "none"}]}
    P = {"settings": {"service": service, "good": F(good), "high": F(high)}, "measures": [],
         "ingredients": [{"id": "i0", "packQty": F(1), "packUnit": "kg", "price": kg_price, "yield": F(1)}],
         "recipes": [{"id": "r0", "yieldQty": F(1), "yieldUnit": "portion",
                      "lines": [{"kind": "ingredient", "id": "i0", "qty": F(grams), "unit": "g",
                                 "waste": F(0), "share": F(1)}],
                      "extras": {"minutes": F(0), "rate": F(0), "fixed": F(0), "pct": F(0)}}],
         "menu": [{"id": "d0", "recipeId": "r0", "portionQty": F(1), "portionUnit": "portion",
                   "price": listed, "incl": incl, "target": F(30), "rounding": "none"}]}
    return P, S


# ---- random parse strings ---------------------------------------------------------------------
ALPHABET = list("0123456789") * 3 + [" ", " ", "/", "/", ".", ",", "½", "¾", "⅔", "／", "１", "２", "⁄", "-", "\u3000", "e"]


def rand_parse(rng: random.Random) -> str:
    if rng.random() < 0.1:  # mixed numbers near the "proper fraction" edge
        d = rng.randint(1, 12)
        return f"{rng.randint(0, 99)} {rng.randint(max(0, d - 2), d + 2)}/{d}"
    if rng.random() < 0.5:
        return qty_text(rng, rand_qty(rng, 0, 5000))
    return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(0, 9)))


# ---- compare --------------------------------------------------------------------------------
# ---- menu engineering (rule 16), written again from docs/calculation-rules.md -------------
def menu_eng(items):
    """items: (id, sold, margin) with margin a Fraction, None (not costed) or "noprice"."""
    excluded = [{"id": i, "reason": "not-costed" if m is None else "no-price"}
                for i, _, m in items if m is None or m == "noprice"]
    use = [(i, s, m) for i, s, m in items if m is not None and m != "noprice"]
    if not use:
        return {"status": "empty", "reason": "no-items", "excluded": excluded}
    total = sum(s for _, s, _ in use)
    if total == 0:
        return {"status": "empty", "reason": "no-sales", "excluded": excluded}
    weighted = sum(m * s for _, s, m in use)
    avg = weighted / total
    line = F(7, 10) / len(use)
    rows = []
    for i, s, m in use:
        mix = F(s, total)
        pop, prof = mix >= line, m >= avg
        quad = {(True, True): "keep", (True, False): "raise-margin",
                (False, True): "promote", (False, False): "rethink"}[(pop, prof)]
        rows.append([i, quad, fs(mix)])
    return {"status": "ok", "average": fs(avg), "line": fs(line), "totalMargin": fs(weighted),
            "totalSold": total, "rows": rows, "excluded": excluded}


def rand_menu_eng(rng: random.Random):
    n = rng.randint(1, 12)
    items = []
    tie = rng.random() < 0.4
    margins = [F(rng.randint(-20, 80), rng.choice([1, 2, 10])) for _ in range(3)]
    for k in range(n):
        r = rng.random()
        margin = None if r < 0.05 else "noprice" if r < 0.1 else (
            rng.choice(margins) if tie else F(rng.randint(-5000, 20000), rng.choice([1, 10, 100])))
        sold = 0 if rng.random() < 0.1 else rng.randint(0, 10 ** rng.randint(1, 6))
        items.append([f"m{k}", sold, margin])
    if tie and rng.random() < 0.5:
        # put a count exactly on the popularity line: 10 items, 100 sold, one with 7
        items = [[f"m{k}", 0, F(rng.randint(0, 5))] for k in range(10)]
        counts = [7, 13, 10, 10, 10, 10, 10, 10, 10, 10]
        rng.shuffle(counts)
        for it, c in zip(items, counts):
            it[1] = c
    if rng.random() < 0.05:
        for it in items:
            it[1] = 0
    return items


def me_payload(items):
    return [{"id": i, "sold": s, "margin": None if m is None else m if m == "noprice" else fs(m)}
            for i, s, m in items]


# ---- sales CSV (menu engineering input) ------------------------------------------------------
ITEM_HEADS = ["item", "Item", "menu item", "Menu_Item", "項目", "餐牌項目", "名稱", "name", "dish", "菜式"]
SOLD_HEADS = ["sold", "Sold", "qty", "quantity", "count", "portions", "售出", "數量", "銷量", "份數"]
MAX_SOLD = 1_000_000_000


def name_key(s: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", s).strip()).lower()


def parse_sold(t: str):
    t = "".join(chr(ord(c) - 0xFF10 + 48) if "\uff10" <= c <= "\uff19" else "," if c == "，" else c
                for c in t).strip(" \t\r\n\u3000")
    if not re.fullmatch(r"[0-9]+|[0-9]{1,3}(,[0-9]{3})+", t):
        return "bad"
    n = int(t.replace(",", ""))
    return "too-many" if n > MAX_SOLD else n


def sales_expected(rows, menu):
    """rows: (line, item, count) after the header; menu: list of {id, name}."""
    by_name = {}
    for m in menu:
        k = name_key(m["name"])
        by_name[k] = None if k in by_name else m["id"]
    ids = {m["id"] for m in menu}
    sold, merged, problems = {}, set(), []
    for line, item, count in rows:
        item, count = item.strip(), count.strip()
        if item == "" and count == "":
            continue
        if re.match(r"^'[=+\-@]", item):
            item = item[1:]
        k = name_key(item)
        named = by_name.get(k, "absent")
        mid = named if named not in (None, "absent") else (item if item in ids else None)
        if mid is None:
            problems.append([line, "ambiguous-item" if named is None else "unknown-item"])
            continue
        n = parse_sold(count)
        if n in ("bad", "too-many"):
            problems.append([line, "bad-sold" if n == "bad" else "too-many-sold"])
            continue
        total = sold.get(mid, 0) + n
        if total > MAX_SOLD:
            problems.append([line, "too-many-sold"])
            continue
        if mid in sold:
            merged.add(mid)
        sold[mid] = total
    return {"sold": sold, "merged": sorted(merged), "problems": problems}


FULLW = {c: chr(ord(c) + 0xFEE0) for c in "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"}
DISH = ["叉燒飯", "凍檸茶", "Beef Noodles", "egg tart", "Milk Tea", "雲吞麵", "Club Sandwich", "菠蘿包"]


def vary_name(rng, s):
    r = rng.random()
    if r < 0.2:
        return s.upper()
    if r < 0.35:
        return "  " + s.replace(" ", "   ") + " "
    if r < 0.45:
        return "".join(FULLW.get(c, c) for c in s)
    if r < 0.5:
        return s.replace(" ", "\u3000")
    return s


def count_text(rng, n):
    r = rng.random()
    if r < 0.5:
        return str(n)
    if r < 0.65:
        return f"{n:,}"
    if r < 0.72:
        return "".join(chr(ord(c) + 0xFEE0) for c in str(n))
    if r < 0.75:
        return f"{n:,}".replace(",", "，")
    return rng.choice(["-3", "1.5", "abc", "", "1,2", "12,34", "1e3", "１,２３４", str(MAX_SOLD),
                       str(MAX_SOLD + 1), "99999999999999999999", " 42 ", "0", "007", "+5"])


def csv_cell(s: str) -> str:
    return '"' + s.replace('"', '""') + '"' if any(c in s for c in ',"\r\n') else s


def rand_sales(rng: random.Random):
    names = rng.sample(DISH, rng.randint(1, len(DISH)))
    menu = [{"id": f"m{k}", "name": nm} for k, nm in enumerate(names)]
    if rng.random() < 0.25:
        menu.append({"id": f"m{len(menu)}", "name": names[0].lower()})  # two items share a name
    ih, sh = rng.choice(ITEM_HEADS), rng.choice(SOLD_HEADS)
    extra = rng.random() < 0.3
    header = [ih, sh] if rng.random() < 0.7 else [sh, ih]
    if extra:
        header.insert(rng.randint(0, 2), "note")
    if rng.random() < 0.03:
        header = [rng.choice(["foo", ih]), "bar"]
    lines = [",".join(csv_cell(h) for h in header)]
    rows = []
    for _ in range(rng.randint(0, 25)):
        if rng.random() < 0.05:
            lines.append("")  # blank line
            continue
        r = rng.random()
        if r < 0.6:
            item = vary_name(rng, rng.choice(menu)["name"])
        elif r < 0.75:
            item = rng.choice(menu)["id"]
        elif r < 0.8:
            item = "'=" + rng.choice(menu)["name"]
        elif r < 0.9:
            item = rng.choice(["Soup", "湯", "m99", ""])
        else:
            item = vary_name(rng, rng.choice(DISH))
        count = count_text(rng, rng.choice([rng.randint(0, 50), rng.randint(0, 5000), rng.randint(0, 10 ** 9)]))
        cells = {ih: item, sh: count, "note": rng.choice(["", "x", "a,b"])}
        lines.append(",".join(csv_cell(cells.get(h, "")) for h in header))
        rows.append((len(lines), item, count))
    text = ("\ufeff" if rng.random() < 0.3 else "") + rng.choice(["\r\n", "\n"]).join(lines)
    ok_header = ih in header and sh in header
    return {"text": text, "menu": menu}, (rows if ok_header else None), header


# ---- supplier price list ----------------------------------------------------------------------
def qtext(v: F) -> str:
    d = v.denominator
    for p in (2, 5):
        while d % p == 0:
            d //= p
    return dec_text(v) if d == 1 else f"{v.numerator}/{v.denominator}"


def rand_supplier(rng: random.Random):
    unit = rng.choice(UNIT_IDS)
    op = rand_money(rng) if rng.random() < 0.9 else F(0)
    oq = rand_qty(rng, 1, 2000)
    old = {"id": "a", "name": "a", "packQty": qtext(oq), "packUnit": unit, "price": dec_text(op)}
    if rng.random() < 0.6:
        old["priceDate"] = f"2026-{rng.randint(1, 9):02d}-{rng.randint(1, 28):02d}"
    r = rng.random()
    if r < 0.15:
        nu, np_, nq = unit, op, oq  # same price
        nq_text = qtext(oq)
        if rng.random() < 0.5 and "/" not in nq_text:
            nq_text += "0" if "." in nq_text else ".0"
    else:
        same_dim = [u for u in UNIT_IDS if UNITS[u][0] == UNITS[unit][0]]
        nu = rng.choice(same_dim) if rng.random() < 0.85 else rng.choice(UNIT_IDS)
        np_ = rand_money(rng)
        if rng.random() < 0.2:
            nq = F(rng.randint(1, 9), rng.choice([2, 3, 4, 8]))
            nq_text = f"{nq.numerator}/{nq.denominator}" if nq.denominator != 1 else str(nq.numerator)
        else:
            nq = rand_qty(rng, 1, 2000)
            nq_text = qtext(nq)
    row = {"price": dec_text(np_), "packQty": nq_text, "packUnit": nu}
    if rng.random() < 0.5:
        row["priceDate"] = f"2026-10-{rng.randint(1, 8):02d}"
    case = {"old": old, "row": row, "today": "2026-10-08"}
    return case, (op, oq, unit, np_, nq, nu)


def supplier_expected(case, nums):
    op, oq, ou, np_, nq, nu = nums
    old, row, today = case["old"], case["row"], case["today"]
    if UNITS[ou][0] != UNITS[nu][0]:
        change = {"status": "not-comparable"}
    else:
        b = op / (oq * UNITS[ou][1])
        a = np_ / (nq * UNITS[nu][1])
        change = {"before": fs(b), "after": fs(a), "change": None if op == 0 else fs((a - b) / b)}
    same = op == np_ and oq == nq and ou == nu
    if same:
        return {"change": change, "changed": False, "price": old["price"],
                "priceDate": old.get("priceDate"), "history": [], "valid": True}
    hist = [] if op == 0 else [{"date": old.get("priceDate") or today, "price": old["price"],
                                "packQty": old["packQty"], "packUnit": ou}]
    return {"change": change, "changed": True, "price": row["price"],
            "priceDate": row.get("priceDate") or today, "history": hist, "valid": True}


def fs(x):
    return None if x is None else f"{x.numerator}/{x.denominator}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=int(os.environ.get("ORACLE_SEED", "20261008")))
    ap.add_argument("--projects", type=int, default=400)
    ap.add_argument("--quick", action="store_true", help="fewer cases (for CI on every push)")
    a = ap.parse_args()
    n_proj = 80 if a.quick else a.projects
    n_parse = 3000 if a.quick else 20000
    rng = random.Random(a.seed)

    parse_cases = [rand_parse(rng) for _ in range(n_parse)]
    conv_cases = []
    for _ in range(n_parse // 4):
        c = {"qty": fs(rand_qty(rng, 0, 10000)), "from": rng.choice(UNIT_IDS), "to": rng.choice(UNIT_IDS)}
        if rng.random() < 0.6:
            c["density"] = fs(F(rng.randint(1, 300), 100))
        if rng.random() < 0.6:
            c["piece"] = fs(rand_qty(rng, 1, 500))
        conv_cases.append(c)
    projects = [rand_project(rng, i) for i in range(n_proj)]
    projects += [boundary_project(rng, i) for i in range(n_proj // 4)]
    price_cases = []
    for _ in range(n_parse // 20):
        old, new = rand_money(rng), rand_money(rng)
        pq_old = F(rng.choice([1, 1, 1, 2, 500]))
        pq_new = pq_old if rng.random() < 0.8 else pq_old + 1
        date = f"2026-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}" if rng.random() < 0.7 else None
        before = {"price": dec_text(old), "packQty": str(pq_old), "packUnit": "kg"}
        if date:
            before["priceDate"] = date
        price_cases.append({"ing": {"id": "a", "name": "a", "packQty": str(pq_new), "packUnit": "kg",
                                    "price": dec_text(new)}, "before": before, "today": "2026-10-08",
                            "_old": old, "_new": new, "_samepack": pq_old == pq_new, "_date": date})

    n_extra = 300 if a.quick else 1500
    project_sales = []
    for P, S in projects:
        project_sales.append({m["id"]: rng.randint(0, 400) for m in S["menu"] if rng.random() < 0.85})
    me_cases = [rand_menu_eng(rng) for _ in range(n_extra)]
    sales_cases = [rand_sales(rng) for _ in range(n_extra)]
    supplier_cases = [rand_supplier(rng) for _ in range(n_extra)]
    payload = {"projectSales": project_sales, "menuEng": [me_payload(x) for x in me_cases],
               "sales": [c for c, _, _ in sales_cases], "supplier": [c for c, _ in supplier_cases],
               "parse": parse_cases, "convert": conv_cases, "projects": [s for _, s in projects],
               "prices": [{k: v for k, v in c.items() if not k.startswith("_")} for c in price_cases]}
    node = os.environ.get("NODE", "node")
    proc = subprocess.run([node, "--import", "tsx", os.path.join("tools", "oracle", "bridge.ts")],
                          input=json.dumps(payload).encode(), capture_output=True, cwd=ROOT)
    if proc.returncode:
        sys.stderr.write(proc.stderr.decode())
        return 2
    got = json.loads(proc.stdout)
    fails: list[str] = []
    counts = {"parse": 0, "convert": 0, "recipes": 0, "recipe errors": 0, "menu": 0, "weights": 0, "prices": 0,
              "menuEngProjects": 0, "menuEng": 0, "salesCsv": 0, "supplier": 0}

    def fail(msg):
        if len(fails) < 40:
            fails.append(msg if len(msg) < 600 else msg[:600] + " …")
        else:
            fails.append("")

    for s, g in zip(parse_cases, got["parse"]):
        want = parse_quantity(s)
        counts["parse"] += 1
        if want[0] != g[0]:
            fail(f"parse {s!r}: oracle {want} ts {g}")
        elif want[0] == "ok" and fs(want[1]) != g[1]:
            fail(f"parse {s!r}: oracle {fs(want[1])} ts {g[1]}")
        elif want[0] == "err" and want[1] != "*" and want[1] != g[1]:
            fail(f"parse {s!r}: oracle error {want[1]} ts {g[1]}")

    for c, g in zip(conv_cases, got["convert"]):
        counts["convert"] += 1
        fdim, ff = UNITS[c["from"]]
        tdim, tf = UNITS[c["to"]]
        b = to_base(F(c["qty"]), c["from"], tdim, {}, F(c["density"]) if "density" in c else None,
                    F(c["piece"]) if "piece" in c else None)
        want = None if b is None else b / tf
        if (want is None) != (g[0] == "err") or (want is not None and fs(want) != g[1]):
            fail(f"convert {c}: oracle {fs(want)} ts {g}")

    for i, ((P, S), g) in enumerate(zip(projects, got["projects"])):
        if "invalid" in g:
            fail(f"project {i} rejected by TS: {g['invalid']}")
            continue
        er, em = cost_project(P)
        for rid, exp in er.items():
            t = g["recipes"][rid]
            if t["status"] == "mismatch":
                fail(f"project {i} {rid}: engine/checker mismatch in TS")
                continue
            res = exp["res"]
            if res is None:
                counts["recipe errors"] += 1
                if t["status"] != "error":
                    fail(f"project {i} {rid}: oracle says not costable, ts {t['status']}")
            else:
                counts["recipes"] += 1
                if t["status"] != "ok":
                    fail(f"project {i} {rid}: oracle costs it, ts {t['status']}")
                    continue
                for k in ("total", "perYieldUnit"):
                    if fs(res[k]) != t[k]:
                        fail(f"project {i} {rid} {k}: oracle {fs(res[k])} ts {t[k]}")
                if [fs(x) for x in res["lines"]] != t["lines"]:
                    fail(f"project {i} {rid} lines differ")
                ex = res["extras"]
                if (ex is None) != (t["extras"] is None):
                    fail(f"project {i} {rid} extras presence: oracle {ex is not None}")
                elif ex:
                    for k in ex:
                        if fs(ex[k]) != t["extras"][k]:
                            fail(f"project {i} {rid} {k}: oracle {fs(ex[k])} ts {t['extras'][k]}")
            w, tw = exp["weight"], t["weight"]
            counts["weights"] += 1
            if "missing" in w:
                if tw.get("missing") != w["missing"]:
                    fail(f"project {i} {rid} weight missing: oracle {w['missing']} ts {tw}")
            elif tw.get("grams") != fs(w["grams"]) or tw.get("perPortion") != fs(w["perPortion"]):
                fail(f"project {i} {rid} weight: oracle {fs(w['grams'])} ts {tw}")
        for mid, exp in em.items():
            t = g["menu"][mid]
            counts["menu"] += 1
            if exp is None:
                if t["status"] == "ok":
                    fail(f"project {i} {mid}: oracle cannot price it, ts ok")
                continue
            if t["status"] != "ok":
                fail(f"project {i} {mid}: oracle prices it, ts {t['status']}")
                continue
            for k, v in exp.items():
                want = v if k == "band" else fs(v)
                if want != t[k]:
                    fail(f"project {i} {mid} {k}: oracle {want} ts {t[k]}")
        sold = project_sales[i]
        items = [(m["id"], sold.get(m["id"], 0),
                  None if em[m["id"]] is None else "noprice" if em[m["id"]]["grossProfit"] is None
                  else em[m["id"]]["grossProfit"]) for m in S["menu"]]
        want = menu_eng(items)
        counts["menuEngProjects"] += 1
        if g.get("menuEng") != want:
            fail(f"project {i} menu engineering: oracle {want} ts {g.get('menuEng')}")

    for c, g in zip(price_cases, got["prices"]):
        counts["prices"] += 1
        changed = c["_old"] != c["_new"] or not c["_samepack"]
        if "invalid" in g:
            fail(f"price case rejected: {g}")
            continue
        if not changed:
            if g["history"] or g["change"] is not None:
                fail(f"price unchanged but recorded: {c}")
            continue
        h = g["history"]
        if len(h) != 1 or h[0]["price"] != dec_text(c["_old"]) or h[0]["date"] != (c["_date"] or "2026-10-08"):
            fail(f"price history wrong: {c} → {h}")
        if g["priceDate"] != "2026-10-08":
            fail(f"new price date wrong: {g}")
        if not c["_samepack"]:
            want = {"status": "pack-changed"}
        elif c["_old"] == 0:
            want = {"change": None}
        else:
            want = {"change": fs((c["_new"] - c["_old"]) / c["_old"])}
        if g["change"] != want:
            fail(f"price change: oracle {want} ts {g['change']} for {c['_old']}→{c['_new']}")

    for items, g in zip(me_cases, got["menuEng"]):
        counts["menuEng"] += 1
        want = menu_eng(items)
        if g != want:
            fail(f"menu engineering {items}: oracle {want} ts {g}")

    for (case, rows, header), g in zip(sales_cases, got["sales"]):
        counts["salesCsv"] += 1
        if rows is None:
            if not g["problems"] or g["problems"][0][0] != 0 or g["sold"]:
                fail(f"sales header {header}: ts accepted it: {g}")
            continue
        want = sales_expected(rows, case["menu"])
        if g != want:
            fail(f"sales csv {case['text']!r}: oracle {want} ts {g}")

    for (case, nums), g in zip(supplier_cases, got["supplier"]):
        counts["supplier"] += 1
        want = supplier_expected(case, nums)
        if g != want:
            fail(f"supplier {case}: oracle {want} ts {g}")

    total_fails = len(fails)
    print(f"saucepenny oracle seed={a.seed}: " + ", ".join(f"{k} {v}" for k, v in counts.items()))
    if fails:
        print(f"FAILED: {total_fails} differences")
        for f in fails[:40]:
            if f:
                print("  " + f)
        return 1
    print("OK: every number matches the independent Python oracle exactly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
