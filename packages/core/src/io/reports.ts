// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Display-ready data built ONLY from verified numbers: recipe cost cards, the menu cost
// table, CSV exports and the plain-text report the CLI prints. The web UI renders the same
// structures, so the CLI and the UI show identical text for identical projects.

import { verifiedImpact, verifiedProject, type VerifiedProject } from '../api';
import { describeError, type Lang } from '../i18n/index';
import type { Project, UnitRef } from '../model/index';
import { div, formatMoney, formatPercent, formatQuantity, type Rational } from '../num/index';
import { UNITS, isUnitId } from '../units/index';
import { ENGINE_VERSION, RULES_VERSION } from '../version';
import { toCsv } from './csv';

const T = {
  en: {
    disclaimer: 'Estimates only, not accounting or tax advice.',
    mismatch: 'Internal check failed; number withheld. Please report this.',
    portion: 'portion',
    recipes: 'Recipes',
    recipeOne: 'Recipe',
    menuOne: 'Menu item',
    menu: 'Menu',
    yields: 'yields',
    total: 'total',
    per: 'per',
    waste: 'waste',
    price: 'price',
    net: 'net',
    cost: 'cost',
    foodCost: 'food cost',
    target: 'target',
    suggested: 'suggested',
    atSuggested: 'at suggested',
    profit: 'gross profit',
    inclService: 'incl. service',
    good: 'good',
    watch: 'watch',
    high: 'high',
    noPrice: '— (price is 0)',
    currency: 'Currency',
    impact: 'Price change',
    noImpact: 'Nothing changes.',
    rounding:
      'Each amount is rounded to the cent on its own; rounded lines may not add up exactly.',
  },
  'zh-HK': {
    disclaimer: '只供估算，並非會計或稅務意見。',
    mismatch: '內部核對失敗，不顯示數字。請回報。',
    portion: '份',
    recipes: '食譜',
    recipeOne: '食譜',
    menuOne: '餐牌項目',
    menu: '餐牌',
    yields: '產出',
    total: '總成本',
    per: '每',
    waste: '損耗',
    price: '售價',
    net: '淨價',
    cost: '成本',
    foodCost: '食材成本率',
    target: '目標',
    suggested: '建議售價',
    atSuggested: '按建議售價',
    profit: '毛利',
    inclService: '已含服務費',
    good: '良好',
    watch: '留意',
    high: '偏高',
    noPrice: '—（售價為 0）',
    currency: '貨幣',
    impact: '價格變動',
    noImpact: '沒有任何改變。',
    rounding: '每個金額各自四捨五入至仙，各行相加可能與總數相差一兩仙。',
  },
} as const;

export const reportText = (lang: Lang) => T[lang];

export function unitLabel(ref: UnitRef, project: Project, lang: Lang): string {
  if (ref === 'portion') return T[lang].portion;
  if (isUnitId(ref)) return lang === 'en' ? UNITS[ref].en : UNITS[ref].zh;
  return project.measures.get(ref.slice('measure:'.length))?.name ?? ref;
}

const pct = (r: Rational) => `${formatPercent(r)}%`;

export interface CardLine {
  name: string;
  isRecipe: boolean;
  qty: string;
  unit: string;
  waste: string;
  cost: string;
  share: string;
}
export interface RecipeCard {
  id: string;
  name: string;
  yieldText: string;
  /** null when the numbers are not available */
  total: string | null;
  perUnit: string | null;
  perUnitLabel: string;
  lines: CardLine[];
  problem: string | null;
}

export function recipeCard(
  project: Project,
  v: VerifiedProject,
  id: string,
  lang: Lang,
): RecipeCard {
  const r = project.recipes.get(id)!;
  const vr = v.recipes.get(id)!;
  const ok = vr.status === 'ok' ? vr : null;
  const unit = unitLabel(r.yieldUnit, project, lang);
  const lines = r.lines.map((l, j): CardLine => {
    const name =
      l.ref.kind === 'ingredient'
        ? project.ingredients.get(l.ref.id)!.name
        : project.recipes.get(l.ref.id)!.name;
    const cost = ok ? ok.lines[j]! : null;
    return {
      name,
      isRecipe: l.ref.kind === 'recipe',
      qty: formatQuantity(l.qty),
      unit: unitLabel(l.unit, project, lang),
      waste: l.waste.n === 0n ? '' : pct(l.waste),
      cost: cost ? formatMoney(cost) : '',
      share: cost && ok && ok.total.n !== 0n ? pct(div(cost, ok.total)) : '',
    };
  });
  return {
    id,
    name: r.name,
    yieldText: `${formatQuantity(r.yieldQty)} ${unit}`,
    total: ok ? formatMoney(ok.total) : null,
    perUnit: ok ? formatMoney(ok.perYieldUnit) : null,
    perUnitLabel: unit,
    lines,
    problem:
      vr.status === 'error'
        ? describeError(vr.error, lang, project)
        : vr.status === 'mismatch'
          ? T[lang].mismatch
          : null,
  };
}

export interface MenuRow {
  id: string;
  name: string;
  recipe: string;
  portion: string;
  price: string;
  includesService: boolean;
  net: string | null;
  portionCost: string | null;
  foodCost: string | null;
  band: 'good' | 'watch' | 'high' | null;
  target: string;
  suggested: string | null;
  suggestedFoodCost: string | null;
  grossProfit: string | null;
  problem: string | null;
}

export function menuRows(project: Project, v: VerifiedProject, lang: Lang): MenuRow[] {
  const rows: MenuRow[] = [];
  for (const item of project.menu.values()) {
    const vm = v.menu.get(item.id)!;
    const ok = vm.status === 'ok' ? vm : null;
    rows.push({
      id: item.id,
      name: item.name,
      recipe: project.recipes.get(item.recipeId)!.name,
      portion: `${formatQuantity(item.portionQty)} ${unitLabel(item.portionUnit, project, lang)}`,
      price: formatMoney(item.price),
      includesService: item.priceIncludesService,
      net: ok ? formatMoney(ok.netPrice) : null,
      portionCost: ok ? formatMoney(ok.portionCost) : null,
      foodCost: ok && ok.foodCost ? pct(ok.foodCost) : null,
      band: ok ? ok.band : null,
      target: pct(item.target),
      suggested: ok ? formatMoney(ok.suggestedPrice) : null,
      suggestedFoodCost: ok ? pct(ok.suggestedFoodCost) : null,
      grossProfit: ok && ok.grossProfit ? formatMoney(ok.grossProfit) : null,
      problem:
        vm.status === 'error'
          ? describeError(vm.error, lang, project)
          : vm.status === 'mismatch'
            ? T[lang].mismatch
            : null,
    });
  }
  return rows;
}

export function recipesCsv(
  project: Project,
  lang: Lang = 'en',
  v = verifiedProject(project),
): string {
  const t = T[lang];
  const zh = lang === 'zh-HK';
  const rows: string[][] = [
    zh
      ? ['食譜', '產出', '材料', '數量', '單位', '損耗', '成本', '佔比', '問題']
      : ['recipe', 'yield', 'item', 'qty', 'unit', 'waste', 'cost', 'share', 'problem'],
  ];
  for (const id of project.recipes.keys()) {
    const c = recipeCard(project, v, id, lang);
    for (const l of c.lines)
      rows.push([c.name, c.yieldText, l.name, l.qty, l.unit, l.waste, l.cost, l.share, '']);
    rows.push([
      c.name,
      c.yieldText,
      t.total,
      '',
      '',
      '',
      c.total ?? '',
      c.total ? '100.0%' : '',
      c.problem ?? '',
    ]);
  }
  rows.push([t.disclaimer]);
  return toCsv(rows, { bom: true });
}

export function menuCsv(project: Project, lang: Lang = 'en', v = verifiedProject(project)): string {
  const t = T[lang];
  const zh = lang === 'zh-HK';
  const rows: string[][] = [
    zh
      ? [
          '項目',
          '食譜',
          '份量',
          '售價',
          '已含服務費',
          '淨價',
          '每份成本',
          '食材成本率',
          '評級',
          '目標',
          '建議售價',
          '按建議售價成本率',
          '毛利',
          '問題',
        ]
      : [
          'item',
          'recipe',
          'portion',
          'price',
          'incl. service',
          'net price',
          'cost per portion',
          'food cost',
          'band',
          'target',
          'suggested price',
          'food cost at suggested',
          'gross profit',
          'problem',
        ],
  ];
  for (const r of menuRows(project, v, lang))
    rows.push([
      r.name,
      r.recipe,
      r.portion,
      r.price,
      r.includesService ? (zh ? '是' : 'yes') : zh ? '否' : 'no',
      r.net ?? '',
      r.portionCost ?? '',
      r.foodCost ?? '',
      r.band ? t[r.band] : '',
      r.target,
      r.suggested ?? '',
      r.suggestedFoodCost ?? '',
      r.grossProfit ?? '',
      r.problem ?? '',
    ]);
  rows.push([t.disclaimer]);
  return toCsv(rows, { bom: true });
}

/** The plain-text report printed by `saucepenny cost`. */
export function textReport(
  project: Project,
  lang: Lang = 'en',
  v = verifiedProject(project),
): string {
  const t = T[lang];
  const out: string[] = [
    `${lang === 'en' ? 'Saucepenny' : '菜本易 Saucepenny'} ${ENGINE_VERSION} · rules ${RULES_VERSION} · ${project.name}`,
    t.disclaimer,
    `${t.currency}: ${project.settings.currency}`,
    '',
    `== ${t.recipes} ==`,
  ];
  for (const id of project.recipes.keys()) {
    const c = recipeCard(project, v, id, lang);
    out.push('', `${c.name} (${t.yields} ${c.yieldText})`);
    if (c.problem) {
      out.push(`  ! ${c.problem}`);
      continue;
    }
    for (const l of c.lines)
      out.push(
        `  ${l.isRecipe ? '↳ ' : ''}${l.name}  ${l.qty} ${l.unit}${l.waste ? ` (+${l.waste} ${t.waste})` : ''}  ${l.cost}  ${l.share}`,
      );
    out.push(
      `  ${t.total} ${c.total} · ${t.per}${lang === 'en' ? ' ' : ''}${c.perUnitLabel} ${c.perUnit}`,
    );
  }
  out.push('', `== ${t.menu} ==`);
  for (const r of menuRows(project, v, lang)) {
    out.push('', `${r.name} (${r.recipe}, ${r.portion})`);
    if (r.problem) {
      out.push(`  ! ${r.problem}`);
      continue;
    }
    out.push(
      `  ${t.price} ${r.price}${r.includesService ? ` (${t.inclService}; ${t.net} ${r.net})` : ''} · ${t.cost} ${r.portionCost}`,
      `  ${t.foodCost} ${r.foodCost === null ? t.noPrice : `${r.foodCost} (${t[r.band!]})`}${r.grossProfit === null ? '' : ` · ${t.profit} ${r.grossProfit}`}`,
      `  ${t.target} ${r.target} → ${t.suggested} ${r.suggested} (${t.atSuggested} ${r.suggestedFoodCost})`,
    );
  }
  out.push('', t.rounding, '');
  return out.join('\n');
}

/** Plain-text price change impact for `saucepenny impact`. */
export function impactReport(
  project: Project,
  ingredientId: string,
  newPrice: Rational,
  lang: Lang = 'en',
): string {
  const t = T[lang];
  const ing = project.ingredients.get(ingredientId)!;
  const v = verifiedImpact(project, ingredientId, newPrice);
  const out = [
    `${t.impact}: ${ing.name} ${formatMoney(ing.price)} → ${formatMoney(newPrice)}`,
    t.disclaimer,
    '',
  ];
  if (v.status !== 'ok') out.push(`! ${t.mismatch}`);
  else if (v.rows.length === 0) out.push(t.noImpact);
  else
    for (const r of v.rows) {
      const sign = r.change.n > 0n ? '+' : '';
      const label = r.kind === 'recipe' ? t.recipeOne : t.menuOne;
      out.push(
        `${label} · ${r.name}: ${formatMoney(r.before)} → ${formatMoney(r.after)} (${sign}${formatMoney(r.change)})`,
      );
    }
  out.push('');
  return out.join('\n');
}
