// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bridge for the independent Python oracle (tools/oracle/oracle.py): reads cases as JSON
// on stdin, runs them through the real TypeScript code and prints the results as JSON.
// Every exact number is written as "n/d". Nothing here computes anything itself.
//   node --import tsx tools/oracle/bridge.ts < cases.json > results.json

import {
  applySupplierPrices,
  convert,
  importSalesCsv,
  parseQuantity,
  recordPriceChange,
  validateProject,
  verifiedPriceChange,
  verifiedProject,
  verifiedWeight,
  type PriceSnapshot,
  type Rational,
  type StoredIngredient,
  type UnitId,
  type UnitRef,
  type VerifiedProject,
  unitPriceChange,
  verifiedMenuEngineering,
} from '../../packages/core/src/index';

const q = (r: Rational | null | undefined) => (r ? `${r.n}/${r.d}` : null);

interface Cases {
  parse: string[];
  convert: { qty: string; from: UnitId; to: UnitId; density?: string; piece?: string }[];
  projects: unknown[];
  prices: { ing: StoredIngredient; before: PriceSnapshot; today: string }[];
  /** sales counts per project (same order as projects), for menu engineering */
  projectSales?: Record<string, number>[];
  /** margin "n/d"; null = not costed; "noprice" = costed but no price */
  menuEng?: { id: string; sold: number; margin: string | null }[][];
  sales?: { text: string; menu: { id: string; name: string }[] }[];
  supplier?: {
    old: StoredIngredient;
    row: { price: string; packQty: string; packUnit: UnitRef; priceDate?: string };
    today: string;
  }[];
}

const engOut = (r: ReturnType<typeof verifiedMenuEngineering>) =>
  r.status === 'ok'
    ? {
        status: 'ok',
        average: q(r.averageMargin),
        line: q(r.popularLine),
        totalMargin: q(r.totalMargin),
        totalSold: r.totalSold,
        rows: r.rows.map((x) => [x.id, x.quadrant, q(x.mix)]),
        excluded: r.excluded,
      }
    : r.status === 'empty'
      ? { status: 'empty', reason: r.reason, excluded: r.excluded }
      : { status: 'mismatch', detail: r.detail };

const oneIngredient = (ing: StoredIngredient) => ({
  schema: 'saucepenny/project',
  version: 2,
  name: 'x',
  settings: { currency: 'HKD', serviceChargePercent: '10', goodPercent: '30', highPercent: '35' },
  measures: [],
  ingredients: [ing],
  recipes: [],
  menu: [],
});

const frac = (s: string): Rational => {
  const [n, d = '1'] = s.split('/');
  return { n: BigInt(n!), d: BigInt(d) };
};

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (text += c));
    process.stdin.on('end', () => resolve(text));
  });
}

const cases = JSON.parse(await readStdin()) as Cases;
const out = {
  parse: cases.parse.map((s) => {
    const r = parseQuantity(s);
    return r.ok ? ['ok', q(r.value)] : ['err', r.error];
  }),
  convert: cases.convert.map((c) => {
    const info = {
      ...(c.density ? { densityGPerMl: frac(c.density) } : {}),
      ...(c.piece ? { pieceWeightG: frac(c.piece) } : {}),
    };
    const r = convert(frac(c.qty), c.from, c.to, info);
    return r.ok ? ['ok', q(r.value)] : ['err', r.error.code];
  }),
  projects: cases.projects.map((p, k) => {
    const v = validateProject(p);
    if (!v.ok) return { invalid: v.errors.slice(0, 5) };
    const proj = v.value.project;
    const all = verifiedProject(proj);
    const recipes: Record<string, unknown> = {};
    for (const [id, r] of all.recipes) {
      const w = verifiedWeight(proj, id);
      recipes[id] = {
        status: r.status,
        ...(r.status === 'ok'
          ? {
              total: q(r.total),
              perYieldUnit: q(r.perYieldUnit),
              lines: r.lines.map(q),
              extras: r.extras && {
                labour: q(r.extras.labour),
                overhead: q(r.extras.overhead),
                full: q(r.extras.full),
                fullPerYieldUnit: q(r.extras.fullPerYieldUnit),
              },
            }
          : {}),
        weight:
          w.status === 'ok'
            ? { grams: q(w.grams), perPortion: q(w.perPortion) }
            : w.status === 'missing'
              ? { missing: w.lines }
              : { mismatch: w.detail },
      };
    }
    const menu: Record<string, unknown> = {};
    for (const [id, m] of all.menu)
      menu[id] =
        m.status === 'ok'
          ? {
              status: 'ok',
              portionCost: q(m.portionCost),
              netPrice: q(m.netPrice),
              foodCost: q(m.foodCost),
              grossProfit: q(m.grossProfit),
              band: m.band,
              suggestedPrice: q(m.suggestedPrice),
              suggestedFoodCost: q(m.suggestedFoodCost),
            }
          : { status: m.status };
    const sold = cases.projectSales?.[k];
    return {
      recipes,
      menu,
      ...(sold
        ? { menuEng: engOut(verifiedMenuEngineering(all, new Map(Object.entries(sold)))) }
        : {}),
    };
  }),
  prices: cases.prices.map((c) => {
    const next = recordPriceChange(c.ing, c.before, c.today);
    const v = validateProject({
      schema: 'saucepenny/project',
      version: 2,
      name: 'x',
      settings: {
        currency: 'HKD',
        serviceChargePercent: '10',
        goodPercent: '30',
        highPercent: '35',
      },
      measures: [],
      ingredients: [next],
      recipes: [],
      menu: [],
    });
    if (!v.ok) return { invalid: v.errors.slice(0, 3) };
    const ch = verifiedPriceChange(v.value.project.ingredients.get(next.id)!);
    return {
      history: next.priceHistory ?? [],
      priceDate: next.priceDate ?? null,
      change:
        ch === null ? null : ch.status === 'ok' ? { change: q(ch.change) } : { status: ch.status },
    };
  }),
  menuEng: (cases.menuEng ?? []).map((items) => {
    const menu = new Map(
      items.map((x) => [
        x.id,
        x.margin === null
          ? { status: 'error' }
          : { status: 'ok', grossProfit: x.margin === 'noprice' ? null : frac(x.margin) },
      ]),
    );
    const sold = new Map(items.map((x) => [x.id, x.sold]));
    return engOut(
      verifiedMenuEngineering({ recipes: new Map(), menu } as unknown as VerifiedProject, sold),
    );
  }),
  sales: (cases.sales ?? []).map((c) => {
    const r = importSalesCsv(c.text, c.menu);
    return {
      sold: Object.fromEntries(r.sold),
      merged: [...r.merged].sort(),
      problems: r.problems.map((p) =>
        p.kind === 'row' ? [p.line, p.code] : p.kind === 'header' ? [0, p.column] : [-1, 'csv'],
      ),
    };
  }),
  supplier: (cases.supplier ?? []).map((c) => {
    const v = validateProject(oneIngredient(c.old));
    if (!v.ok) return { invalid: v.errors.slice(0, 3) };
    const ch = unitPriceChange(v.value.project.ingredients.get(c.old.id)!, c.row, new Map());
    const applied = applySupplierPrices(
      oneIngredient(c.old) as unknown as Parameters<typeof applySupplierPrices>[0],
      [{ ingredientId: c.old.id, row: c.row }],
      c.today,
    );
    if (!applied.ok) return { error: applied.code };
    const after = applied.project.ingredients[0]!;
    const valid = validateProject(applied.project).ok;
    return {
      change:
        ch.status === 'ok'
          ? { before: q(ch.before), after: q(ch.after), change: q(ch.change) }
          : { status: ch.status },
      changed: applied.changed.length === 1,
      price: after.price,
      priceDate: after.priceDate ?? null,
      history: after.priceHistory ?? [],
      valid,
    };
  }),
};
process.stdout.write(JSON.stringify(out));
