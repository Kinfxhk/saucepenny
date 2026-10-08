// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Download with retries and SHA-256 verification (no dependencies). Used by CI to fetch
// pinned tools such as gitleaks. A dropped connection is retried; a checksum mismatch is
// never "fixed" by a retry of the same bytes: every attempt re-downloads and re-verifies,
// and after the last attempt the error is thrown so the job fails loudly.

import { createHash } from 'node:crypto';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run `fn` up to `attempts` times, waiting `delayMs * attemptNumber` between tries. */
export async function withRetry(
  fn,
  { attempts = 5, delayMs = 3000, sleep = defaultSleep, onRetry = () => {} } = {},
) {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error('attempts must be >= 1');
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn(i);
    } catch (err) {
      lastError = err;
      if (i < attempts) {
        onRetry(err, i);
        await sleep(delayMs * i);
      }
    }
  }
  throw new Error(`failed after ${attempts} attempts: ${lastError?.message ?? lastError}`, {
    cause: lastError,
  });
}

/** Fetch a URL to a Buffer; non-2xx statuses are errors (so they are retried). */
export async function fetchBuffer(url, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Find the expected SHA-256 for `fileName` in a `sha256sum`-style checksums file. */
export function expectedSha256(checksumsText, fileName) {
  for (const line of String(checksumsText).split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/i.exec(line.trim());
    if (m && m[2] === fileName) return m[1].toLowerCase();
  }
  throw new Error(`no checksum listed for ${fileName}`);
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Download `fileUrl` and verify it against the entry for `fileName` in `checksumsUrl`.
 * Returns the verified bytes. Each attempt downloads both files again.
 */
export async function fetchVerified({ fileUrl, checksumsUrl, fileName, fetchImpl, ...retry }) {
  return withRetry(async () => {
    const sums = (await fetchBuffer(checksumsUrl, fetchImpl)).toString('utf8');
    const want = expectedSha256(sums, fileName);
    const data = await fetchBuffer(fileUrl, fetchImpl);
    const got = sha256(data);
    if (got !== want) throw new Error(`SHA-256 mismatch for ${fileName}: ${got} != ${want}`);
    return data;
  }, retry);
}
