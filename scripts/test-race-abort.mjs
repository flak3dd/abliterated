#!/usr/bin/env node
/** Unit smoke for raceAbort — run: node scripts/test-race-abort.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-race-abort');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/raceAbort.ts',
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
const { raceAbort } = await import(pathToFileURL(path.join(outDir, 'raceAbort.js')).href);

const later = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

// Resolves normally when nothing aborts.
{
  const ac = new AbortController();
  assert.equal(await raceAbort(later(5, 'done'), ac.signal, () => 'fallback'), 'done');
}

// Already-aborted signal short-circuits without waiting.
{
  const ac = new AbortController();
  ac.abort();
  const started = Date.now();
  assert.equal(await raceAbort(later(500, 'slow'), ac.signal, () => 'fallback'), 'fallback');
  assert.ok(Date.now() - started < 200, 'aborted signal must not wait on the slow promise');
}

// Abort mid-flight stops the wait even though the RPC keeps running.
{
  const ac = new AbortController();
  const started = Date.now();
  setTimeout(() => ac.abort(), 10);
  assert.equal(await raceAbort(later(600, 'slow'), ac.signal, () => 'aborted'), 'aborted');
  assert.ok(Date.now() - started < 300, 'abort must not wait for the in-flight call');
}

// A late rejection from an abandoned promise must not surface as unhandled.
{
  let unhandled = null;
  process.on('unhandledRejection', (err) => {
    unhandled = err;
  });
  const ac = new AbortController();
  const doomed = new Promise((_, reject) => setTimeout(() => reject(new Error('late bridge error')), 20));
  setTimeout(() => ac.abort(), 5);
  assert.equal(await raceAbort(doomed, ac.signal, () => 'aborted'), 'aborted');
  await later(80);
  assert.equal(unhandled, null, `late rejection leaked: ${unhandled}`);
}

// Real (non-abort) rejections still propagate to the caller.
{
  const ac = new AbortController();
  await assert.rejects(
    () => raceAbort(Promise.reject(new Error('boom')), ac.signal, () => 'fallback'),
    /boom/,
  );
}

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-race-abort: ok');
