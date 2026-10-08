// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bridge for the independent Python oracle (tools/oracle/oracle.py): reads cases as JSON
// on stdin, runs them through the real TypeScript code and prints the results as JSON.
// Every exact number is written as "n/d". Nothing here computes anything itself.
//   node --import tsx tools/oracle/bridge.ts < cases.json > results.json

import {
  convert,
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
} from '../../packages/core/src/index';

const q = (r: Rational | null | undefined) => (r ? `${r.n}/${r.d}` : null);

interface Cases {
  parse: string[];
  convert: { qty: string; from: UnitId; to: UnitId; density?: string; piece?: string }[];
  projects: unknown[];
  prices: { ing: StoredIngredient; before: PriceSnapshot; today: string }[];
}

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
  projects: cases.projects.map((p) => {
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
    return { recipes, menu };
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
};
process.stdout.write(JSON.stringify(out));
