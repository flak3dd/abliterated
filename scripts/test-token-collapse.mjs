#!/usr/bin/env node
/** Unit smoke for tokenCollapse — run: node scripts/test-token-collapse.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-token-collapse');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/tokenCollapse.ts',
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
const {
  looksLikeTokenCollapse,
  looksLikeStubAnswer,
  shouldAbortTokenCollapse,
  stripCollapsedText,
  TOKEN_COLLAPSE_REPLY_NOTE,
} = await import(pathToFileURL(path.join(outDir, 'tokenCollapse.js')).href);

assert.equal(looksLikeTokenCollapse(''), false);
assert.equal(looksLikeTokenCollapse('4'), false);
assert.equal(looksLikeTokenCollapse('What is 2+2?'), false);
assert.equal(looksLikeTokenCollapse('Wow!!!'), false);
assert.equal(looksLikeTokenCollapse('if (ready && !done) return;'), false);
assert.equal(
  looksLikeTokenCollapse('Title\n============\nBody text here is a real markdown heading rule.'),
  false,
);
assert.equal(looksLikeTokenCollapse('****'.repeat(8) + '\ncode sample'), false);
assert.equal(looksLikeTokenCollapse('='.repeat(48)), true);

const bangs = '!'.repeat(48);
assert.equal(looksLikeTokenCollapse(bangs), true);
assert.equal(looksLikeTokenCollapse(bangs + bangs), true);
assert.equal(looksLikeTokenCollapse(('! '.repeat(40)).trim()), true);
assert.equal(looksLikeTokenCollapse('x'.repeat(40)), true);

assert.equal(shouldAbortTokenCollapse(bangs, ''), true);
assert.equal(shouldAbortTokenCollapse('', bangs), true);
assert.equal(shouldAbortTokenCollapse('4', bangs), false);
assert.equal(shouldAbortTokenCollapse('The answer is 4.', ''), false);

assert.equal(stripCollapsedText(bangs), '');
assert.equal(stripCollapsedText('4'), '4');
assert.equal(stripCollapsedText('4' + '!'.repeat(20)), '4');
assert.equal(looksLikeStubAnswer('I'), true);
assert.equal(looksLikeStubAnswer('4'), false);
assert.equal(looksLikeStubAnswer('OK'), false);
assert.equal(shouldAbortTokenCollapse('I', bangs), true);
assert.ok(TOKEN_COLLAPSE_REPLY_NOTE.includes('degenerated'));

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-token-collapse.mjs ok');
