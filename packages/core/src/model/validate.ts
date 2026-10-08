// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Strict validation of a stored project (untrusted input) into the exact compiled model.
// Every problem is collected (not only the first) with a path, so the UI can point at the
// field. Nothing invalid is ever silently replaced by zero.

import {
  div,
  gt,
  lt,
  parseDecimal,
  PRICE_ROUNDINGS,
  rat,
  sign,
  type PriceRounding,
  type Rational,
} from '../num/index';
import { isUnitId } from '../units/index';
import type { ErrorCode, ProjectError, Result } from './errors';
import { LIMITS } from './limits';
import { migrate } from './migrate';
import type {
  Ingredient,
  Line,
  LineRef,
  Measure,
  MenuItem,
  Project,
  Recipe,
  StoredIngredient,
  StoredLine,
  StoredMeasure,
  StoredMenuItem,
  StoredProject,
  StoredRecipe,
  StoredSettings,
  UnitRef,
} from './types';
import { PROJECT_SCHEMA, PROJECT_VERSION } from './types';

const ID_RE = /^[A-Za-z0-9_-]+$/;
const HUNDRED = rat(100n);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

class Collector {
  errors: ProjectError[] = [];
  add(code: ErrorCode, path: string, params?: Record<string, string | number>): undefined {
    this.errors.push(params ? { code, path, params } : { code, path });
    return undefined;
  }

  text(o: Obj, key: string, path: string, max: number, required: boolean): string | undefined {
    const v = o[key];
    const p = `${path}.${key}`;
    if (v === undefined) return required ? this.add('required', p) : undefined;
    if (typeof v !== 'string') return this.add('type', p, { expected: 'text' });
    if (required && v.trim() === '') return this.add('empty', p);
    if ([...v].length > max) return this.add('too-long', p, { max });
    return v;
  }

  id(o: Obj, key: string, path: string): string | undefined {
    const v = this.text(o, key, path, LIMITS.idLength, true);
    if (v === undefined) return undefined;
    if (!ID_RE.test(v)) return this.add('bad-id', `${path}.${key}`);
    return v;
  }

  /** A decimal number stored as text (safe integers are accepted for convenience). */
  decimal(o: Obj, key: string, path: string, required = true): Rational | undefined {
    const v = o[key];
    const p = `${path}.${key}`;
    if (v === undefined) return required ? this.add('required', p) : undefined;
    let text: string;
    if (typeof v === 'string') text = v;
    else if (typeof v === 'number' && Number.isSafeInteger(v)) text = String(v);
    else return this.add('type', p, { expected: 'decimal text' });
    const r = parseDecimal(text);
    if (!r.ok) return this.add(r.error, p);
    return r.value;
  }

  positive(o: Obj, key: string, path: string, required = true): Rational | undefined {
    const r = this.decimal(o, key, path, required);
    if (r !== undefined && sign(r) <= 0) return this.add('must-be-positive', `${path}.${key}`);
    return r;
  }

  nonNegative(o: Obj, key: string, path: string): Rational | undefined {
    const r = this.decimal(o, key, path);
    if (r !== undefined && sign(r) < 0) return this.add('must-not-be-negative', `${path}.${key}`);
    return r;
  }

  array(o: Obj, key: string, path: string, max: number): unknown[] {
    const v = o[key];
    const p = path ? `${path}.${key}` : key;
    if (!Array.isArray(v)) {
      this.add('type', p, { expected: 'list' });
      return [];
    }
    if (v.length > max) {
      this.add('too-many', p, { max });
      return [];
    }
    return v;
  }
}

function checkUnitRef(
  c: Collector,
  v: unknown,
  path: string,
  measures: ReadonlySet<string>,
): UnitRef | undefined {
  if (typeof v !== 'string') return c.add('bad-unit', path);
  if (v === 'portion' || isUnitId(v)) return v;
  if (v.startsWith('measure:')) {
    if (measures.has(v.slice(8))) return v as UnitRef;
    return c.add('unknown-measure', path);
  }
  return c.add('bad-unit', path);
}

function isValidDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]!;
  return d <= days;
}

export interface Validated {
  /** The stored form after migration (safe to save back). */
  stored: StoredProject;
  project: Project;
  migrated: boolean;
}

export function validateProject(input: unknown): Result<Validated> {
  const mig = migrate(input);
  if (!mig.ok) return mig;
  const root = mig.value;
  const c = new Collector();

  const name = c.text(root, 'name', '', LIMITS.nameLength, true) ?? '';

  // ---- settings
  let settings: Project['settings'] = {
    currency: 'HKD',
    serviceCharge: rat(1n, 10n),
    good: rat(3n, 10n),
    high: rat(35n, 100n),
  };
  if (!isObj(root.settings)) c.add('type', 'settings', { expected: 'object' });
  else {
    const s = root.settings;
    const currency = c.text(s, 'currency', 'settings', 3, true);
    if (currency !== undefined && !/^[A-Z]{3}$/.test(currency))
      c.add('bad-currency', 'settings.currency');
    const sc = c.nonNegative(s, 'serviceChargePercent', 'settings');
    if (sc !== undefined && gt(sc, HUNDRED))
      c.add('percent-out-of-range', 'settings.serviceChargePercent');
    const good = c.positive(s, 'goodPercent', 'settings');
    const high = c.positive(s, 'highPercent', 'settings');
    if (good && gt(good, HUNDRED)) c.add('percent-out-of-range', 'settings.goodPercent');
    if (high && gt(high, HUNDRED)) c.add('percent-out-of-range', 'settings.highPercent');
    if (good && high && gt(good, high)) c.add('band-order', 'settings.highPercent');
    if (currency && sc && good && high)
      settings = {
        currency,
        serviceCharge: div(sc, HUNDRED),
        good: div(good, HUNDRED),
        high: div(high, HUNDRED),
      };
  }

  // ---- ids (first pass, so references can be checked in any order)
  const seen = new Set<string>();
  const collectIds = (key: string, max: number): Set<string> => {
    const ids = new Set<string>();
    c.array(root, key, '', max).forEach((item, i) => {
      if (!isObj(item)) return;
      const id = item.id;
      if (typeof id === 'string' && ID_RE.test(id)) {
        const scoped = `${key}:${id}`;
        if (seen.has(scoped)) c.add('duplicate-id', `${key}[${i}].id`, { id });
        seen.add(scoped);
        ids.add(id);
      }
    });
    return ids;
  };
  const measureIds = collectIds('measures', LIMITS.measures);
  const ingredientIds = collectIds('ingredients', LIMITS.ingredients);
  const recipeIds = collectIds('recipes', LIMITS.recipes);
  collectIds('menu', LIMITS.menuItems);

  // ---- measures
  const measures = new Map<string, Measure>();
  const storedMeasures: StoredMeasure[] = [];
  c.array(root, 'measures', '', LIMITS.measures).forEach((m, i) => {
    const p = `measures[${i}]`;
    if (!isObj(m)) return c.add('type', p, { expected: 'object' });
    const id = c.id(m, 'id', p);
    const nm = c.text(m, 'name', p, LIMITS.nameLength, true);
    const amount = c.positive(m, 'amount', p);
    const unit = isUnitId(m.unit) ? m.unit : c.add('bad-unit', `${p}.unit`);
    if (id && nm !== undefined && amount && unit && !measures.has(id)) {
      measures.set(id, { id, name: nm, amount, unit });
      storedMeasures.push({ id, name: nm, amount: String(m.amount), unit });
    }
  });

  // ---- ingredients
  const ingredients = new Map<string, Ingredient>();
  const storedIngredients: StoredIngredient[] = [];
  c.array(root, 'ingredients', '', LIMITS.ingredients).forEach((g, i) => {
    const p = `ingredients[${i}]`;
    if (!isObj(g)) return c.add('type', p, { expected: 'object' });
    const id = c.id(g, 'id', p);
    const nm = c.text(g, 'name', p, LIMITS.nameLength, true);
    const packQty = c.positive(g, 'packQty', p);
    const packUnit = checkUnitRef(c, g.packUnit, `${p}.packUnit`, measureIds);
    if (packUnit === 'portion') c.add('bad-unit', `${p}.packUnit`);
    const price = c.nonNegative(g, 'price', p);
    let yieldFrac: Rational | undefined = rat(1n);
    if (g.yieldPercent !== undefined) {
      const y = c.decimal(g, 'yieldPercent', p);
      if (y !== undefined && (sign(y) <= 0 || gt(y, HUNDRED))) {
        c.add('yield-out-of-range', `${p}.yieldPercent`);
        yieldFrac = undefined;
      } else yieldFrac = y === undefined ? undefined : div(y, HUNDRED);
    }
    const density = c.positive(g, 'density', p, false);
    const pieceWeight = c.positive(g, 'pieceWeight', p, false);
    const priceDate = c.text(g, 'priceDate', p, 10, false);
    if (priceDate !== undefined && priceDate !== '' && !isValidDate(priceDate))
      c.add('bad-date', `${p}.priceDate`);
    const note = c.text(g, 'note', p, LIMITS.noteLength, false) ?? '';
    if (
      id &&
      nm !== undefined &&
      packQty &&
      packUnit &&
      packUnit !== 'portion' &&
      price &&
      yieldFrac
    ) {
      if (ingredients.has(id)) return;
      ingredients.set(id, {
        id,
        name: nm,
        packQty,
        packUnit,
        price,
        yield: yieldFrac,
        density,
        pieceWeight,
        priceDate: priceDate || undefined,
        note,
      });
      const s: StoredIngredient = {
        id,
        name: nm,
        packQty: String(g.packQty),
        packUnit,
        price: String(g.price),
      };
      if (g.yieldPercent !== undefined) s.yieldPercent = String(g.yieldPercent);
      if (g.density !== undefined) s.density = String(g.density);
      if (g.pieceWeight !== undefined) s.pieceWeight = String(g.pieceWeight);
      if (priceDate) s.priceDate = priceDate;
      if (note) s.note = note;
      storedIngredients.push(s);
    }
  });

  // ---- recipes
  const recipes = new Map<string, Recipe>();
  const storedRecipes: StoredRecipe[] = [];
  c.array(root, 'recipes', '', LIMITS.recipes).forEach((r, i) => {
    const p = `recipes[${i}]`;
    if (!isObj(r)) return c.add('type', p, { expected: 'object' });
    const id = c.id(r, 'id', p);
    const nm = c.text(r, 'name', p, LIMITS.nameLength, true);
    const yieldQty = c.decimal(r, 'yieldQty', p);
    if (yieldQty !== undefined && sign(yieldQty) === 0) c.add('zero-yield', `${p}.yieldQty`);
    else if (yieldQty !== undefined && sign(yieldQty) < 0)
      c.add('must-be-positive', `${p}.yieldQty`);
    const yieldUnit = checkUnitRef(c, r.yieldUnit, `${p}.yieldUnit`, measureIds);
    const density = c.positive(r, 'density', p, false);
    const note = c.text(r, 'note', p, LIMITS.noteLength, false) ?? '';
    const lines: Line[] = [];
    const storedLines: StoredLine[] = [];
    let linesOk = true;
    c.array(r, 'lines', p, LIMITS.linesPerRecipe).forEach((l, j) => {
      const lp = `${p}.lines[${j}]`;
      if (!isObj(l)) {
        linesOk = false;
        return c.add('type', lp, { expected: 'object' });
      }
      let ref: LineRef | undefined;
      const rr = l.ref;
      if (
        !isObj(rr) ||
        (rr.kind !== 'ingredient' && rr.kind !== 'recipe') ||
        typeof rr.id !== 'string'
      )
        c.add('type', `${lp}.ref`, { expected: 'reference' });
      else if (rr.kind === 'ingredient' && !ingredientIds.has(rr.id))
        c.add('unknown-ingredient', `${lp}.ref`, { id: rr.id });
      else if (rr.kind === 'recipe' && !recipeIds.has(rr.id))
        c.add('unknown-recipe', `${lp}.ref`, { id: rr.id });
      else ref = { kind: rr.kind, id: rr.id };
      const qty = c.nonNegative(l, 'qty', lp);
      const unit = checkUnitRef(c, l.unit, `${lp}.unit`, measureIds);
      let waste: Rational | undefined = rat(0n);
      if (l.wastePercent !== undefined) {
        const w = c.decimal(l, 'wastePercent', lp);
        if (w !== undefined && (sign(w) < 0 || !lt(w, HUNDRED))) {
          c.add('waste-out-of-range', `${lp}.wastePercent`);
          waste = undefined;
        } else waste = w === undefined ? undefined : div(w, HUNDRED);
      }
      if (ref && qty && unit && waste) {
        lines.push({ ref, qty, unit, waste });
        const sl: StoredLine = { ref, qty: String(l.qty), unit };
        if (l.wastePercent !== undefined) sl.wastePercent = String(l.wastePercent);
        storedLines.push(sl);
      } else linesOk = false;
    });
    if (id && nm !== undefined && yieldQty && sign(yieldQty) > 0 && yieldUnit && linesOk) {
      if (recipes.has(id)) return;
      recipes.set(id, { id, name: nm, yieldQty, yieldUnit, density, lines, note });
      const s: StoredRecipe = {
        id,
        name: nm,
        yieldQty: String(r.yieldQty),
        yieldUnit,
        lines: storedLines,
      };
      if (r.density !== undefined) s.density = String(r.density);
      if (note) s.note = note;
      storedRecipes.push(s);
    }
  });

  // ---- menu
  const menu = new Map<string, MenuItem>();
  const storedMenu: StoredMenuItem[] = [];
  c.array(root, 'menu', '', LIMITS.menuItems).forEach((m, i) => {
    const p = `menu[${i}]`;
    if (!isObj(m)) return c.add('type', p, { expected: 'object' });
    const id = c.id(m, 'id', p);
    const nm = c.text(m, 'name', p, LIMITS.nameLength, true);
    let recipeId: string | undefined;
    if (typeof m.recipeId !== 'string') c.add('required', `${p}.recipeId`);
    else if (!recipeIds.has(m.recipeId))
      c.add('unknown-recipe', `${p}.recipeId`, { id: m.recipeId });
    else recipeId = m.recipeId;
    const portionQty = c.positive(m, 'portionQty', p);
    const portionUnit = checkUnitRef(c, m.portionUnit, `${p}.portionUnit`, measureIds);
    const price = c.nonNegative(m, 'price', p);
    const inc = m.priceIncludesService;
    if (typeof inc !== 'boolean')
      c.add('type', `${p}.priceIncludesService`, { expected: 'boolean' });
    const t = c.decimal(m, 'targetPercent', p);
    let target: Rational | undefined;
    if (t !== undefined) {
      if (sign(t) <= 0 || gt(t, HUNDRED)) c.add('target-out-of-range', `${p}.targetPercent`);
      else target = div(t, HUNDRED);
    }
    const rounding = (PRICE_ROUNDINGS as readonly unknown[]).includes(m.rounding)
      ? (m.rounding as PriceRounding)
      : c.add('bad-rounding', `${p}.rounding`);
    if (
      id &&
      nm !== undefined &&
      recipeId &&
      portionQty &&
      portionUnit &&
      price &&
      typeof inc === 'boolean' &&
      target &&
      rounding
    ) {
      if (menu.has(id)) return;
      menu.set(id, {
        id,
        name: nm,
        recipeId,
        portionQty,
        portionUnit,
        price,
        priceIncludesService: inc,
        target,
        rounding,
      });
      storedMenu.push({
        id,
        name: nm,
        recipeId,
        portionQty: String(m.portionQty),
        portionUnit,
        price: String(m.price),
        priceIncludesService: inc,
        targetPercent: String(m.targetPercent),
        rounding,
      });
    }
  });

  if (c.errors.length) return { ok: false, errors: c.errors };
  const s = root.settings as Obj;
  const storedSettings: StoredSettings = {
    currency: settings.currency,
    serviceChargePercent: String(s.serviceChargePercent),
    goodPercent: String(s.goodPercent),
    highPercent: String(s.highPercent),
  };
  return {
    ok: true,
    value: {
      migrated: mig.migrated,
      stored: {
        schema: PROJECT_SCHEMA,
        version: PROJECT_VERSION,
        name,
        settings: storedSettings,
        measures: storedMeasures,
        ingredients: storedIngredients,
        recipes: storedRecipes,
        menu: storedMenu,
      },
      project: { name, settings, measures, ingredients, recipes, menu },
    },
  };
}
