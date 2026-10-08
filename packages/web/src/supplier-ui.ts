// SPDX-License-Identifier: AGPL-3.0-or-later
// "Update prices from a supplier list" on the Price change tab (v0.3). A supplier CSV is
// matched to the user's ingredients; nothing changes until they review the list and press
// Apply. Old prices go into each ingredient's price history. The matches are remembered on
// this device only.

import type { Lang, Project, StoredProject } from '@saucepenny/core';
import {
  applySupplierPrices,
  describeError,
  describeImportProblem,
  formatPercent,
  nameKey,
  readSupplierCsv,
  unitPriceChange,
  validateProject,
  type SupplierRow,
} from '@saucepenny/core';
import { h } from './dom';
import { loadSupplierMap, saveSupplierMap } from './store';
import type { UiKey } from './strings';

export interface SupplierContext {
  T: (key: UiKey, params?: Record<string, string | number>) => string;
  lang: () => Lang;
  stored: () => StoredProject;
  compiled: () => Project | null;
  say: (text: string, list?: string[]) => void;
  /** replace the project (saves and re-renders) */
  replace: (p: StoredProject) => void;
  unitText: (u: string) => string;
  today: () => string;
}

interface Pending {
  rows: SupplierRow[];
  use: boolean[];
  notes: string[];
}
let pending: Pending | null = null;

export function renderSupplier(ctx: SupplierContext): HTMLElement {
  const { T } = ctx;
  const box = h('section', { id: 'supplier', 'aria-labelledby': 'supplier-title' });
  box.append(
    h('h3', { id: 'supplier-title' }, T('sup.title')),
    h('p', { class: 'help' }, T('sup.help')),
    h(
      'div',
      { class: 'toolbar' },
      h(
        'label',
        { class: 'file-button' },
        T('sup.choose'),
        h('input', {
          id: 'supplier-file',
          type: 'file',
          accept: '.csv,text/csv',
          class: 'visually-hidden',
          onchange: (e: Event) => void onFile(e, ctx),
        }),
      ),
    ),
  );
  if (!pending) return box;
  const ings = ctx.stored().ingredients;
  box.append(
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { id: 'supplier-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ...(
              [
                'sup.use',
                'sup.item',
                'sup.ingredient',
                'sup.now',
                'sup.new',
                'sup.change',
              ] as UiKey[]
            ).map((k) => h('th', { scope: 'col' }, T(k))),
          ),
        ),
        h(
          'tbody',
          {},
          pending.rows.map((row, k) =>
            h(
              'tr',
              { 'data-sup': k },
              h(
                'td',
                {},
                h('input', {
                  type: 'checkbox',
                  'data-sup-use': k,
                  checked: pending!.use[k],
                  disabled: row.match === null,
                  'aria-label': T('sup.useNamed', { name: row.name }),
                  onchange: (e: Event) => {
                    pending!.use[k] = (e.target as HTMLInputElement).checked;
                    updateApply(ctx);
                  },
                }),
              ),
              h('th', { scope: 'row' }, row.name),
              h(
                'td',
                {},
                h(
                  'select',
                  {
                    'data-sup-match': k,
                    'aria-label': T('sup.matchFor', { name: row.name }),
                    onchange: (e: Event) => {
                      const v = (e.target as HTMLSelectElement).value;
                      row.match = v || null;
                      row.matchedBy = null;
                      pending!.use[k] = row.match !== null && isChange(ctx, row);
                      rerender(ctx);
                    },
                  },
                  h('option', { value: '', selected: row.match === null }, T('sup.noMatch')),
                  ings.map((g) =>
                    h('option', { value: g.id, selected: g.id === row.match }, g.name),
                  ),
                ),
              ),
              h('td', { class: 'out' }, nowText(ctx, row)),
              h(
                'td',
                { class: 'out' },
                `${row.price} / ${row.packQty} ${ctx.unitText(row.packUnit)}`,
              ),
              h('td', { class: 'out s-change' }, changeText(ctx, row)),
            ),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'toolbar' },
      h('button', { id: 'supplier-apply', type: 'button', onclick: () => apply(ctx) }, ''),
      h(
        'button',
        {
          id: 'supplier-cancel',
          type: 'button',
          onclick: () => {
            pending = null;
            rerender(ctx);
          },
        },
        T('sup.cancel'),
      ),
    ),
    h(
      'ul',
      { id: 'supplier-notes', class: 'problem-list' },
      pending.notes.map((n) => h('li', {}, n)),
    ),
  );
  queueMicrotask(() => updateApply(ctx));
  return box;
}

function rerender(ctx: SupplierContext): void {
  const old = document.getElementById('supplier');
  if (!old) return;
  const active = document.activeElement as HTMLElement | null;
  const focusKey = active?.dataset.supMatch ?? null;
  const next = renderSupplier(ctx);
  old.replaceWith(next);
  if (focusKey !== null) next.querySelector<HTMLElement>(`[data-sup-match="${focusKey}"]`)?.focus();
}

function ingredientOf(ctx: SupplierContext, row: SupplierRow) {
  return row.match ? ctx.compiled()?.ingredients.get(row.match) : undefined;
}

function nowText(ctx: SupplierContext, row: SupplierRow): string {
  const g = row.match ? ctx.stored().ingredients.find((x) => x.id === row.match) : undefined;
  return g ? `${g.price} / ${g.packQty} ${ctx.unitText(g.packUnit)}` : ctx.T('common.none');
}

function isChange(ctx: SupplierContext, row: SupplierRow): boolean {
  const g = ctx.stored().ingredients.find((x) => x.id === row.match);
  if (!g) return false;
  const r = applySupplierPrices(
    { ...ctx.stored(), ingredients: [g] },
    [{ ingredientId: g.id, row }],
    '2000-01-01',
  );
  return r.ok && r.changed.length === 1;
}

function changeText(ctx: SupplierContext, row: SupplierRow): string {
  const { T } = ctx;
  const ing = ingredientOf(ctx, row);
  const compiled = ctx.compiled();
  if (!ing || !compiled) return T('common.none');
  if (!isChange(ctx, row)) return T('sup.same');
  const c = unitPriceChange(ing, row, compiled.measures);
  if (c.status === 'not-comparable') return T('sup.otherUnit');
  if (c.status === 'mismatch') return T('common.notVerified');
  if (c.change === null) return T('sup.wasZero');
  const sign = c.change.n > 0n ? '+' : '';
  return T('sup.perUnit', { change: `${sign}${formatPercent(c.change)}%` });
}

async function onFile(e: Event, ctx: SupplierContext): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const text = await file.text();
  input.value = '';
  const lang = ctx.lang();
  const r = readSupplierCsv(text, ctx.stored().ingredients, loadSupplierMap());
  const notes = r.problems
    .slice(0, 30)
    .map((p) => describeImportProblem(p, lang, (x) => describeError(x, lang)));
  if (!r.rows.length) {
    pending = null;
    ctx.say(ctx.T('sup.nothing'), notes);
    rerender(ctx);
    return;
  }
  pending = { rows: r.rows, use: [], notes };
  pending.use = r.rows.map((row) => row.match !== null && isChange(ctx, row));
  const unmatched = r.rows.filter((x) => x.match === null).length;
  ctx.say(ctx.T('sup.read', { n: r.rows.length, unmatched }));
  rerender(ctx);
}

function picked(): { row: SupplierRow; k: number }[] {
  if (!pending) return [];
  return pending.rows
    .map((row, k) => ({ row, k }))
    .filter(({ row, k }) => pending!.use[k] && row.match);
}

function updateApply(ctx: SupplierContext): void {
  const b = document.getElementById('supplier-apply') as HTMLButtonElement | null;
  if (!b) return;
  const n = picked().length;
  b.textContent = ctx.T('sup.apply', { n });
  b.disabled = n === 0;
}

function apply(ctx: SupplierContext): void {
  const { T } = ctx;
  const chosen = picked();
  const names = new Map(ctx.stored().ingredients.map((g) => [g.id, g.name]));
  const r = applySupplierPrices(
    ctx.stored(),
    chosen.map(({ row }) => ({ ingredientId: row.match!, row })),
    ctx.today(),
  );
  if (!r.ok) {
    ctx.say(
      T(r.code === 'duplicate-target' ? 'sup.duplicate' : 'sup.gone', {
        name: names.get(r.ingredientId) ?? r.ingredientId,
      }),
    );
    return;
  }
  const v = validateProject(r.project);
  if (!v.ok) {
    const lang = ctx.lang();
    ctx.say(
      T('sup.invalid'),
      v.errors.slice(0, 8).map((x) => describeError(x, lang)),
    );
    return;
  }
  const map = loadSupplierMap();
  for (const { row } of chosen) map[nameKey(row.name)] = row.match!;
  saveSupplierMap(map);
  pending = null;
  ctx.replace(r.project);
  ctx.say(
    T('sup.done', { n: r.changed.length }),
    r.changed.map((id) => names.get(id) ?? id),
  );
}
