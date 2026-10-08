// SPDX-License-Identifier: AGPL-3.0-or-later
// Small invented projects for tests. All prices are made up.
import { emptyProject, type StoredProject } from '../../src/model/index';

export function sampleStored(): StoredProject {
  const p = emptyProject('測試茶餐廳');
  p.ingredients = [
    {
      id: 'pork',
      name: '梅頭肉',
      packQty: '1',
      packUnit: 'catty',
      price: '68',
      yieldPercent: '90',
    },
    { id: 'sugar', name: '砂糖', packQty: '1', packUnit: 'kg', price: '12' },
    { id: 'soy', name: '生抽', packQty: '500', packUnit: 'ml', price: '15', density: '1.2' },
    { id: 'egg', name: '雞蛋', packQty: '30', packUnit: 'piece', price: '45', pieceWeight: '55' },
    { id: 'lemon', name: '檸檬', packQty: '1', packUnit: 'piece', price: '4' },
    { id: 'tea', name: '紅茶葉', packQty: '1', packUnit: 'lb', price: '80' },
    { id: 'water', name: '水', packQty: '1', packUnit: 'l', price: '0' },
  ];
  p.recipes = [
    {
      id: 'syrup',
      name: '糖水',
      yieldQty: '1',
      yieldUnit: 'l',
      lines: [
        { ref: { kind: 'ingredient', id: 'sugar' }, qty: '500', unit: 'g' },
        { ref: { kind: 'ingredient', id: 'water' }, qty: '700', unit: 'ml' },
      ],
    },
    {
      id: 'charsiu',
      name: '叉燒',
      yieldQty: '10',
      yieldUnit: 'portion',
      lines: [
        { ref: { kind: 'ingredient', id: 'pork' }, qty: '2', unit: 'catty' },
        { ref: { kind: 'ingredient', id: 'soy' }, qty: '3', unit: 'tbsp' },
        { ref: { kind: 'recipe', id: 'syrup' }, qty: '200', unit: 'ml' },
      ],
    },
    {
      id: 'lemontea',
      name: '凍檸茶',
      yieldQty: '1',
      yieldUnit: 'portion',
      lines: [
        { ref: { kind: 'ingredient', id: 'tea' }, qty: '2', unit: 'tael', wastePercent: '5' },
        { ref: { kind: 'ingredient', id: 'lemon' }, qty: '0.5', unit: 'piece' },
        { ref: { kind: 'recipe', id: 'syrup' }, qty: '30', unit: 'ml' },
      ],
    },
  ];
  p.menu = [
    {
      id: 'm1',
      name: '叉燒飯',
      recipeId: 'charsiu',
      portionQty: '1',
      portionUnit: 'portion',
      price: '48',
      priceIncludesService: false,
      targetPercent: '30',
      rounding: 'ending-8',
    },
    {
      id: 'm2',
      name: '凍檸茶',
      recipeId: 'lemontea',
      portionQty: '1',
      portionUnit: 'portion',
      price: '22',
      priceIncludesService: true,
      targetPercent: '25',
      rounding: '1',
    },
  ];
  return p;
}

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
