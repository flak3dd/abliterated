#!/usr/bin/env node
/** Unit smoke for urlSafety — run: node scripts/test-url-safety.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-url-safety');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'npx',
  [
    'tsc',
    'src/lib/urlSafety.ts',
    '--outDir',
    outDir,
    '--module',
    'esnext',
    '--target',
    'es2022',
    '--moduleResolution',
    'bundler',
    '--strict',
  ],
  { cwd: root, stdio: 'inherit' },
);
const mod = await import(pathToFileURL(path.join(outDir, 'urlSafety.js')).href);
const { isBlockedFetchHostname, assertSafeFetchUrl } = mod;

assert.equal(isBlockedFetchHostname('127.0.0.1'), true);
assert.equal(isBlockedFetchHostname('127.0.0.2'), true);
assert.equal(isBlockedFetchHostname('localhost'), true);
assert.equal(isBlockedFetchHostname('::1'), true);
assert.equal(isBlockedFetchHostname('[::1]'), true);
assert.equal(isBlockedFetchHostname('10.0.0.5'), true);
assert.equal(isBlockedFetchHostname('192.168.1.1'), true);
assert.equal(isBlockedFetchHostname('172.16.0.1'), true);
assert.equal(isBlockedFetchHostname('172.31.255.255'), true);
assert.equal(isBlockedFetchHostname('172.32.0.1'), false);
assert.equal(isBlockedFetchHostname('169.254.169.254'), true);
assert.equal(isBlockedFetchHostname('::ffff:127.0.0.1'), true);
assert.equal(isBlockedFetchHostname('::ffff:8.8.8.8'), false);
assert.equal(isBlockedFetchHostname('metadata.google.internal'), true);
assert.equal(isBlockedFetchHostname('foo.local'), true);
assert.equal(isBlockedFetchHostname('example.com'), false);
assert.equal(isBlockedFetchHostname('8.8.8.8'), false);

assert.equal(assertSafeFetchUrl('https://example.com/a').ok, true);
assert.equal(assertSafeFetchUrl('http://192.168.0.1/').ok, false);
assert.equal(assertSafeFetchUrl('file:///etc/passwd').ok, false);
assert.equal(assertSafeFetchUrl('https://user:pass@example.com/').ok, false);
assert.equal(assertSafeFetchUrl('not a url').ok, false);
assert.match(assertSafeFetchUrl('http://127.0.0.1/').reason, /local or private/);

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-url-safety: ok');
