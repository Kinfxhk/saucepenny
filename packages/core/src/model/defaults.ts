// SPDX-License-Identifier: AGPL-3.0-or-later
import { PROJECT_SCHEMA, PROJECT_VERSION, type StoredProject, type StoredSettings } from './types';

export const DEFAULT_SETTINGS: Readonly<StoredSettings> = Object.freeze({
  currency: 'HKD',
  serviceChargePercent: '10',
  goodPercent: '30',
  highPercent: '35',
});

export function emptyProject(name = 'My kitchen'): StoredProject {
  return {
    schema: PROJECT_SCHEMA,
    version: PROJECT_VERSION,
    name,
    settings: { ...DEFAULT_SETTINGS },
    measures: [],
    ingredients: [],
    recipes: [],
    menu: [],
  };
}
