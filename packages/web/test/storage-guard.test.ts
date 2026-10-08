// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_BACKUP,
  ensurePersisted,
  noteBackup,
  noteChange,
  readBackupState,
  REMIND_CHANGES,
  REMIND_DAYS,
  reminderDue,
  snooze,
  SNOOZE_DAYS,
  type BackupState,
} from '../src/storage-guard';

const DAY = 86_400_000;
const T = Date.parse('2026-10-08T00:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('ensurePersisted', () => {
  it('reports unsupported when the browser has no storage manager or no persist()', async () => {
    expect(await ensurePersisted(undefined)).toBe('unsupported');
    expect(await ensurePersisted({})).toBe('unsupported');
  });
  it('does not ask again when already kept', async () => {
    const persist = vi.fn(async () => true);
    expect(await ensurePersisted({ persisted: async () => true, persist })).toBe('persisted');
    expect(persist).not.toHaveBeenCalled();
  });
  it('asks, and reports the browser’s answer', async () => {
    expect(await ensurePersisted({ persisted: async () => false, persist: async () => true })).toBe(
      'persisted',
    );
    expect(
      await ensurePersisted({ persisted: async () => false, persist: async () => false }),
    ).toBe('not-persisted');
    expect(await ensurePersisted({ persist: async () => true })).toBe('persisted');
  });
  it('a throwing browser is "not kept", never a crash', async () => {
    expect(
      await ensurePersisted({
        persisted: async () => {
          throw new Error('SecurityError');
        },
        persist: async () => true,
      }),
    ).toBe('not-persisted');
    expect(
      await ensurePersisted({
        persist: () => Promise.reject(new Error('no')),
      }),
    ).toBe('not-persisted');
  });
});

describe('backup reminder', () => {
  const changed = (n: number, at = T): BackupState => {
    let s: BackupState = { ...EMPTY_BACKUP };
    for (let i = 0; i < n; i++) s = noteChange(s, iso(at));
    return s;
  };
  it('never shows with nothing to lose', () => {
    expect(reminderDue(changed(0), T + 100 * DAY, true)).toBe(false);
    expect(reminderDue(changed(50), T, false)).toBe(false);
  });
  it(`shows after ${REMIND_CHANGES} changes`, () => {
    expect(reminderDue(changed(REMIND_CHANGES - 1), T, true)).toBe(false);
    expect(reminderDue(changed(REMIND_CHANGES), T, true)).toBe(true);
  });
  it(`shows ${REMIND_DAYS} days after the first unsaved change`, () => {
    const s = changed(1);
    expect(reminderDue(s, T + REMIND_DAYS * DAY - 1, true)).toBe(false);
    expect(reminderDue(s, T + REMIND_DAYS * DAY, true)).toBe(true);
  });
  it('a backup clears it', () => {
    const s = noteBackup(iso(T));
    expect(s.changes).toBe(0);
    expect(reminderDue(s, T + 365 * DAY, true)).toBe(false);
  });
  it(`"Not now" keeps it quiet for ${SNOOZE_DAYS} days or ${REMIND_CHANGES} more changes`, () => {
    let s = snooze(changed(REMIND_CHANGES), iso(T));
    expect(reminderDue(s, T + DAY, true)).toBe(false);
    expect(reminderDue(s, T + SNOOZE_DAYS * DAY, true)).toBe(true);
    for (let i = 0; i < REMIND_CHANGES; i++) s = noteChange(s, iso(T));
    expect(reminderDue(s, T + DAY, true)).toBe(true);
  });
  it('a snooze time in the future (clock changed) does not silence it forever', () => {
    const s = snooze(changed(REMIND_CHANGES), iso(T + 400 * DAY));
    expect(reminderDue(s, T, true)).toBe(true);
  });
  it('property: once due, it stays due until a backup or a snooze', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        (n, d1, d2) => {
          const s = changed(n);
          if (reminderDue(s, T + d1 * DAY, true))
            expect(reminderDue(noteChange(s, iso(T)), T + (d1 + d2) * DAY, true)).toBe(true);
        },
      ),
    );
  });
  it('stored state is read defensively', () => {
    expect(readBackupState(null)).toEqual(EMPTY_BACKUP);
    expect(readBackupState({ changes: -3, lastAt: 'yesterday', snoozedChanges: 1.5 })).toEqual(
      EMPTY_BACKUP,
    );
    expect(readBackupState({ changes: 4, lastAt: iso(T), extra: 1 })).toEqual({
      ...EMPTY_BACKUP,
      changes: 4,
      lastAt: iso(T),
    });
  });
});
