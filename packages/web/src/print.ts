// SPDX-License-Identifier: AGPL-3.0-or-later
// Print view: one cost card per recipe and the menu cost table, built from verified
// numbers only (the same structures as the CLI report). Hidden on screen; shown by
// @media print.

import type { Lang, Project, VerifiedProject } from '@saucepenny/core';
import { menuRows, recipeCard, reportText } from '@saucepenny/core';
import { h } from './dom';
import type { UiKey } from './strings';

export function printCards(
  area: HTMLElement,
  project: Project,
  v: VerifiedProject,
  lang: Lang,
  T: (k: UiKey, p?: Record<string, string | number>) => string,
): void {
  const t = reportText(lang);
  const none = T('common.none');
  const cards = [...project.recipes.keys()].map((id) => {
    const c = recipeCard(project, v, id, lang);
    return h(
      'section',
      { class: 'print-card' },
      h('h2', {}, `${c.name} · ${c.yieldText}`),
      c.problem
        ? h('p', { class: 'problem' }, c.problem)
        : h(
            'table',
            {},
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                ...(['rec.item', 'rec.qty', 'rec.waste', 'rec.cost', 'rec.share'] as UiKey[]).map(
                  (k) => h('th', {}, T(k)),
                ),
              ),
            ),
            h(
              'tbody',
              {},
              c.lines.map((l) =>
                h(
                  'tr',
                  {},
                  h(
                    'td',
                    {},
                    `${l.isRecipe ? '↳ ' : ''}${l.name}${l.counted ? ` (${l.counted})` : ''}`,
                  ),
                  h('td', {}, `${l.qty} ${l.unit}`),
                  h('td', {}, l.waste),
                  h('td', { class: 'num' }, l.cost),
                  h('td', { class: 'num' }, l.share),
                ),
              ),
            ),
            h(
              'tfoot',
              {},
              h(
                'tr',
                {},
                h('th', { colspan: 3 }, T('rec.total')),
                h('td', { class: 'num' }, c.total ?? none),
                h('td', {}),
              ),
              h(
                'tr',
                {},
                h('th', { colspan: 3 }, T('rec.perUnit', { unit: c.perUnitLabel })),
                h('td', { class: 'num' }, c.perUnit ?? none),
                h('td', {}),
              ),
              ...(c.extras
                ? (
                    [
                      [T('rec.labour'), c.extras.labour],
                      [T('rec.overhead'), c.extras.overhead],
                      [T('rec.full'), c.extras.full],
                      [T('rec.fullPerUnit', { unit: c.perUnitLabel }), c.extras.fullPerUnit],
                    ] as const
                  ).map(([label, value]) =>
                    h(
                      'tr',
                      {},
                      h('th', { colspan: 3 }, label),
                      h('td', { class: 'num' }, value),
                      h('td', {}),
                    ),
                  )
                : []),
              c.weight?.status === 'ok'
                ? h(
                    'tr',
                    {},
                    h('th', { colspan: 3 }, T('rec.weight')),
                    h(
                      'td',
                      { class: 'num', colspan: 2 },
                      c.weight.perPortion
                        ? T('rec.weightPer', { total: c.weight.total, per: c.weight.perPortion })
                        : c.weight.total,
                    ),
                  )
                : null,
            ),
          ),
    );
  });
  const rows = menuRows(project, v, lang);
  const menu = h(
    'section',
    { class: 'print-card print-menu' },
    h('h2', {}, T('menu.title')),
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ...(
            [
              'menu.name',
              'menu.price',
              'menu.cost',
              'menu.foodCost',
              'menu.suggested',
              'menu.atSuggested',
              'menu.profit',
            ] as UiKey[]
          ).map((k) => h('th', {}, T(k))),
        ),
      ),
      h(
        'tbody',
        {},
        rows.map((r) =>
          h(
            'tr',
            {},
            h('td', {}, r.name),
            h(
              'td',
              { class: 'num' },
              r.price + (r.includesService ? ` (${T('menu.service')})` : ''),
            ),
            h('td', { class: 'num' }, r.portionCost ?? none),
            h(
              'td',
              { class: 'num' },
              r.foodCost ? `${r.foodCost} ${T(`band.${r.band!}` as UiKey)}` : none,
            ),
            h('td', { class: 'num' }, r.suggested ?? none),
            h('td', { class: 'num' }, r.suggestedFoodCost ?? none),
            h('td', { class: 'num' }, r.grossProfit ?? none),
          ),
        ),
      ),
    ),
  );
  area.replaceChildren(
    h(
      'header',
      {},
      h('h1', {}, `${project.name} · ${T('print.title')}`),
      h('p', {}, `${project.settings.currency} · ${t.disclaimer}`),
    ),
    menu,
    ...cards,
    h('p', { class: 'print-note' }, t.rounding),
  );
}
