// SPDX-License-Identifier: AGPL-3.0-or-later
// Local storage: the project lives in IndexedDB in this browser only. Small display
// settings and the backup reminder state live in localStorage. "Delete all data" removes both.

import { readBackupState, type BackupState } from './storage-guard';

const DB = 'saucepenny';
const STORE = 'kv';
const KEY = 'current';
export const SETTINGS_KEY = 'saucepenny-settings';
/** When the last backup file was saved and how many changes since (v0.2). */
export const BACKUP_KEY = 'saucepenny-backup';
/** supplier item name → ingredient id, remembered from supplier price-list imports */
export const SUPPLIER_MAP_KEY = 'saucepenny-supplier-map';

let cached: IDBDatabase | undefined;

function openDb(): Promise<IDBDatabase> {
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      cached = req.result;
      // Another tab deleting or upgrading the database: let go of it.
      cached.onversionchange = () => {
        cached?.close();
        cached = undefined;
      };
      resolve(cached);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

export async function loadState(): Promise<unknown> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    });
  } catch {
    return undefined; // private mode or storage disabled: start fresh
  }
}

/** Write the project. With the database already open, the write starts synchronously,
 * so a save started while the page is being closed still goes through. */
export function saveState(value: unknown): Promise<void> {
  const write = (db: IDBDatabase) =>
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    });
  try {
    const p = cached ? write(cached) : openDb().then(write);
    return p.catch(() => undefined); // storage is best effort; the page keeps working
  } catch {
    return Promise.resolve();
  }
}

export async function wipeAll(): Promise<void> {
  try {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(BACKUP_KEY);
    localStorage.removeItem(SUPPLIER_MAP_KEY);
  } catch {
    /* ignore */
  }
  cached?.close();
  cached = undefined;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

export interface Settings {
  lang?: string | undefined;
  theme?: string | undefined;
  large?: boolean | undefined;
  tab?: string | undefined;
}

export function loadSettings(): Settings {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Settings) : {};
  } catch {
    return {};
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function loadBackupState(): BackupState {
  try {
    return readBackupState(JSON.parse(localStorage.getItem(BACKUP_KEY) ?? 'null'));
  } catch {
    return readBackupState(null);
  }
}

export function saveBackupState(s: BackupState): void {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function loadSupplierMap(): Record<string, string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(SUPPLIER_MAP_KEY) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [k, id] of Object.entries(v as Record<string, unknown>))
      if (typeof id === 'string' && k.length <= 200 && id.length <= 100) out[k] = id;
    return out;
  } catch {
    return {};
  }
}

export function saveSupplierMap(m: Record<string, string>): void {
  try {
    // keep it small: at most 2000 remembered names
    const entries = Object.entries(m).slice(-2000);
    localStorage.setItem(SUPPLIER_MAP_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage full or blocked: matching by name still works */
  }
}
