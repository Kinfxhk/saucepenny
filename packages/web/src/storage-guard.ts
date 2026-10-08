// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeping local data safe: ask the browser to keep this site's storage (so it is not
// cleared automatically when the device runs low on space), and remind the user now and
// then to save a backup file. Nothing here uses the network.

export type PersistStatus = 'persisted' | 'not-persisted' | 'unsupported';

export interface StorageLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

/**
 * Ask once for persistent storage. Browsers may say no (Chrome decides by how the site is
 * used; Safari may not ask at all); that is reported, never treated as an error.
 */
export async function ensurePersisted(storage: StorageLike | undefined): Promise<PersistStatus> {
  if (!storage || typeof storage.persist !== 'function') return 'unsupported';
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return 'persisted';
    return (await storage.persist()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'not-persisted';
  }
}

export interface BackupState {
  /** ISO time of the last backup file saved from this device ('' = never). */
  lastAt: string;
  /** Changes saved since then. */
  changes: number;
  /** ISO time of the first change since the last backup ('' = none). */
  firstChangeAt: string;
  /** ISO time the reminder was last dismissed ('' = never). */
  snoozedAt: string;
  /** `changes` when it was dismissed. */
  snoozedChanges: number;
}

export const EMPTY_BACKUP: Readonly<BackupState> = Object.freeze({
  lastAt: '',
  changes: 0,
  firstChangeAt: '',
  snoozedAt: '',
  snoozedChanges: 0,
});

/** Remind after this many changes, or this many days after the first unsaved change. */
export const REMIND_CHANGES = 20;
export const REMIND_DAYS = 14;
/** After "Not now", stay quiet for this many days or this many more changes. */
export const SNOOZE_DAYS = 7;

const DAY = 86_400_000;
const ms = (iso: string) => (iso ? Date.parse(iso) : NaN);

/** Keep only well-formed values from stored data. */
export function readBackupState(raw: unknown): BackupState {
  const s: BackupState = { ...EMPTY_BACKUP };
  if (typeof raw !== 'object' || raw === null) return s;
  const r = raw as Record<string, unknown>;
  for (const k of ['lastAt', 'firstChangeAt', 'snoozedAt'] as const)
    if (typeof r[k] === 'string' && !Number.isNaN(Date.parse(r[k]))) s[k] = r[k];
  for (const k of ['changes', 'snoozedChanges'] as const)
    if (Number.isSafeInteger(r[k]) && (r[k] as number) >= 0) s[k] = r[k] as number;
  return s;
}

export function noteChange(s: BackupState, nowIso: string): BackupState {
  return {
    ...s,
    changes: s.changes + 1,
    firstChangeAt: s.changes === 0 ? nowIso : s.firstChangeAt,
  };
}

export function noteBackup(nowIso: string): BackupState {
  return { ...EMPTY_BACKUP, lastAt: nowIso };
}

export function snooze(s: BackupState, nowIso: string): BackupState {
  return { ...s, snoozedAt: nowIso, snoozedChanges: s.changes };
}

/** Should the reminder show now? Only when there is something not yet backed up. */
export function reminderDue(s: BackupState, nowMs: number, hasData: boolean): boolean {
  if (!hasData || s.changes <= 0) return false;
  const since = ms(s.firstChangeAt);
  const due =
    s.changes >= REMIND_CHANGES || (!Number.isNaN(since) && nowMs - since >= REMIND_DAYS * DAY);
  if (!due) return false;
  const snoozed = ms(s.snoozedAt);
  if (!Number.isNaN(snoozed) && nowMs - snoozed < SNOOZE_DAYS * DAY && nowMs >= snoozed)
    return s.changes - s.snoozedChanges >= REMIND_CHANGES;
  return true;
}
