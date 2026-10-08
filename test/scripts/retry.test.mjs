// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { expectedSha256, fetchVerified, sha256, withRetry } from '../../scripts/lib/retry.mjs';

const noSleep = async () => {};
const payload = Buffer.from('pretend tarball');
const sums = `${'0'.repeat(64)}  other.tar.gz\n${sha256(payload)}  tool.tar.gz\n`;

/** A fake fetch that fails the first `failures` calls with a network reset. */
function flakyFetch(failures, { body = payload, status = 200 } = {}) {
  let calls = 0;
  const impl = async (url) => {
    calls++;
    if (calls <= failures) throw new Error('ECONNRESET');
    const data = url.endsWith('checksums.txt') ? Buffer.from(sums) : body;
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.length),
    };
  };
  return { impl, calls: () => calls };
}

const args = (fetchImpl, extra = {}) => ({
  fileUrl: 'https://example.invalid/tool.tar.gz',
  checksumsUrl: 'https://example.invalid/checksums.txt',
  fileName: 'tool.tar.gz',
  fetchImpl,
  sleep: noSleep,
  ...extra,
});

describe('download retry with checksum', () => {
  it('survives two network resets and returns verified bytes', async () => {
    const f = flakyFetch(2);
    const retries = [];
    const data = await fetchVerified(args(f.impl, { onRetry: (_e, i) => retries.push(i) }));
    expect(data.equals(payload)).toBe(true);
    expect(retries).toEqual([1, 2]);
  });

  it('gives up after the configured attempts with a clear error', async () => {
    const f = flakyFetch(99);
    await expect(fetchVerified(args(f.impl, { attempts: 3 }))).rejects.toThrow(
      /failed after 3 attempts: ECONNRESET/,
    );
    expect(f.calls()).toBe(3);
  });

  it('treats HTTP errors as failures (retried, then thrown)', async () => {
    const f = flakyFetch(0, { status: 502 });
    await expect(fetchVerified(args(f.impl, { attempts: 2 }))).rejects.toThrow(/HTTP 502/);
  });

  it('never accepts a tampered download', async () => {
    const f = flakyFetch(0, { body: Buffer.from('evil') });
    await expect(fetchVerified(args(f.impl, { attempts: 2 }))).rejects.toThrow(/SHA-256 mismatch/);
  });

  it('requires the exact file name in the checksum list', () => {
    expect(() => expectedSha256(sums, 'tool.tar')).toThrow(/no checksum/);
    expect(expectedSha256(sums, 'tool.tar.gz')).toBe(sha256(payload));
  });

  it('waits longer after each failure', async () => {
    const waits = [];
    let n = 0;
    await withRetry(
      async () => {
        if (++n < 3) throw new Error('x');
        return 1;
      },
      { delayMs: 10, sleep: async (ms) => waits.push(ms) },
    );
    expect(waits).toEqual([10, 20]);
  });

  it('rejects a nonsensical attempt count', async () => {
    await expect(withRetry(async () => 1, { attempts: 0 })).rejects.toThrow(/attempts/);
  });
});
