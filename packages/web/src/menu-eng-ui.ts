// SPDX-License-Identifier: AGPL-3.0-or-later
// Menu engineering section of the Menu tab (v0.3): sales counts typed in or imported from a
// CSV, verified margins, and the four groups of calculation rule 16. Counts live only in
// this page session (they are not saved in the project); export them to keep them.

import type { Lang, StoredProject, VerifiedProject } from '@saucepenny/core';
import {
  describeSalesProblem,
  formatMoney,
  formatPercent,
  importSalesCsv,
  parseSold,
  salesToCsv,
  toCsv,
  verifiedMenuEngineering,
  type Quadrant,
} from '@saucepenny/core';
import { download, fileName, h } from './dom';
import type { UiKey } from './strings';

export interface EngContext {
  T: (key: UiKey, params?: Record<string, string | number>) => string;
  lang: () => Lang;
  stored: () => StoredProject;
  say: (text: string, list?: string[]) => void;
  verified: () => VerifiedProject | null;
}

const counts = new Map<string, number>();
let notes: string[] = [];

const QUAD_KEY: Record<Quadrant, UiKey> = {
  keep: 'eng.q.keep',
  'raise-margin': 'eng.q.raise',
  promote: 'eng.q.promote',
  rethink: 'eng.q.rethink',
};

export function renderMenuEng(ctx: EngContext): HTMLElement {
  const { T } = ctx;
  const menu = ctx.stored().menu;
  const box = h('section', { id: 'menu-eng', 'aria-labelledby': 'eng-title' });
  box.append(
    h('h3', { id: 'eng-title' }, T('eng.title')),
    h('p', { class: 'help' }, T('eng.help')),
    h(
      'div',
      { class: 'toolbar' },
      h(
        'label',
        { class: 'file-button' },
        T('eng.import'),
        h('input', {
          id: 'sales-file',
          type: 'file',
          accept: '.csv,text/csv',
          class: 'visually-hidden',
          onchange: (e: Event) => void onSalesFile(e, ctx),
        }),
      ),
      h(
        'button',
        { id: 'sales-template', type: 'button', onclick: () => downloadSheet(ctx) },
        T('eng.sheet'),
      ),
      h(
        'button',
        { id: 'eng-export', type: 'button', onclick: () => exportAnalysis(ctx) },
        T('eng.export'),
      ),
      h(
        'button',
        {
          id: 'sales-clear',
          type: 'button',
          onclick: () => {
            counts.clear();
            notes = [];
            for (const el of document.querySelectorAll<HTMLInputElement>('[data-sold]'))
              el.value = '';
            updateMenuEng(ctx);
          },
        },
        T('eng.clear'),
      ),
    ),
    h('p', { class: 'muted' }, T('eng.notSaved')),
    h('p', { id: 'eng-summary', role: 'status' }),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { id: 'eng-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ...(
              ['eng.item', 'eng.sold', 'eng.margin', 'eng.mix', 'eng.group', 'eng.total'] as UiKey[]
            ).map((k) => h('th', { scope: 'col' }, T(k))),
          ),
        ),
        h(
          'tbody',
          {},
          menu.map((m) =>
            h(
              'tr',
              { 'data-eng': m.id },
              h('th', { scope: 'row' }, m.name),
              h(
                'td',
                {},
                h('input', {
                  type: 'text',
                  inputmode: 'numeric',
                  class: 'num',
                  'data-sold': m.id,
                  'aria-label': T('eng.soldOf', { name: m.name }),
                  value: counts.has(m.id) ? String(counts.get(m.id)) : '',
                  oninput: (e: Event) => onSoldInput(e, ctx),
                }),
              ),
              h('td', { class: 'out e-margin' }),
              h('td', { class: 'out e-mix' }),
              h('td', { class: 'out e-group' }),
              h('td', { class: 'out e-total' }),
            ),
          ),
        ),
      ),
    ),
    h('ul', { id: 'eng-notes', class: 'problem-list' }),
  );
  return box;
}

function onSoldInput(e: Event, ctx: EngContext): void {
  const el = e.target as HTMLInputElement;
  const id = el.dataset.sold!;
  const raw = el.value.trim();
  if (raw === '') {
    counts.delete(id);
    el.removeAttribute('aria-invalid');
  } else {
    const n = parseSold(raw);
    if (typeof n === 'number') {
      counts.set(id, n);
      el.removeAttribute('aria-invalid');
    } else {
      counts.delete(id);
      el.setAttribute('aria-invalid', 'true');
    }
  }
  updateMenuEng(ctx);
}

async function onSalesFile(e: Event, ctx: EngContext): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const text = await file.text();
  input.value = '';
  const { T } = ctx;
  const zh = ctx.lang() === 'zh-HK';
  const menu = ctx.stored().menu;
  const r = importSalesCsv(text, menu);
  if (r.problems.some((p) => p.kind !== 'row')) {
    notes = r.problems.map((p) => describeSalesProblem(p, zh));
    ctx.say(T('eng.importFailed'), notes);
    updateMenuEng(ctx);
    return;
  }
  counts.clear();
  for (const [id, n] of r.sold) counts.set(id, n);
  for (const el of document.querySelectorAll<HTMLInputElement>('[data-sold]')) {
    const n = counts.get(el.dataset.sold!);
    el.value = n === undefined ? '' : String(n);
    el.removeAttribute('aria-invalid');
  }
  const name = (id: string) => menu.find((m) => m.id === id)?.name ?? id;
  notes = [
    ...r.problems.slice(0, 30).map((p) => describeSalesProblem(p, zh)),
    ...r.merged.map((id) => T('eng.merged', { name: name(id) })),
  ];
  ctx.say(T('eng.imported', { n: r.sold.size }), notes);
  updateMenuEng(ctx);
}

function downloadSheet(ctx: EngContext): void {
  const s = ctx.stored();
  const rows = s.menu.map((m) => ({ name: m.name, sold: counts.get(m.id) ?? 0 }));
  download(
    fileName(`${s.name}-sales`, 'csv'),
    salesToCsv(rows, ctx.lang() === 'zh-HK'),
    'text/csv;charset=utf-8',
  );
}

function exportAnalysis(ctx: EngContext): void {
  const { T } = ctx;
  const v = ctx.verified();
  if (!v) return;
  const r = verifiedMenuEngineering(v, counts);
  if (r.status !== 'ok')
    return ctx.say(T(r.status === 'empty' ? 'eng.needSales' : 'eng.notVerified'));
  const s = ctx.stored();
  const name = (id: string) => s.menu.find((m) => m.id === id)?.name ?? id;
  const out = [
    (['eng.item', 'eng.sold', 'eng.margin', 'eng.mix', 'eng.group', 'eng.total'] as UiKey[]).map(
      (k) => T(k),
    ),
  ];
  for (const x of r.rows)
    out.push([
      name(x.id),
      String(x.sold),
      formatMoney(x.margin),
      `${formatPercent(x.mix)}%`,
      T(QUAD_KEY[x.quadrant]),
      formatMoney(x.totalMargin),
    ]);
  for (const x of r.excluded)
    out.push([name(x.id), String(counts.get(x.id) ?? 0), '', '', T(`eng.ex.${x.reason}`), '']);
  download(
    fileName(`${s.name}-menu-engineering`, 'csv'),
    toCsv(out, { bom: true }),
    'text/csv;charset=utf-8',
  );
}

export function updateMenuEng(ctx: EngContext): void {
  const { T } = ctx;
  const summary = document.getElementById('eng-summary');
  const list = document.getElementById('eng-notes');
  if (!summary || !list) return;
  const v = ctx.verified();
  const none = T('common.none');
  const set = (tr: Element, sel: string, text: string, quad = '') => {
    const el = tr.querySelector<HTMLElement>(sel)!;
    el.textContent = text;
    if (sel === '.e-group') el.dataset.quadrant = quad;
  };
  const rows = document.querySelectorAll('#eng-table tbody tr');
  const r = v ? verifiedMenuEngineering(v, counts) : null;
  const extra: string[] = [];
  if (!r || r.status === 'mismatch') {
    summary.textContent = T(r ? 'eng.notVerified' : 'eng.fixFirst');
    for (const tr of rows)
      for (const c of ['.e-margin', '.e-mix', '.e-group', '.e-total']) set(tr, c, none);
  } else {
    const byId = new Map(r.status === 'ok' ? r.rows.map((x) => [x.id, x]) : []);
    const ex = new Map(r.excluded.map((x) => [x.id, x.reason]));
    for (const tr of rows) {
      const id = (tr as HTMLElement).dataset.eng!;
      const x = byId.get(id);
      const reason = ex.get(id);
      set(tr, '.e-margin', x ? formatMoney(x.margin) : none);
      set(tr, '.e-mix', x ? `${formatPercent(x.mix)}%` : none);
      set(
        tr,
        '.e-group',
        x ? T(QUAD_KEY[x.quadrant]) : reason ? T(`eng.ex.${reason}`) : none,
        x?.quadrant ?? '',
      );
      set(tr, '.e-total', x ? formatMoney(x.totalMargin) : none);
    }
    summary.textContent =
      r.status === 'ok'
        ? T('eng.summary', {
            sold: r.totalSold,
            avg: formatMoney(r.averageMargin),
            line: `${formatPercent(r.popularLine)}%`,
          })
        : T(r.reason === 'no-items' ? 'eng.noItems' : 'eng.needSales');
    if (r.excluded.length) extra.push(T('eng.excludedNote', { n: r.excluded.length }));
  }
  list.replaceChildren(...[...notes, ...extra].map((n) => h('li', {}, n)));
}
