// SPDX-License-Identifier: AGPL-3.0-or-later
// Saucepenny web UI: ingredients, recipes (with sub-recipes), menu pricing, price change
// impact, files and printing. Everything stays in this browser. Only numbers that the
// engine and the independent checker agree on are ever shown.

import type {
  Lang,
  PriceRounding,
  Project,
  ProjectError,
  StoredIngredient,
  StoredLine,
  StoredMenuItem,
  StoredProject,
  StoredRecipe,
  UnitRef,
  VerifiedProject,
} from '@saucepenny/core';
import {
  BASE_UNIT,
  describeError,
  describeImportProblem,
  formatQuantity,
  formatMoney,
  formatUnitMoney,
  importIngredientsCsv,
  ingredientsToCsv,
  menuCsv,
  menuRows,
  normaliseDecimalInput,
  normaliseQuantityInput,
  parseDecimal,
  parseQuantity,
  duplicateRecipe,
  measureUses,
  recordPriceChange,
  verifiedPriceChange,
  formatPercent,
  eq,
  type PriceSnapshot,
  PRICE_ROUNDINGS,
  readProjectJson,
  recipeCard,
  recipesCsv,
  stringifyProject,
  UNIT_IDS,
  UNITS,
  emptyProject,
  validateProject,
  verifiedImpact,
  verifiedIngredientCosts,
  verifiedMaxYield,
  verifiedProject,
  mul,
  div,
  isUnitId,
} from '@saucepenny/core';
import sampleText from '../../../examples/cha-chaan-teng.json?raw';
import { byId, download, fileName, h } from './dom';
import { printCards } from './print';
import {
  loadBackupState,
  loadSettings,
  loadState,
  saveBackupState,
  saveSettings,
  saveState,
  wipeAll,
  type Settings,
} from './store';
import {
  ensurePersisted,
  noteBackup,
  noteChange,
  reminderDue,
  snooze,
  type PersistStatus,
} from './storage-guard';
import { ui, type UiKey } from './strings';
import './styles.css';

type Tab = 'ingredients' | 'recipes' | 'menu' | 'impact' | 'data';
const TABS: Tab[] = ['ingredients', 'recipes', 'menu', 'impact', 'data'];

// ---------- state ----------
const settings: Settings = loadSettings();
let lang: Lang =
  settings.lang === 'en' || settings.lang === 'zh-HK'
    ? settings.lang
    : navigator.language.toLowerCase().startsWith('zh')
      ? 'zh-HK'
      : 'en';
let tab: Tab = TABS.includes(settings.tab as Tab) ? (settings.tab as Tab) : 'recipes';
let stored: StoredProject = sampleProject();
let compiled: Project | null = null;
let errors: ProjectError[] = [];
let selectedRecipe = '';
let filter = '';
let impactIngredient = '';
let impactPrice = '';
let scaleTo = '';
let canIngredient = '';
let canQty = '';
let canUnit: UnitRef = 'kg';
let note = '';
let persistStatus: PersistStatus | 'checking' = 'checking';
let persistAsked = false;
let backup = loadBackupState();
/** Price and pack of each ingredient as last shown, to keep the old price on a change. */
const priceSnap = new Map<string, PriceSnapshot>();
let noteList: string[] = [];

const T = (key: UiKey, params: Record<string, string | number> = {}) => ui(lang, key, params);

function sampleProject(): StoredProject {
  const r = readProjectJson(sampleText);
  if (!r.ok) throw new Error('example project is invalid');
  return r.value.stored;
}

// ---------- compute ----------
function compile(): void {
  const r = validateProject(stored);
  if (r.ok) {
    compiled = r.value.project;
    errors = [];
  } else {
    compiled = null;
    errors = r.errors;
  }
}

/** Verified numbers for what the current tab shows (a subset keeps big projects fast). */
function verifyForTab(): VerifiedProject | null {
  if (!compiled) return null;
  if (tab === 'recipes') {
    const r = compiled.recipes.get(selectedRecipe);
    if (!r) return verifiedProject(compiled, {});
    const subs = r.lines.filter((l) => l.ref.kind === 'recipe').map((l) => l.ref.id);
    return verifiedProject(compiled, { recipes: [r.id, ...subs] });
  }
  if (tab === 'menu') return verifiedProject(compiled, { menu: compiled.menu.keys() });
  return verifiedProject(compiled, {});
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let savePending = false;
let pendingSince = 0;
/** Save 250 ms after typing stops, but at least once a second while typing goes on. */
function persist(): void {
  clearTimeout(saveTimer);
  if (!savePending) pendingSince = Date.now();
  savePending = true;
  saveTimer = setTimeout(flushSave, Math.max(0, Math.min(250, pendingSince + 1000 - Date.now())));
}

/** Write now (also when the page is hidden or closed, so a quick reload loses nothing). */
function flushSave(): void {
  clearTimeout(saveTimer);
  if (!savePending) return;
  savePending = false;
  void saveState(JSON.parse(stringifyProject(stored)));
  backup = noteChange(backup, new Date().toISOString());
  saveBackupState(backup);
  updateReminder();
  void askPersist();
}

// ---------- keeping data safe (v0.2) ----------
const hasData = () => stored.ingredients.length + stored.recipes.length + stored.menu.length > 0;

async function askPersist(force = false): Promise<void> {
  if (persistStatus === 'persisted' || (persistAsked && !force)) return;
  persistAsked = true;
  persistStatus = await ensurePersisted(navigator.storage);
  updatePersistStatus();
}

function updatePersistStatus(): void {
  const el = document.getElementById('persist-status');
  if (!el) return;
  el.dataset.status = persistStatus;
  el.textContent = T(`persist.${persistStatus}` as UiKey);
  const again = document.getElementById('persist-again');
  if (again) again.hidden = persistStatus !== 'not-persisted';
}

function backupNow(): void {
  download(fileName(stored.name, 'json'), stringifyProject(stored), 'application/json');
  backup = noteBackup(new Date().toISOString());
  saveBackupState(backup);
  updateReminder();
  const last = document.getElementById('last-backup');
  if (last) last.textContent = T('backup.last', { d: backup.lastAt.slice(0, 10) });
}

/** The gentle "save a backup" reminder. Dismissible; nothing is sent anywhere. */
function updateReminder(): void {
  const box = document.getElementById('reminder');
  if (!box) return;
  const due = reminderDue(backup, Date.now(), hasData());
  box.hidden = !due;
  if (!due) {
    box.replaceChildren();
    return;
  }
  box.replaceChildren(
    h('span', {}, T('backup.reminder', { n: backup.changes })),
    ' ',
    h('button', { type: 'button', id: 'reminder-backup', onclick: backupNow }, T('backup.now')),
    ' ',
    h(
      'button',
      {
        type: 'button',
        id: 'reminder-later',
        onclick: () => {
          backup = snooze(backup, new Date().toISOString());
          saveBackupState(backup);
          updateReminder();
        },
      },
      T('backup.later'),
    ),
  );
}

const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Same number typed two ways (12 and 12.0, 1/2 and 0.5)? */
function sameQty(a: string, b: string): boolean {
  const x = parseQuantity(a);
  const y = parseQuantity(b);
  return x.ok && y.ok ? eq(x.value, y.value) : a === b;
}

/** After a price or pack edit: keep the previous price in the history (v0.2). */
function notePriceEdit(ing: StoredIngredient): void {
  const before = priceSnap.get(ing.id);
  const now: PriceSnapshot = {
    price: ing.price,
    packQty: ing.packQty,
    packUnit: ing.packUnit,
    priceDate: ing.priceDate,
  };
  if (!before) return void priceSnap.set(ing.id, now);
  const valid = (x: PriceSnapshot) => parseDecimal(x.price).ok && parseQuantity(x.packQty).ok;
  if (!valid(before) || !valid(now)) return;
  const priceBefore = parseDecimal(before.price);
  if (priceBefore.ok && priceBefore.value.n === 0n) {
    priceSnap.set(ing.id, now); // 0 is a placeholder, not a price worth keeping
    return;
  }
  const next = recordPriceChange(ing, before, todayIso(), sameQty);
  if (next !== ing) {
    Object.assign(ing, next);
    priceSnap.set(ing.id, { ...now, priceDate: ing.priceDate });
  }
}

// ---------- helpers ----------
const newId = (prefix: string, taken: Iterable<{ id: string }>) => {
  const ids = new Set([...taken].map((x) => x.id));
  let n = ids.size + 1;
  while (ids.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
};

function unitText(ref: UnitRef): string {
  if (ref === 'portion') return lang === 'en' ? 'portion' : '份';
  if (isUnitId(ref)) return lang === 'en' ? UNITS[ref].en : UNITS[ref].zh;
  const m = stored.measures.find((x) => `measure:${x.id}` === ref);
  return m ? m.name : ref;
}

function unitSelect(
  value: UnitRef,
  opts: { portion: boolean; key: string; label: string; path?: string },
) {
  const refs: UnitRef[] = [...UNIT_IDS, ...(opts.portion ? (['portion'] as UnitRef[]) : [])];
  for (const m of stored.measures) refs.push(`measure:${m.id}`);
  return h(
    'select',
    { 'data-key': opts.key, 'aria-label': opts.label, 'data-path': opts.path },
    refs.map((r) => h('option', { value: r, selected: r === value }, unitText(r))),
  );
}

function numInput(
  value: string | undefined,
  key: string,
  label: string,
  path: string,
  extra: Record<string, string> = {},
) {
  return h('input', {
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    value: value ?? '',
    'data-key': key,
    'data-path': path,
    'aria-label': label,
    class: 'num',
    ...extra,
  });
}

function textInput(value: string, key: string, label: string, path: string) {
  return h('input', {
    type: 'text',
    value,
    'data-key': key,
    'data-path': path,
    'aria-label': label,
    autocomplete: 'off',
  });
}

/** Normalise typed numbers (full-width digits, commas) once the field is left. */
function tidyNumber(v: string, quantity = false): string {
  if (quantity && normaliseQuantityInput(v).includes('/'))
    return parseQuantity(v).ok ? normaliseQuantityInput(v) : v;
  const r = parseDecimal(v);
  return r.ok ? normaliseDecimalInput(v).replace(/,/g, '') : v;
}

const FIELD: Record<string, UiKey> = {
  name: 'ing.name',
  packQty: 'ing.packQty',
  packUnit: 'ing.unit',
  price: 'ing.price',
  yieldPercent: 'ing.yield',
  density: 'ing.density',
  pieceWeight: 'ing.pieceWeight',
  yieldQty: 'rec.yieldQty',
  yieldUnit: 'rec.yieldUnit',
  qty: 'rec.qty',
  unit: 'rec.unit',
  wastePercent: 'rec.waste',
  ref: 'rec.item',
  recipeId: 'menu.recipe',
  portionQty: 'menu.portion',
  portionUnit: 'menu.portion',
  targetPercent: 'menu.target',
  rounding: 'menu.rounding',
  serviceChargePercent: 'data.service',
  goodPercent: 'data.good',
  highPercent: 'data.high',
  currency: 'data.currency',
  amount: 'data.measureAmount',
  labourMinutes: 'rec.labourMinutes',
  labourRate: 'rec.labourRate',
  overheadFixed: 'rec.overheadFixed',
  overheadPercent: 'rec.overheadPercent',
  priceHistory: 'impact.history',
};

/** "recipes[2].lines[0].qty" → "食譜「叉燒」· 第 1 行 · 份量: message" using names. */
function describeValidation(e: ProjectError): string {
  const msg = describeError({ ...e, path: '' }, lang);
  const m = /^(ingredients|recipes|menu|measures)\[(\d+)\](?:\.lines\[(\d+)\])?(?:\.(\w+))?/.exec(
    e.path,
  );
  const field = (k: string | undefined) => (k && FIELD[k] ? T(FIELD[k]) : (k ?? ''));
  if (!m) {
    const s = /^settings\.(\w+)/.exec(e.path);
    return s ? `${T('tab.data')} · ${field(s[1])}: ${msg}` : msg;
  }
  const [, section, idx, line, key] = m;
  const coll = stored[section as 'ingredients' | 'recipes' | 'menu' | 'measures'] as {
    name?: string;
  }[];
  const name = coll[Number(idx)]?.name || `#${Number(idx) + 1}`;
  const label = {
    ingredients: 'tab.ingredients',
    recipes: 'tab.recipes',
    menu: 'tab.menu',
    measures: 'data.measures',
  }[section!] as UiKey;
  const parts = [`${T(label)}「${name}」`];
  if (line !== undefined)
    parts.push(lang === 'en' ? `line ${Number(line) + 1}` : `第 ${Number(line) + 1} 行`);
  if (key) parts.push(field(key));
  return `${parts.join(' · ')}: ${msg}`;
}

// ---------- rendering ----------
function renderProblems(): void {
  const box = byId('problems');
  box.replaceChildren();
  document
    .querySelectorAll('[aria-invalid="true"]')
    .forEach((el) => el.removeAttribute('aria-invalid'));
  if (!errors.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const shown = errors.slice(0, 8);
  box.append(
    h('p', { class: 'problems-title' }, T('problems.title')),
    h(
      'ul',
      {},
      shown.map((e) => h('li', {}, describeValidation(e))),
    ),
  );
  if (errors.length > shown.length)
    box.append(h('p', {}, T('problems.more', { n: errors.length - shown.length })));
  for (const e of errors) {
    const el = document.querySelector(`[data-path="${CSS.escape(e.path)}"]`);
    if (el) el.setAttribute('aria-invalid', 'true');
  }
}

function renderTabs(): void {
  for (const t of TABS) {
    const b = byId(`tab-${t}`);
    b.setAttribute('aria-selected', String(t === tab));
    b.tabIndex = t === tab ? 0 : -1;
    byId(`panel-${t}`).hidden = t !== tab;
  }
}

function render(): void {
  const active = document.activeElement as HTMLElement | null;
  const key = active?.dataset.key;
  const caret =
    active instanceof HTMLInputElement && active.type === 'text' ? active.selectionStart : null;
  compile();
  renderTabs();
  const panel = byId(`panel-${tab}`);
  panel.replaceChildren();
  if (tab === 'ingredients') renderIngredients(panel);
  else if (tab === 'recipes') renderRecipes(panel);
  else if (tab === 'menu') renderMenu(panel);
  else if (tab === 'impact') renderImpact(panel);
  else renderData(panel);
  refresh(false);
  if (key) {
    const el = document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    if (el) {
      el.focus();
      if (el instanceof HTMLInputElement && caret !== null && el.type === 'text')
        el.setSelectionRange(caret, caret);
    }
  }
}

/** Recompute and update only the displayed numbers (keeps focus while typing). */
function refresh(recompile = true): void {
  if (recompile) compile();
  renderProblems();
  const v = verifyForTab();
  if (tab === 'ingredients') updateIngredients();
  else if (tab === 'recipes') updateRecipe(v);
  else if (tab === 'menu') updateMenu(v);
  else if (tab === 'impact') updateImpact();
  const status = byId('status');
  status.textContent = note;
  const list = byId('status-list');
  list.replaceChildren(...noteList.map((n) => h('li', {}, n)));
}

function setText(sel: string, text: string, root: ParentNode = document): void {
  const el = root.querySelector(sel);
  if (el && el.textContent !== text) el.textContent = text;
}

// ----- ingredients -----
function renderIngredients(panel: HTMLElement): void {
  priceSnap.clear();
  for (const g of stored.ingredients)
    priceSnap.set(g.id, {
      price: g.price,
      packQty: g.packQty,
      packUnit: g.packUnit,
      priceDate: g.priceDate,
    });
  const rows = stored.ingredients
    .map((ing, i) => ({ ing, i }))
    .filter(({ ing }) => !filter || ing.name.toLowerCase().includes(filter.toLowerCase()));
  panel.append(
    h('h2', {}, T('ing.title')),
    h('p', { class: 'help' }, `${T('ing.help')} ${T('v2.qtyHelp')}`),
    h(
      'div',
      { class: 'toolbar' },
      h('button', { id: 'add-ingredient', type: 'button', onclick: addIngredient }, T('ing.add')),
      h(
        'label',
        {},
        `${T('ing.filter')} `,
        h('input', { id: 'ing-filter', type: 'search', value: filter, 'data-key': 'ing-filter' }),
      ),
      h(
        'label',
        { class: 'file-button' },
        T('ing.import'),
        h('input', {
          id: 'import-ingredients',
          type: 'file',
          accept: '.csv,text/csv',
          class: 'visually-hidden',
        }),
      ),
      h(
        'button',
        {
          id: 'export-ingredients',
          type: 'button',
          onclick: () =>
            download(
              fileName(`${stored.name}-ingredients`, 'csv'),
              ingredientsToCsv(stored.ingredients, lang),
              'text/csv;charset=utf-8',
            ),
        },
        T('ing.export'),
      ),
      h('span', { class: 'muted' }, T('ing.count', { n: stored.ingredients.length })),
    ),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { id: 'ingredient-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ...(
              [
                'ing.name',
                'ing.packQty',
                'ing.unit',
                'ing.price',
                'ing.yield',
                'ing.density',
                'ing.pieceWeight',
                'ing.unitCost',
                'ing.trend',
              ] as UiKey[]
            ).map((k) => h('th', { scope: 'col' }, T(k))),
            h('th', {}, h('span', { class: 'visually-hidden' }, T('common.remove'))),
          ),
        ),
        h(
          'tbody',
          {},
          rows.map(({ ing, i }) => {
            const p = `ingredients[${i}]`;
            const k = `ing:${ing.id}`;
            return h(
              'tr',
              { 'data-ing': ing.id },
              h('td', {}, textInput(ing.name, `${k}:name`, T('ing.name'), `${p}.name`)),
              h('td', {}, numInput(ing.packQty, `${k}:packQty`, T('ing.packQty'), `${p}.packQty`)),
              h(
                'td',
                {},
                unitSelect(ing.packUnit, {
                  portion: false,
                  key: `${k}:packUnit`,
                  label: T('ing.unit'),
                  path: `${p}.packUnit`,
                }),
              ),
              h('td', {}, numInput(ing.price, `${k}:price`, T('ing.price'), `${p}.price`)),
              h(
                'td',
                {},
                numInput(
                  ing.yieldPercent ?? '100',
                  `${k}:yieldPercent`,
                  T('ing.yield'),
                  `${p}.yieldPercent`,
                ),
              ),
              h('td', {}, numInput(ing.density, `${k}:density`, T('ing.density'), `${p}.density`)),
              h(
                'td',
                {},
                numInput(
                  ing.pieceWeight,
                  `${k}:pieceWeight`,
                  T('ing.pieceWeight'),
                  `${p}.pieceWeight`,
                ),
              ),
              h('td', { class: 'out unit-cost', 'data-out': `unit-cost:${ing.id}` }),
              h('td', { class: 'out price-trend', 'data-out': `price-trend:${ing.id}` }),
              h(
                'td',
                {},
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'remove',
                    'data-remove-ing': ing.id,
                    'aria-label': T('common.removeNamed', { name: ing.name }),
                  },
                  '×',
                ),
              ),
            );
          }),
        ),
      ),
    ),
  );
}

function updateIngredients(): void {
  const costs = compiled ? verifiedIngredientCosts(compiled) : null;
  for (const ing of stored.ingredients) {
    const v = costs?.get(ing.id);
    const text =
      v && v.status === 'ok'
        ? `${formatUnitMoney(v.cost)} / ${unitText(v.unit)}`
        : T('common.none');
    setText(`[data-out="unit-cost:${CSS.escape(ing.id)}"]`, text);
    setText(`[data-out="price-trend:${CSS.escape(ing.id)}"]`, trendText(ing.id));
  }
}

function trendText(id: string): string {
  const ing = compiled?.ingredients.get(id);
  if (!ing) return '';
  const t = verifiedPriceChange(ing);
  if (!t) return '';
  if (t.status === 'mismatch') return T('common.notVerified');
  const date = t.from.date;
  if (t.status === 'pack-changed') return T('ing.trendPack', { date });
  if (t.change === null) return T('ing.trendFree', { date });
  if (t.change.n === 0n) return T('ing.trendSame', { date });
  const abs = t.change.n < 0n ? { n: -t.change.n, d: t.change.d } : t.change;
  return T(t.change.n > 0n ? 'ing.trendUp' : 'ing.trendDown', {
    pct: formatPercent(abs),
    date,
  });
}

function addIngredient(): void {
  const id = newId('i', stored.ingredients);
  stored.ingredients.push({
    id,
    name: `${T('ing.new')} ${stored.ingredients.length + 1}`,
    packQty: '1',
    packUnit: 'kg',
    price: '0',
  });
  changed(true);
  document.querySelector<HTMLInputElement>(`[data-key="ing:${id}:name"]`)?.select();
}

function usersOfIngredient(id: string): string[] {
  return stored.recipes
    .filter((r) => r.lines.some((l) => l.ref.kind === 'ingredient' && l.ref.id === id))
    .map((r) => r.name);
}
function usersOfRecipe(id: string): string[] {
  return [
    ...stored.recipes
      .filter((r) => r.lines.some((l) => l.ref.kind === 'recipe' && l.ref.id === id))
      .map((r) => r.name),
    ...stored.menu.filter((m) => m.recipeId === id).map((m) => m.name),
  ];
}

// ----- recipes -----
function itemSelect(line: StoredLine, key: string, path: string, self: string) {
  const value = `${line.ref.kind === 'ingredient' ? 'i' : 'r'}:${line.ref.id}`;
  return h(
    'select',
    { 'data-key': key, 'data-path': path, 'aria-label': T('rec.item') },
    h(
      'optgroup',
      { label: T('rec.ingredients') },
      stored.ingredients.map((i) =>
        h('option', { value: `i:${i.id}`, selected: value === `i:${i.id}` }, i.name),
      ),
    ),
    h(
      'optgroup',
      { label: T('rec.subRecipes') },
      stored.recipes
        .filter((r) => r.id !== self)
        .map((r) => h('option', { value: `r:${r.id}`, selected: value === `r:${r.id}` }, r.name)),
    ),
  );
}

function renderRecipes(panel: HTMLElement): void {
  if (!stored.recipes.some((r) => r.id === selectedRecipe))
    selectedRecipe = stored.recipes[0]?.id ?? '';
  const list = h(
    'nav',
    { class: 'recipe-list', 'aria-label': T('rec.title') },
    h('button', { id: 'add-recipe', type: 'button', onclick: addRecipe }, T('rec.add')),
    h(
      'ul',
      { id: 'recipe-list' },
      stored.recipes.map((r) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              'data-recipe': r.id,
              'aria-current': r.id === selectedRecipe ? 'true' : undefined,
              onclick: () => {
                selectedRecipe = r.id;
                scaleTo = '';
                render();
              },
            },
            r.name || '—',
          ),
        ),
      ),
    ),
  );
  const idx = stored.recipes.findIndex((r) => r.id === selectedRecipe);
  const r = stored.recipes[idx];
  if (!r) {
    panel.append(
      h('h2', {}, T('rec.title')),
      h('div', { class: 'split' }, list, h('p', {}, T('rec.none'))),
    );
    return;
  }
  const p = `recipes[${idx}]`;
  const k = `rec:${r.id}`;
  const editor = h(
    'section',
    { class: 'recipe-editor', 'aria-labelledby': 'recipe-heading' },
    h('h3', { id: 'recipe-heading' }, r.name || '—'),
    h(
      'div',
      { class: 'fields' },
      h(
        'label',
        {},
        T('rec.name'),
        h('input', {
          id: 'recipe-name',
          type: 'text',
          value: r.name,
          'data-key': `${k}:name`,
          'data-path': `${p}.name`,
          autocomplete: 'off',
        }),
      ),
      h(
        'label',
        {},
        T('rec.yieldQty'),
        numInput(r.yieldQty, `${k}:yieldQty`, T('rec.yieldQty'), `${p}.yieldQty`, {
          id: 'recipe-yield-qty',
        }),
      ),
      h(
        'label',
        {},
        T('rec.yieldUnit'),
        withId(
          unitSelect(r.yieldUnit, {
            portion: true,
            key: `${k}:yieldUnit`,
            label: T('rec.yieldUnit'),
            path: `${p}.yieldUnit`,
          }),
          'recipe-yield-unit',
        ),
      ),
      h(
        'label',
        {},
        T('rec.density'),
        numInput(r.density, `${k}:density`, T('rec.density'), `${p}.density`, {
          id: 'recipe-density',
        }),
      ),
    ),
    h('h4', {}, T('rec.lines')),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { id: 'line-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ...(
              [
                'rec.item',
                'rec.qty',
                'rec.unit',
                'rec.waste',
                'rec.counted',
                'rec.cost',
                'rec.share',
              ] as UiKey[]
            ).map((x) => h('th', { scope: 'col' }, T(x))),
            h('th', {}, h('span', { class: 'visually-hidden' }, T('common.remove'))),
          ),
        ),
        h(
          'tbody',
          {},
          r.lines.flatMap((l, j) => {
            const lp = `${p}.lines[${j}]`;
            const lk = `${k}:line:${j}`;
            const row = h(
              'tr',
              { 'data-line': j },
              h('td', {}, itemSelect(l, `${lk}:item`, `${lp}.ref`, r.id)),
              h('td', {}, numInput(l.qty, `${lk}:qty`, T('rec.qty'), `${lp}.qty`)),
              h(
                'td',
                {},
                unitSelect(l.unit, {
                  portion: l.ref.kind === 'recipe',
                  key: `${lk}:unit`,
                  label: T('rec.unit'),
                  path: `${lp}.unit`,
                }),
              ),
              h(
                'td',
                {},
                numInput(
                  l.wastePercent ?? '0',
                  `${lk}:waste`,
                  T('rec.waste'),
                  `${lp}.wastePercent`,
                ),
              ),
              h(
                'td',
                {},
                numInput(
                  l.costPercent ?? '100',
                  `${lk}:counted`,
                  T('rec.counted'),
                  `${lp}.costPercent`,
                  { title: T('rec.countedHelp') },
                ),
              ),
              h('td', { class: 'out line-cost' }),
              h('td', { class: 'out line-share' }),
              h(
                'td',
                {},
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'remove',
                    'data-remove-line': j,
                    'aria-label': T('common.removeNamed', { name: lineName(l) }),
                  },
                  '×',
                ),
              ),
            );
            if (l.ref.kind !== 'recipe') return [row];
            const sub = h(
              'tr',
              { class: 'sub-row', 'data-sub-of': j },
              h(
                'td',
                { colspan: 8 },
                h(
                  'details',
                  {},
                  h('summary', {}, T('rec.expand', { name: lineName(l) })),
                  h('div', { class: 'sub-card', 'data-sub': l.ref.id }),
                ),
              ),
            );
            return [row, sub];
          }),
        ),
        h(
          'tfoot',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'row', colspan: 5 }, T('rec.total')),
            h('td', { id: 'recipe-total', class: 'out' }),
            h('td', { colspan: 2 }),
          ),
          h(
            'tr',
            {},
            h(
              'th',
              { scope: 'row', colspan: 5, id: 'recipe-per-unit-label' },
              T('rec.perUnit', { unit: unitText(r.yieldUnit) }),
            ),
            h('td', { id: 'recipe-per-unit', class: 'out' }),
            h('td', { colspan: 2 }),
          ),
          h(
            'tr',
            {},
            h('th', { scope: 'row', colspan: 5 }, T('rec.weight')),
            h('td', { id: 'recipe-weight', class: 'out', colspan: 3 }),
          ),
        ),
      ),
    ),
    h('p', { id: 'recipe-problem', class: 'problem', role: 'alert', hidden: true }),
    h('p', { class: 'help' }, `${T('v2.qtyHelp')} ${T('rec.countedHelp')}`),
    h(
      'details',
      {
        class: 'tool',
        id: 'extras',
        open: Boolean(r.labourMinutes || r.overheadFixed || r.overheadPercent),
      },
      h('summary', {}, T('rec.extras')),
      h('p', { class: 'help' }, T('rec.extrasHelp')),
      h(
        'div',
        { class: 'fields' },
        ...(
          [
            ['labourMinutes', 'rec.labourMinutes'],
            ['labourRate', 'rec.labourRate'],
            ['overheadFixed', 'rec.overheadFixed'],
            ['overheadPercent', 'rec.overheadPercent'],
          ] as const
        ).map(([f, label]) =>
          h(
            'label',
            {},
            T(label),
            numInput(r[f], `${k}:${f}`, T(label), `${p}.${f}`, { id: `recipe-${f}` }),
          ),
        ),
      ),
      h(
        'table',
        { id: 'extras-table' },
        h(
          'tbody',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'row' }, T('rec.labour')),
            h('td', { id: 'recipe-labour', class: 'out' }),
          ),
          h(
            'tr',
            {},
            h('th', { scope: 'row' }, T('rec.overhead')),
            h('td', { id: 'recipe-overhead', class: 'out' }),
          ),
          h(
            'tr',
            {},
            h('th', { scope: 'row' }, T('rec.full')),
            h('td', { id: 'recipe-full', class: 'out' }),
          ),
          h(
            'tr',
            {},
            h('th', { scope: 'row' }, T('rec.fullPerUnit', { unit: unitText(r.yieldUnit) })),
            h('td', { id: 'recipe-full-per-unit', class: 'out' }),
          ),
        ),
      ),
    ),
    h(
      'div',
      { class: 'toolbar' },
      h(
        'button',
        {
          id: 'add-line',
          type: 'button',
          disabled: stored.ingredients.length === 0 && stored.recipes.length < 2,
          onclick: addLine,
        },
        T('rec.addLine'),
      ),
      h(
        'button',
        { id: 'duplicate-recipe', type: 'button', onclick: copyRecipe },
        T('rec.duplicate'),
      ),
      h(
        'button',
        { id: 'remove-recipe', type: 'button', class: 'danger', onclick: removeRecipe },
        T('rec.remove'),
      ),
    ),
    h(
      'details',
      { class: 'tool', open: scaleTo !== '' },
      h('summary', {}, T('rec.scale')),
      h(
        'label',
        {},
        T('rec.scaleTo'),
        ' ',
        h('input', {
          id: 'scale-to',
          type: 'text',
          inputmode: 'decimal',
          value: scaleTo,
          'data-key': 'scale-to',
          class: 'num',
        }),
        ` ${unitText(r.yieldUnit)}`,
      ),
      h(
        'table',
        { id: 'scale-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, T('rec.item')),
            h('th', {}, T('rec.scaled')),
            h('th', {}, T('rec.scaledCost')),
          ),
        ),
        h('tbody', {}),
      ),
    ),
    h(
      'details',
      { class: 'tool', open: canQty !== '' },
      h('summary', {}, T('rec.can')),
      h(
        'p',
        {},
        `${T('rec.canHave')} `,
        h('input', {
          id: 'can-qty',
          type: 'text',
          inputmode: 'decimal',
          value: canQty,
          'data-key': 'can-qty',
          class: 'num',
          'aria-label': T('rec.qty'),
        }),
        ' ',
        withId(
          unitSelect(canUnit, { portion: false, key: 'can-unit', label: T('rec.unit') }),
          'can-unit',
        ),
        ` ${T('rec.canOf')} `,
        h(
          'select',
          {
            id: 'can-ingredient',
            'data-key': 'can-ingredient',
            'aria-label': T('impact.ingredient'),
          },
          stored.ingredients.map((i) =>
            h('option', { value: i.id, selected: i.id === canIngredient }, i.name),
          ),
        ),
      ),
      h('p', { id: 'can-result', role: 'status' }),
    ),
  );
  panel.append(h('h2', {}, T('rec.title')), h('div', { class: 'split' }, list, editor));
}

function withId<T extends HTMLElement>(el: T, id: string): T {
  el.id = id;
  return el;
}

function lineName(l: StoredLine): string {
  const coll: { id: string; name: string }[] =
    l.ref.kind === 'ingredient' ? stored.ingredients : stored.recipes;
  return coll.find((x) => x.id === l.ref.id)?.name ?? l.ref.id;
}

function updateRecipe(v: VerifiedProject | null): void {
  const idx = stored.recipes.findIndex((r) => r.id === selectedRecipe);
  const r = stored.recipes[idx];
  if (!r) return;
  const card = v && compiled ? recipeCard(compiled, v, r.id, lang) : null;
  const rows = document.querySelectorAll<HTMLTableRowElement>('#line-table tbody tr[data-line]');
  rows.forEach((row, j) => {
    setText('.line-cost', card?.lines[j]?.cost || T('common.none'), row);
    const counted = card?.lines[j]?.counted;
    setText(
      '.line-share',
      counted ? `${card?.lines[j]?.share ?? ''} · ${counted}` : card?.lines[j]?.share || '',
      row,
    );
  });
  setText('#recipe-total', card?.total ?? T('common.none'));
  setText('#recipe-per-unit', card?.perUnit ?? T('common.none'));
  const none = T('common.none');
  setText('#recipe-labour', card?.extras?.labour ?? none);
  setText('#recipe-overhead', card?.extras?.overhead ?? none);
  setText('#recipe-full', card?.extras?.full ?? none);
  setText('#recipe-full-per-unit', card?.extras?.fullPerUnit ?? none);
  const w = card?.weight;
  setText(
    '#recipe-weight',
    !w
      ? none
      : w.status === 'missing'
        ? T('rec.weightMissing', { items: w.lines.join('、') })
        : w.perPortion
          ? T('rec.weightPer', { total: w.total, per: w.perPortion })
          : w.total,
  );
  setText('#recipe-heading', r.name || '—');
  const prob = byId('recipe-problem');
  prob.hidden = !card?.problem;
  prob.textContent = card?.problem ?? '';
  // sub-recipe cards
  document.querySelectorAll<HTMLElement>('.sub-card').forEach((box) => {
    const id = box.dataset.sub!;
    const sub = v && compiled && v.recipes.has(id) ? recipeCard(compiled, v, id, lang) : null;
    box.replaceChildren(
      sub
        ? h(
            'div',
            {},
            h('p', {}, `${sub.yieldText} · ${T('rec.total')} ${sub.total ?? T('common.none')}`),
            h(
              'ul',
              {},
              sub.lines.map((l) =>
                h(
                  'li',
                  {},
                  `${l.name} ${l.qty} ${l.unit}${l.waste ? ` (+${l.waste})` : ''} · ${l.cost || T('common.none')}`,
                ),
              ),
            ),
            sub.problem ? h('p', { class: 'problem' }, sub.problem) : null,
          )
        : h('p', {}, T('common.none')),
    );
  });
  // scaling
  const tbody = document.querySelector('#scale-table tbody');
  if (tbody) {
    tbody.replaceChildren();
    const target = parseQuantity(scaleTo);
    const vr = v?.recipes.get(r.id);
    if (compiled && target.ok && target.value.n > 0n && vr?.status === 'ok') {
      const cr = compiled.recipes.get(r.id)!;
      const k = div(target.value, cr.yieldQty);
      cr.lines.forEach((l, j) =>
        tbody.append(
          h(
            'tr',
            {},
            h('td', {}, lineName(r.lines[j]!)),
            h('td', {}, `${formatQuantity(mul(l.qty, k))} ${unitText(l.unit)}`),
            h('td', {}, formatMoney(mul(vr.lines[j]!, k))),
          ),
        ),
      );
      tbody.append(
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, T('rec.total')),
          h('td', {}, `${formatQuantity(target.value)} ${unitText(r.yieldUnit)}`),
          h('td', {}, formatMoney(mul(vr.total, k))),
        ),
      );
    }
  }
  // how much can I make
  const out = document.getElementById('can-result');
  if (out) {
    const q = parseQuantity(canQty);
    let text = '';
    if (compiled && q.ok && canIngredient && compiled.ingredients.has(canIngredient)) {
      const res = verifiedMaxYield(compiled, r.id, canIngredient, q.value, canUnit);
      if (res.status === 'ok')
        text =
          res.yieldUnits === null
            ? T('rec.canUnused')
            : T('rec.canResult', {
                qty: formatQuantity(res.yieldUnits, 2),
                unit: unitText(r.yieldUnit),
              });
      else if (res.status === 'error') text = describeError(res.error, lang, compiled);
    }
    out.textContent = text;
  }
}

function addRecipe(): void {
  const id = newId('r', stored.recipes);
  stored.recipes.push({
    id,
    name: `${T('rec.new')} ${stored.recipes.length + 1}`,
    yieldQty: '1',
    yieldUnit: 'portion',
    lines: [],
  });
  selectedRecipe = id;
  changed(true);
  byId<HTMLInputElement>('recipe-name').select();
  byId<HTMLInputElement>('recipe-name').focus();
}

function copyRecipe(): void {
  const r = stored.recipes.find((x) => x.id === selectedRecipe);
  if (!r) return;
  const copy = duplicateRecipe(r, newId('r', stored.recipes), lang);
  stored.recipes.splice(stored.recipes.indexOf(r) + 1, 0, copy);
  selectedRecipe = copy.id;
  say(T('rec.duplicated', { name: copy.name }));
  changed(true);
  byId<HTMLInputElement>('recipe-name').focus();
}

function addLine(): void {
  const r = stored.recipes.find((x) => x.id === selectedRecipe);
  if (!r) return;
  const ing = stored.ingredients[0];
  if (ing) {
    const dim = isUnitId(ing.packUnit) ? UNITS[ing.packUnit].dimension : 'mass';
    r.lines.push({ ref: { kind: 'ingredient', id: ing.id }, qty: '1', unit: BASE_UNIT[dim] });
  } else {
    const other = stored.recipes.find((x) => x.id !== r.id)!;
    r.lines.push({ ref: { kind: 'recipe', id: other.id }, qty: '1', unit: other.yieldUnit });
  }
  changed(true);
  document
    .querySelector<HTMLSelectElement>(`[data-key="rec:${r.id}:line:${r.lines.length - 1}:item"]`)
    ?.focus();
}

function removeRecipe(): void {
  const r = stored.recipes.find((x) => x.id === selectedRecipe);
  if (!r) return;
  const users = usersOfRecipe(r.id);
  if (users.length) {
    say(T('rec.inUse', { name: r.name, users: users.join('、') }));
    return;
  }
  stored.recipes = stored.recipes.filter((x) => x.id !== r.id);
  changed(true);
}

// ----- menu -----
function renderMenu(panel: HTMLElement): void {
  panel.append(
    h('h2', {}, T('menu.title')),
    h('p', { class: 'help' }, T('menu.help')),
    h(
      'div',
      { class: 'toolbar' },
      h(
        'button',
        { id: 'add-menu', type: 'button', disabled: stored.recipes.length === 0, onclick: addMenu },
        T('menu.add'),
      ),
      stored.recipes.length ? null : h('span', { class: 'muted' }, T('menu.needRecipe')),
    ),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { id: 'menu-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ...(
              [
                'menu.name',
                'menu.recipe',
                'menu.portion',
                'menu.price',
                'menu.service',
                'menu.target',
                'menu.rounding',
                'menu.cost',
                'menu.foodCost',
                'menu.suggested',
                'menu.atSuggested',
                'menu.profit',
              ] as UiKey[]
            ).map((x) => h('th', { scope: 'col' }, T(x))),
            h('th', {}, h('span', { class: 'visually-hidden' }, T('common.remove'))),
          ),
        ),
        h(
          'tbody',
          {},
          stored.menu.map((m, i) => {
            const p = `menu[${i}]`;
            const k = `menu:${m.id}`;
            return h(
              'tr',
              { 'data-menu': m.id },
              h('td', {}, textInput(m.name, `${k}:name`, T('menu.name'), `${p}.name`)),
              h(
                'td',
                {},
                h(
                  'select',
                  {
                    'data-key': `${k}:recipe`,
                    'data-path': `${p}.recipeId`,
                    'aria-label': T('menu.recipe'),
                  },
                  stored.recipes.map((r) =>
                    h('option', { value: r.id, selected: r.id === m.recipeId }, r.name),
                  ),
                ),
              ),
              h(
                'td',
                { class: 'portion' },
                numInput(m.portionQty, `${k}:portionQty`, T('menu.portion'), `${p}.portionQty`),
                unitSelect(m.portionUnit, {
                  portion: true,
                  key: `${k}:portionUnit`,
                  label: T('rec.unit'),
                  path: `${p}.portionUnit`,
                }),
              ),
              h('td', {}, numInput(m.price, `${k}:price`, T('menu.price'), `${p}.price`)),
              h(
                'td',
                {},
                h('input', {
                  type: 'checkbox',
                  checked: m.priceIncludesService,
                  'data-key': `${k}:service`,
                  'aria-label': T('menu.service'),
                }),
              ),
              h(
                'td',
                {},
                numInput(m.targetPercent, `${k}:target`, T('menu.target'), `${p}.targetPercent`),
              ),
              h(
                'td',
                {},
                h(
                  'select',
                  { 'data-key': `${k}:rounding`, 'aria-label': T('menu.rounding') },
                  PRICE_ROUNDINGS.map((x) =>
                    h('option', { value: x, selected: x === m.rounding }, T(`round.${x}` as UiKey)),
                  ),
                ),
              ),
              h('td', { class: 'out m-cost' }),
              h('td', { class: 'out m-food-cost' }),
              h('td', { class: 'out m-suggested' }),
              h('td', { class: 'out m-at-suggested' }),
              h('td', { class: 'out m-profit' }),
              h(
                'td',
                {},
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'remove',
                    'data-remove-menu': m.id,
                    'aria-label': T('common.removeNamed', { name: m.name }),
                  },
                  '×',
                ),
              ),
            );
          }),
        ),
      ),
    ),
    h('ul', { id: 'menu-problems', class: 'problem-list' }),
  );
}

function updateMenu(v: VerifiedProject | null): void {
  const rows = v && compiled ? menuRows(compiled, v, lang) : [];
  const byIdRow = new Map(rows.map((r) => [r.id, r]));
  const problems: string[] = [];
  for (const m of stored.menu) {
    const tr = document.querySelector<HTMLElement>(`tr[data-menu="${CSS.escape(m.id)}"]`);
    if (!tr) continue;
    const r = byIdRow.get(m.id);
    const none = T('common.none');
    setText('.m-cost', r?.portionCost ?? none, tr);
    const fc = tr.querySelector<HTMLElement>('.m-food-cost')!;
    fc.textContent = r?.foodCost ? `${r.foodCost} · ${T(`band.${r.band!}` as UiKey)}` : none;
    fc.dataset.band = r?.band ?? '';
    setText('.m-suggested', r?.suggested ?? none, tr);
    setText('.m-at-suggested', r?.suggestedFoodCost ?? none, tr);
    setText('.m-profit', r?.grossProfit ?? none, tr);
    if (r?.problem) problems.push(`${m.name}: ${r.problem}`);
  }
  const ul = document.getElementById('menu-problems');
  ul?.replaceChildren(...problems.map((p) => h('li', {}, p)));
}

function addMenu(): void {
  const r = stored.recipes.find((x) => x.id === selectedRecipe) ?? stored.recipes[0];
  if (!r) return;
  const id = newId('m', stored.menu);
  const item: StoredMenuItem = {
    id,
    name: r.name || T('menu.new'),
    recipeId: r.id,
    portionQty: '1',
    portionUnit: r.yieldUnit,
    price: '0',
    priceIncludesService: false,
    targetPercent: '30',
    rounding: '1',
  };
  stored.menu.push(item);
  changed(true);
  document.querySelector<HTMLInputElement>(`[data-key="menu:${id}:price"]`)?.focus();
}

// ----- impact -----
function renderImpact(panel: HTMLElement): void {
  if (!stored.ingredients.some((i) => i.id === impactIngredient))
    impactIngredient = stored.ingredients[0]?.id ?? '';
  panel.append(
    h('h2', {}, T('impact.title')),
    h(
      'div',
      { class: 'fields' },
      h(
        'label',
        {},
        T('impact.ingredient'),
        h(
          'select',
          { id: 'impact-ingredient', 'data-key': 'impact-ingredient' },
          stored.ingredients.map((i) =>
            h(
              'option',
              { value: i.id, selected: i.id === impactIngredient },
              `${i.name} (${i.price} / ${i.packQty} ${unitText(i.packUnit)})`,
            ),
          ),
        ),
      ),
      h(
        'label',
        {},
        T('impact.price'),
        h('input', {
          id: 'impact-price',
          type: 'text',
          inputmode: 'decimal',
          value: impactPrice,
          'data-key': 'impact-price',
          class: 'num',
        }),
      ),
    ),
    h('p', { id: 'impact-note', role: 'status' }),
    historySection(),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { id: 'impact-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ...(['impact.what', 'impact.before', 'impact.after', 'impact.change'] as UiKey[]).map(
              (x) => h('th', { scope: 'col' }, T(x)),
            ),
          ),
        ),
        h('tbody', {}),
      ),
    ),
  );
}

function historySection(): HTMLElement {
  const ing = stored.ingredients.find((i) => i.id === impactIngredient);
  const hist = ing?.priceHistory ?? [];
  const box = h('section', { id: 'price-history', 'aria-labelledby': 'history-title' });
  box.append(h('h3', { id: 'history-title' }, T('impact.history')));
  if (!ing || hist.length === 0) {
    box.append(h('p', { class: 'help' }, T('impact.historyNone')));
    return box;
  }
  box.append(
    h(
      'table',
      { id: 'history-table' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, T('impact.date')),
          h('th', { scope: 'col' }, T('ing.price')),
          h('th', { scope: 'col' }, T('impact.pack')),
          h('th', {}, h('span', { class: 'visually-hidden' }, T('common.remove'))),
        ),
      ),
      h(
        'tbody',
        {},
        hist
          .map((x, n) => ({ x, n }))
          .reverse()
          .map(({ x, n }) => {
            const samePack = x.packUnit === ing.packUnit && sameQty(x.packQty, ing.packQty);
            return h(
              'tr',
              { 'data-history': n },
              h('td', {}, x.date),
              h('td', { class: 'num' }, x.price),
              h('td', {}, `${x.packQty} ${unitText(x.packUnit)}`),
              h(
                'td',
                {},
                samePack
                  ? h('button', { type: 'button', 'data-use-price': x.price }, T('impact.useOld'))
                  : h('span', { class: 'muted' }, T('impact.otherPack')),
                ' ',
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'remove',
                    'data-remove-history': n,
                    'aria-label': T('impact.removeOld', { date: x.date }),
                  },
                  '×',
                ),
              ),
            );
          }),
      ),
    ),
  );
  return box;
}

function updateImpact(): void {
  const tbody = document.querySelector('#impact-table tbody');
  const noteEl = document.getElementById('impact-note');
  if (!tbody || !noteEl) return;
  tbody.replaceChildren();
  noteEl.textContent = '';
  if (!compiled || !impactIngredient || impactPrice.trim() === '') return;
  const p = parseDecimal(impactPrice);
  if (!p.ok || p.value.n < 0n) {
    noteEl.textContent = T('impact.badPrice');
    return;
  }
  const v = verifiedImpact(compiled, impactIngredient, p.value);
  if (v.status !== 'ok') {
    noteEl.textContent = T('common.notVerified');
    return;
  }
  if (!v.rows.length) noteEl.textContent = T('impact.none');
  for (const r of v.rows)
    tbody.append(
      h(
        'tr',
        { 'data-impact': `${r.kind}:${r.id}` },
        h('td', {}, `${r.name} · ${T(r.kind === 'recipe' ? 'impact.recipe' : 'impact.menu')}`),
        h('td', {}, formatMoney(r.before)),
        h('td', {}, formatMoney(r.after)),
        h('td', {}, `${r.change.n > 0n ? '+' : ''}${formatMoney(r.change)}`),
      ),
    );
}

// ----- data -----
function renderData(panel: HTMLElement): void {
  const s = stored.settings;
  panel.append(
    h('h2', {}, T('data.title')),
    h(
      'div',
      { class: 'fields' },
      h(
        'label',
        {},
        T('data.name'),
        h('input', {
          id: 'project-name',
          type: 'text',
          value: stored.name,
          'data-key': 'project-name',
          'data-path': 'name',
        }),
      ),
      h(
        'label',
        {},
        T('data.currency'),
        h('input', {
          id: 'currency',
          type: 'text',
          value: s.currency,
          'data-key': 'currency',
          'data-path': 'settings.currency',
          maxlength: 3,
        }),
      ),
      h(
        'label',
        {},
        T('data.service'),
        numInput(
          s.serviceChargePercent,
          'service',
          T('data.service'),
          'settings.serviceChargePercent',
          { id: 'service-charge' },
        ),
      ),
      h(
        'label',
        {},
        T('data.good'),
        numInput(s.goodPercent, 'good', T('data.good'), 'settings.goodPercent', { id: 'good' }),
      ),
      h(
        'label',
        {},
        T('data.high'),
        numInput(s.highPercent, 'high', T('data.high'), 'settings.highPercent', { id: 'high' }),
      ),
    ),
    measuresSection(),
    h('h3', {}, T('data.storage')),
    h(
      'p',
      { id: 'persist-status', 'data-status': persistStatus, role: 'status' },
      T(`persist.${persistStatus}` as UiKey),
    ),
    h(
      'button',
      {
        id: 'persist-again',
        type: 'button',
        hidden: persistStatus !== 'not-persisted',
        onclick: () => void askPersist(true),
      },
      T('persist.ask'),
    ),
    h(
      'p',
      { id: 'last-backup', class: 'muted' },
      backup.lastAt ? T('backup.last', { d: backup.lastAt.slice(0, 10) }) : T('backup.never'),
    ),
    h('h3', {}, T('data.files')),
    h(
      'div',
      { class: 'toolbar' },
      h(
        'label',
        { class: 'file-button' },
        T('data.open'),
        h('input', {
          id: 'open-file',
          type: 'file',
          accept: '.json,application/json',
          class: 'visually-hidden',
        }),
      ),
      h(
        'button',
        {
          id: 'save-json',
          type: 'button',
          onclick: backupNow,
        },
        T('data.save'),
      ),
      h(
        'button',
        {
          id: 'export-menu',
          type: 'button',
          disabled: !compiled,
          onclick: () =>
            compiled &&
            download(
              fileName(`${stored.name}-menu`, 'csv'),
              menuCsv(compiled, lang),
              'text/csv;charset=utf-8',
            ),
        },
        T('data.exportMenu'),
      ),
      h(
        'button',
        {
          id: 'export-recipes',
          type: 'button',
          disabled: !compiled,
          onclick: () =>
            compiled &&
            download(
              fileName(`${stored.name}-recipes`, 'csv'),
              recipesCsv(compiled, lang),
              'text/csv;charset=utf-8',
            ),
        },
        T('data.exportRecipes'),
      ),
      h(
        'button',
        { id: 'print', type: 'button', disabled: !compiled, onclick: doPrint },
        T('data.print'),
      ),
    ),
    h(
      'div',
      { class: 'toolbar' },
      h(
        'button',
        {
          id: 'new-project',
          type: 'button',
          onclick: () =>
            confirm(T('data.newConfirm')) && replaceProject(emptyProject(T('data.title'))),
        },
        T('data.new'),
      ),
      h(
        'button',
        {
          id: 'load-sample',
          type: 'button',
          onclick: () => confirm(T('data.sampleConfirm')) && replaceProject(sampleProject()),
        },
        T('data.sample'),
      ),
      h(
        'button',
        { id: 'delete-all', type: 'button', class: 'danger', onclick: deleteAll },
        T('data.delete'),
      ),
    ),
    h('p', { class: 'help' }, T('data.privacy')),
  );
}

function measuresSection(): HTMLElement {
  return h(
    'section',
    { id: 'measures', 'aria-labelledby': 'measures-title' },
    h('h3', { id: 'measures-title' }, T('data.measures')),
    h('p', { class: 'help' }, T('data.measuresHelp')),
    stored.measures.length
      ? h(
          'table',
          { id: 'measure-table' },
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              h('th', { scope: 'col' }, T('data.measureName')),
              h('th', { scope: 'col' }, T('data.measureAmount')),
              h('th', { scope: 'col' }, T('data.measureUnit')),
              h('th', {}, h('span', { class: 'visually-hidden' }, T('common.remove'))),
            ),
          ),
          h(
            'tbody',
            {},
            stored.measures.map((m, i) => {
              const p = `measures[${i}]`;
              const k = `measure:${m.id}`;
              return h(
                'tr',
                { 'data-measure': m.id },
                h('td', {}, textInput(m.name, `${k}:name`, T('data.measureName'), `${p}.name`)),
                h(
                  'td',
                  {},
                  numInput(m.amount, `${k}:amount`, T('data.measureAmount'), `${p}.amount`),
                ),
                h(
                  'td',
                  {},
                  h(
                    'select',
                    {
                      'data-key': `${k}:unit`,
                      'data-path': `${p}.unit`,
                      'aria-label': T('data.measureUnit'),
                    },
                    UNIT_IDS.map((u) =>
                      h('option', { value: u, selected: u === m.unit }, unitText(u)),
                    ),
                  ),
                ),
                h(
                  'td',
                  {},
                  h(
                    'button',
                    {
                      type: 'button',
                      class: 'remove',
                      'data-remove-measure': m.id,
                      'aria-label': T('common.removeNamed', { name: m.name }),
                    },
                    '×',
                  ),
                ),
              );
            }),
          ),
        )
      : null,
    h(
      'button',
      {
        id: 'add-measure',
        type: 'button',
        onclick: () => {
          const id = newId('m', stored.measures);
          stored.measures.push({
            id,
            name: `${T('data.newMeasure')} ${stored.measures.length + 1}`,
            amount: '250',
            unit: 'ml',
          });
          changed(true);
          document.querySelector<HTMLInputElement>(`[data-key="measure:${id}:name"]`)?.select();
        },
      },
      T('data.addMeasure'),
    ),
  );
}

function replaceProject(p: StoredProject): void {
  stored = p;
  selectedRecipe = '';
  changed(true);
}

async function deleteAll(): Promise<void> {
  if (!confirm(T('data.deleteConfirm'))) return;
  clearTimeout(saveTimer);
  savePending = false;
  await wipeAll();
  stored = emptyProject(T('data.title'));
  selectedRecipe = '';
  say(T('data.deleted'));
  render();
}

function doPrint(): void {
  if (!compiled) return;
  printCards(byId('print-area'), compiled, verifiedProject(compiled), lang, T);
  window.print();
}

function say(text: string, list: string[] = []): void {
  note = text;
  noteList = list;
  byId('status').textContent = note;
  byId('status-list').replaceChildren(...noteList.map((n) => h('li', {}, n)));
}

/** After any edit: save, then either a full render (structure changed) or a refresh. */
function changed(structural: boolean): void {
  persist();
  if (structural) render();
  else refresh();
}

// ---------- events ----------
function onInput(e: Event): void {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  const key = el.dataset.key;
  if (!key) return;
  const value =
    el instanceof HTMLInputElement && el.type === 'checkbox' ? String(el.checked) : el.value;
  applyEdit(key, value, e.type === 'change');
}

/** Returns true when handled. `final` is true on "change" (field left / option chosen). */
function applyEdit(key: string, raw: string, final: boolean): boolean {
  const parts = key.split(':');
  const value =
    final &&
    (parts.at(-1) ?? '').match(
      /qty|Qty|price|Percent|yield|density|pieceWeight|waste|counted|target|service|good|high|amount|labour|overhead/,
    ) &&
    !key.endsWith(':service')
      ? tidyNumber(raw, /^(qty|packQty|yieldQty|portionQty|amount)$/.test(parts.at(-1) ?? ''))
      : raw;
  if (final && value !== raw) {
    const el = document.querySelector<HTMLInputElement>(`[data-key="${CSS.escape(key)}"]`);
    if (el) el.value = value;
  }
  if (parts[0] === 'ing') {
    const ing = stored.ingredients.find((x) => x.id === parts[1]);
    if (!ing) return true;
    const field = parts[2] as keyof StoredIngredient;
    if (field === 'packUnit') ing.packUnit = value as UnitRef;
    else if (field === 'density' || field === 'pieceWeight' || field === 'yieldPercent') {
      if (value.trim() === '' && field !== 'yieldPercent') delete ing[field];
      else ing[field] = value;
    } else (ing as unknown as Record<string, string>)[field] = value;
    if (field === 'packUnit' || (final && (field === 'price' || field === 'packQty')))
      notePriceEdit(ing);
    changed(false);
    return true;
  }
  if (parts[0] === 'measure') {
    const m = stored.measures.find((x) => x.id === parts[1]);
    if (!m) return true;
    const f = parts[2];
    if (f === 'name') m.name = value;
    else if (f === 'amount') m.amount = value;
    else if (f === 'unit' && isUnitId(value)) m.unit = value;
    changed(false);
    return true;
  }
  if (parts[0] === 'rec') {
    const r = stored.recipes.find((x) => x.id === parts[1]);
    if (!r) return true;
    if (parts[2] === 'line') {
      const l = r.lines[Number(parts[3])];
      if (!l) return true;
      const f = parts[4];
      if (f === 'item') {
        const [kind, id] = value.split(/:(.*)/s) as [string, string];
        l.ref = kind === 'i' ? { kind: 'ingredient', id } : { kind: 'recipe', id };
        changed(true);
        return true;
      }
      if (f === 'qty') l.qty = value;
      else if (f === 'unit') l.unit = value as UnitRef;
      else if (f === 'waste') {
        if (value.trim() === '' || value.trim() === '0') delete l.wastePercent;
        else l.wastePercent = value;
      } else if (f === 'counted') {
        if (value.trim() === '' || value.trim() === '100') delete l.costPercent;
        else l.costPercent = value;
      }
      changed(false);
      return true;
    }
    const f = parts[2] as keyof StoredRecipe;
    if (f === 'yieldUnit') {
      r.yieldUnit = value as UnitRef;
      changed(true);
      return true;
    }
    if (
      f === 'density' ||
      f === 'labourMinutes' ||
      f === 'labourRate' ||
      f === 'overheadFixed' ||
      f === 'overheadPercent'
    ) {
      if (value.trim() === '') delete r[f];
      else r[f] = value;
    } else if (f === 'name' || f === 'yieldQty') r[f] = value;
    changed(false);
    if (final && f === 'name') render();
    return true;
  }
  if (parts[0] === 'menu') {
    const m = stored.menu.find((x) => x.id === parts[1]);
    if (!m) return true;
    const f = parts[2];
    if (f === 'name') m.name = value;
    else if (f === 'recipe') m.recipeId = value;
    else if (f === 'portionQty') m.portionQty = value;
    else if (f === 'portionUnit') m.portionUnit = value as UnitRef;
    else if (f === 'price') m.price = value;
    else if (f === 'service') m.priceIncludesService = value === 'true';
    else if (f === 'target') m.targetPercent = value;
    else if (f === 'rounding') m.rounding = value as PriceRounding;
    changed(false);
    return true;
  }
  switch (key) {
    case 'ing-filter':
      filter = raw;
      render();
      return true;
    case 'impact-ingredient':
      impactIngredient = raw;
      render();
      return true;
    case 'impact-price':
      impactPrice = raw;
      break;
    case 'scale-to':
      scaleTo = raw;
      break;
    case 'can-qty':
      canQty = raw;
      break;
    case 'can-unit':
      canUnit = raw as UnitRef;
      break;
    case 'can-ingredient':
      canIngredient = raw;
      break;
    case 'project-name':
      stored.name = raw;
      persist();
      break;
    case 'currency':
      stored.settings.currency = raw.trim().toUpperCase();
      persist();
      break;
    case 'service':
      stored.settings.serviceChargePercent = value;
      persist();
      break;
    case 'good':
      stored.settings.goodPercent = value;
      persist();
      break;
    case 'high':
      stored.settings.highPercent = value;
      persist();
      break;
    default:
      return false;
  }
  refresh();
  return true;
}

async function onFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const text = await file.text();
  input.value = '';
  if (input.id === 'open-file') {
    const r = readProjectJson(text);
    if (!r.ok) {
      say(
        T('data.openFailed'),
        r.errors.slice(0, 8).map((x) => describeError(x, lang)),
      );
      return;
    }
    stored = r.value.stored;
    selectedRecipe = '';
    say(T('data.opened'));
    changed(true);
  } else if (input.id === 'import-ingredients') {
    const r = importIngredientsCsv(text, new Set(stored.ingredients.map((i) => i.id)));
    stored.ingredients.push(...r.ingredients);
    say(
      T('ing.imported', { n: r.ingredients.length }),
      r.problems.length
        ? [
            T('ing.importProblems'),
            ...r.problems
              .slice(0, 20)
              .map((p) => describeImportProblem(p, lang, (x) => describeError(x, lang))),
          ]
        : [],
    );
    changed(true);
  }
}

function onClick(e: MouseEvent): void {
  const t = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!t) return;
  if (t.dataset.removeIng) {
    const id = t.dataset.removeIng;
    const ing = stored.ingredients.find((x) => x.id === id)!;
    const users = usersOfIngredient(id);
    if (users.length) return say(T('ing.inUse', { name: ing.name, recipes: users.join('、') }));
    stored.ingredients = stored.ingredients.filter((x) => x.id !== id);
    changed(true);
  } else if (t.dataset.removeLine !== undefined) {
    const r = stored.recipes.find((x) => x.id === selectedRecipe);
    r?.lines.splice(Number(t.dataset.removeLine), 1);
    changed(true);
  } else if (t.dataset.removeMenu) {
    stored.menu = stored.menu.filter((x) => x.id !== t.dataset.removeMenu);
    changed(true);
  } else if (t.dataset.removeMeasure) {
    const id = t.dataset.removeMeasure;
    const m = stored.measures.find((x) => x.id === id)!;
    const users = measureUses(stored, id);
    if (users.length) return say(T('data.measureInUse', { name: m.name, users: users.join('、') }));
    stored.measures = stored.measures.filter((x) => x.id !== id);
    changed(true);
  } else if (t.dataset.usePrice !== undefined) {
    impactPrice = t.dataset.usePrice;
    byId<HTMLInputElement>('impact-price').value = impactPrice;
    refresh(false);
  } else if (t.dataset.removeHistory !== undefined) {
    const ing = stored.ingredients.find((i) => i.id === impactIngredient);
    if (!ing?.priceHistory) return;
    ing.priceHistory.splice(Number(t.dataset.removeHistory), 1);
    if (!ing.priceHistory.length) delete ing.priceHistory;
    changed(true);
  }
}

// ---------- static text, settings ----------
function applySettings(): void {
  const root = document.documentElement;
  root.lang = lang === 'en' ? 'en' : 'zh-Hant-HK';
  const theme =
    settings.theme === 'light' || settings.theme === 'dark'
      ? settings.theme
      : matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  root.dataset.theme = theme;
  root.dataset.size = settings.large ? 'large' : 'normal';
  for (const el of document.querySelectorAll<HTMLElement>('[data-t]'))
    el.textContent = T(el.dataset.t as UiKey);
  byId<HTMLSelectElement>('lang').value = lang;
  byId<HTMLSelectElement>('theme').value = settings.theme ?? 'system';
  byId<HTMLInputElement>('large').checked = Boolean(settings.large);
  saveSettings({ lang, theme: settings.theme, large: settings.large, tab });
}

function setTab(next: Tab): void {
  tab = next;
  saveSettings({ lang, theme: settings.theme, large: settings.large, tab });
  render();
}

async function start(): Promise<void> {
  const saved = await loadState();
  if (saved && typeof saved === 'object') {
    void askPersist(); // the user has their own data here
    const r = validateProject(saved);
    if (r.ok) stored = r.value.stored;
    else if (
      r.errors.every(
        (e) =>
          ![
            'type',
            'not-a-project',
            'unsupported-version',
            'newer-version',
            'too-many',
            'forbidden-key',
            'required',
          ].includes(e.code),
      )
    )
      stored = saved as StoredProject; // our own save with a half-typed number: keep it
  }
  byId('lang').addEventListener('change', (e) => {
    lang = (e.target as HTMLSelectElement).value === 'zh-HK' ? 'zh-HK' : 'en';
    settings.lang = lang;
    applySettings();
    render();
  });
  byId('theme').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    settings.theme = v === 'light' || v === 'dark' ? v : undefined;
    applySettings();
  });
  byId('large').addEventListener('change', (e) => {
    settings.large = (e.target as HTMLInputElement).checked;
    applySettings();
  });
  for (const t of TABS) byId(`tab-${t}`).addEventListener('click', () => setTab(t));
  byId('tablist').addEventListener('keydown', (e) => {
    const i = TABS.indexOf(tab);
    const next =
      e.key === 'ArrowRight'
        ? TABS[(i + 1) % TABS.length]
        : e.key === 'ArrowLeft'
          ? TABS[(i + TABS.length - 1) % TABS.length]
          : undefined;
    if (next) {
      setTab(next);
      byId(`tab-${next}`).focus();
    }
  });
  const app = byId('app');
  app.addEventListener('input', (e) => {
    if ((e.target as HTMLElement).matches('input[type=file]')) return;
    onInput(e);
  });
  app.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    if (t.matches('input[type=file]')) return void onFile(e);
    if (t instanceof HTMLSelectElement || (t instanceof HTMLInputElement && t.type === 'checkbox'))
      return; // handled by "input"
    onInput(e);
  });
  app.addEventListener('click', onClick);
  addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
  applySettings();
  render();
  updateReminder();
  document.body.dataset.ready = 'true';
  if ('serviceWorker' in navigator && import.meta.env.PROD)
    void navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}

void start();
