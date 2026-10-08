// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Sub-recipe graph: Tarjan's strongly connected components find every recipe that is part
// of a cycle (including a recipe that uses itself), with one concrete cycle path for the
// error message; recipes that merely *use* a cyclic recipe are reported separately.
// Nesting depth is computed on the acyclic part.

export interface RecipeGraph {
  /** recipe id → ids of sub-recipes it uses (deduplicated, in first-use order) */
  readonly edges: ReadonlyMap<string, readonly string[]>;
}

export function buildGraph(
  recipes: Iterable<{ id: string; lines: readonly { ref: { kind: string; id: string } }[] }>,
): RecipeGraph {
  const edges = new Map<string, string[]>();
  for (const r of recipes) {
    const out: string[] = [];
    for (const l of r.lines)
      if (l.ref.kind === 'recipe' && !out.includes(l.ref.id)) out.push(l.ref.id);
    edges.set(r.id, out);
  }
  return { edges };
}

/** Tarjan's algorithm (iterative, so deep graphs cannot overflow the stack). */
export function stronglyConnected(g: RecipeGraph): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  for (const start of g.edges.keys()) {
    if (idx.has(start)) continue;
    const work: [string, number][] = [[start, 0]];
    while (work.length) {
      const frame = work[work.length - 1]!;
      const [v, i] = frame;
      if (i === 0) {
        idx.set(v, index);
        low.set(v, index);
        index++;
        stack.push(v);
        onStack.add(v);
      }
      const succ = g.edges.get(v) ?? [];
      if (i < succ.length) {
        frame[1] = i + 1;
        const w = succ[i]!;
        if (!g.edges.has(w)) continue;
        if (!idx.has(w)) work.push([w, 0]);
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1]![0];
        low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
      }
      if (low.get(v) === idx.get(v)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
        } while (w !== v);
        out.push(comp);
      }
    }
  }
  return out;
}

/** One concrete cycle through `start` inside its component: [start, …, start]. */
function cyclePath(g: RecipeGraph, start: string, comp: ReadonlySet<string>): string[] {
  const prev = new Map<string, string>();
  const queue = [start];
  const seen = new Set<string>([start]);
  while (queue.length) {
    const v = queue.shift()!;
    for (const w of g.edges.get(v) ?? []) {
      if (!comp.has(w)) continue;
      if (w === start) {
        const path = [start];
        for (let x = v; x !== start; x = prev.get(x)!) path.splice(1, 0, x);
        path.push(start);
        return path;
      }
      if (!seen.has(w)) {
        seen.add(w);
        prev.set(w, v);
        queue.push(w);
      }
    }
  }
  return [start, start];
}

export interface GraphAnalysis {
  /** recipe id → a cycle it is part of ([a, b, a]) */
  cyclic: Map<string, string[]>;
  /** recipe id → nesting depth (0 = uses no sub-recipe); only for recipes not on/above a cycle */
  depth: Map<string, number>;
  /** recipes that use (directly or not) a cyclic recipe, without being on a cycle */
  blockedByCycle: Set<string>;
  /** acyclic recipes in dependency order (sub-recipes first) */
  order: string[];
}

export function analyse(g: RecipeGraph): GraphAnalysis {
  const cyclic = new Map<string, string[]>();
  const comps = stronglyConnected(g); // reverse topological order: sinks first
  for (const comp of comps) {
    const v = comp[0]!;
    const selfLoop = (g.edges.get(v) ?? []).includes(v);
    if (comp.length > 1 || selfLoop) {
      const set = new Set(comp);
      for (const x of comp) cyclic.set(x, cyclePath(g, x, set));
    }
  }
  const depth = new Map<string, number>();
  const blockedByCycle = new Set<string>();
  const order: string[] = [];
  for (const comp of comps) {
    if (comp.length > 1 || cyclic.has(comp[0]!)) continue;
    const v = comp[0]!;
    let d = 0;
    let blocked = false;
    for (const w of g.edges.get(v) ?? []) {
      if (!g.edges.has(w)) continue;
      if (cyclic.has(w) || blockedByCycle.has(w)) blocked = true;
      else d = Math.max(d, depth.get(w)! + 1);
    }
    if (blocked) blockedByCycle.add(v);
    else {
      depth.set(v, d);
      order.push(v);
    }
  }
  return { cyclic, depth, blockedByCycle, order };
}
