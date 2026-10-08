// SPDX-License-Identifier: AGPL-3.0-or-later
// Oracle for the sub-recipe graph: Tarjan-based analysis vs. brute-force reachability
// (Warshall closure) on every directed graph with up to 4 nodes (self-loops included),
// and on random graphs with 5–6 nodes.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { analyse, type RecipeGraph } from '../../packages/core/src/graph/index';

function graphFromMask(n: number, mask: number): RecipeGraph {
  const edges = new Map<string, string[]>();
  for (let i = 0; i < n; i++) {
    const out: string[] = [];
    for (let j = 0; j < n; j++) if (mask & (1 << (i * n + j))) out.push(`n${j}`);
    edges.set(`n${i}`, out);
  }
  return { edges };
}

function oracle(g: RecipeGraph) {
  const ids = [...g.edges.keys()];
  const reach = new Map(ids.map((a) => [a, new Set(g.edges.get(a))]));
  for (const k of ids)
    for (const i of ids)
      if (reach.get(i)!.has(k)) for (const j of reach.get(k)!) reach.get(i)!.add(j);
  const cyclic = new Set(ids.filter((v) => reach.get(v)!.has(v)));
  const blocked = new Set(
    ids.filter((v) => !cyclic.has(v) && [...reach.get(v)!].some((w) => cyclic.has(w))),
  );
  const depth = new Map<string, number>();
  const longest = (v: string): number => Math.max(0, ...g.edges.get(v)!.map((w) => longest(w) + 1));
  for (const v of ids) if (!cyclic.has(v) && !blocked.has(v)) depth.set(v, longest(v));
  return { cyclic, blocked, depth };
}

function agree(g: RecipeGraph): void {
  const a = analyse(g);
  const o = oracle(g);
  expect(new Set(a.cyclic.keys())).toEqual(o.cyclic);
  expect(a.blockedByCycle).toEqual(o.blocked);
  expect(a.depth).toEqual(o.depth);
  // Every reported cycle is a real closed walk starting and ending at the recipe.
  for (const [v, path] of a.cyclic) {
    expect(path[0]).toBe(v);
    expect(path[path.length - 1]).toBe(v);
    for (let i = 0; i + 1 < path.length; i++) expect(g.edges.get(path[i]!)).toContain(path[i + 1]);
  }
  // Dependency order lists sub-recipes before the recipes that use them.
  const pos = new Map(a.order.map((v, i) => [v, i]));
  for (const v of a.order)
    for (const w of g.edges.get(v)!) expect(pos.get(w)!).toBeLessThan(pos.get(v)!);
}

describe('cycle detection oracle', () => {
  for (const n of [1, 2, 3, 4])
    it(`agrees on all ${2 ** (n * n)} directed graphs with ${n} node(s)`, () => {
      for (let mask = 0; mask < 2 ** (n * n); mask++) agree(graphFromMask(n, mask));
    });
  it('agrees on 3,000 random graphs with 5–6 nodes', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 5, max: 6 })
          .chain((n) =>
            fc.tuple(fc.constant(n), fc.bigInt({ min: 0n, max: 2n ** BigInt(n * n) - 1n })),
          ),
        ([n, mask]) => {
          const edges = new Map<string, string[]>();
          for (let i = 0; i < n; i++) {
            const out: string[] = [];
            for (let j = 0; j < n; j++) if ((mask >> BigInt(i * n + j)) & 1n) out.push(`n${j}`);
            edges.set(`n${i}`, out);
          }
          agree({ edges });
        },
      ),
      { numRuns: 3000 },
    );
  });
  it('handles a 5,000-long chain without overflowing the stack', () => {
    const edges = new Map<string, string[]>();
    for (let i = 0; i < 5000; i++) edges.set(`n${i}`, i + 1 < 5000 ? [`n${i + 1}`] : ['n0']);
    expect(analyse({ edges }).cyclic.size).toBe(5000);
  });
});
