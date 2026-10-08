#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Download a pinned tool release with retries and SHA-256 verification.
// Usage: node scripts/fetch-verified.mjs gitleaks   (writes the tarball to the current dir)
// GITLEAKS_VERSION (default 8.30.1) selects the version. Linux x64 only (CI).
import { writeFileSync } from 'node:fs';
import { fetchVerified } from './lib/retry.mjs';

const tool = process.argv[2];
if (tool !== 'gitleaks') {
  console.error('Usage: node scripts/fetch-verified.mjs gitleaks');
  process.exit(2);
}
const version = process.env.GITLEAKS_VERSION ?? '8.30.1';
const base = `https://github.com/gitleaks/gitleaks/releases/download/v${version}`;
const fileName = `gitleaks_${version}_linux_x64.tar.gz`;
const data = await fetchVerified({
  fileUrl: `${base}/${fileName}`,
  checksumsUrl: `${base}/gitleaks_${version}_checksums.txt`,
  fileName,
  onRetry: (err, i) => console.warn(`attempt ${i} failed (${err.message}); retrying...`),
});
writeFileSync(fileName, data);
console.info(`downloaded and verified ${fileName} (${data.length} bytes)`);
