#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-mempalace');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'npx',
  [
    'tsc',
    'src/lib/mempalace.ts',
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

const mod = await import(pathToFileURL(path.join(outDir, 'mempalace.js')).href);
const { mempalaceWingFor, withMempalaceMcpServer, formatSessionMemory, MEMPALACE_CATALOG_ENTRY } = mod;

assert.equal(mempalaceWingFor({ mempalaceWing: '' }, '/Users/adminuser/abliterated'), 'abliterated');
assert.equal(mempalaceWingFor({ mempalaceWing: 'Custom Wing' }, '/tmp/x'), 'Custom Wing');

const added = withMempalaceMcpServer([], true, '/tmp/palace');
assert.equal(added.length, 1);
assert.equal(added[0].name, 'mempalace');
assert.equal(added[0].enabled, true);
assert.equal(added[0].command, MEMPALACE_CATALOG_ENTRY.command);
assert.equal(added[0].env.MEMPALACE_PALACE_PATH, '/tmp/palace');

const off = withMempalaceMcpServer(added, false);
assert.equal(off[0].enabled, false);

const text = formatSessionMemory('what did we decide?', 'use relative paths', {
  model: 'abliterated-model',
  thread: 't1',
});
assert.match(text, /## User/);
assert.match(text, /what did we decide/);
assert.match(text, /relative paths/);
assert.equal(formatSessionMemory('', ''), '');

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-mempalace: ok');
