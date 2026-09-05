#!/usr/bin/env node
/** Unit smoke for detokenizeArtifacts — run: node scripts/test-detokenize.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-detokenize');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'npx',
  [
    'tsc',
    'src/lib/detokenizeArtifacts.ts',
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

const mod = await import(pathToFileURL(path.join(outDir, 'detokenizeArtifacts.js')).href);
const { detokenizeArtifacts, looksLikeTokenSpill } = mod;

const G = '\u0120'; // Ġ
const C = '\u010a'; // Ċ
const U = '\u2581'; // ▁

// User-style GPT-2 BPE spill sample
const before = `${G}The${G}quick${G}brown${G}fox${C}${G}jumps${G}over${G}the${G}lazy${G}dog.${C}${G}Hello${G}world!`;
const after = detokenizeArtifacts(before);

assert.equal(after, ' The quick brown fox\n jumps over the lazy dog.\n Hello world!');
assert.ok(!after.includes(G), 'must not contain Ġ');
assert.ok(!after.includes(C), 'must not contain Ċ');
assert.match(after, /The quick brown fox/);
assert.match(after, /Hello world!/);

assert.equal(detokenizeArtifacts(`${U}hello${U}world`), ' hello world');
assert.equal(detokenizeArtifacts('clean text'), 'clean text');
assert.equal(detokenizeArtifacts(''), '');

assert.equal(looksLikeTokenSpill(before), true);
assert.equal(looksLikeTokenSpill('clean English without spill'), false);
assert.equal(looksLikeTokenSpill(`${G}a${G}b${G}c`), true); // ≥3

console.log('detokenizeArtifacts ok');
console.log('before:', JSON.stringify(before));
console.log('after:', JSON.stringify(after));
fs.rmSync(outDir, { recursive: true, force: true });
