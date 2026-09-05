#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-memory');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'npx',
  [
    'tsc',
    'src/lib/projectMemory.ts',
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
const mod = await import(pathToFileURL(path.join(outDir, 'projectMemory.js')).href);
const { formatProjectMemoryPrompt, formatAutoLoadedSkillsPrompt, clipText } = mod;

assert.equal(formatProjectMemoryPrompt([]), '');
const block = formatProjectMemoryPrompt([{ path: 'AGENTS.md', text: 'Use relative paths only.' }]);
assert.match(block, /Project conventions/);
assert.match(block, /AGENTS\.md/);
assert.match(block, /relative paths/);

assert.equal(formatAutoLoadedSkillsPrompt([]), '');
assert.equal(
  formatAutoLoadedSkillsPrompt([{ id: 'x', name: 'X', description: 'd', path: '', body: 'b', source: 'bundled' }]),
  '',
);
const ws = formatAutoLoadedSkillsPrompt([
  { id: 'review', name: 'Review', description: 'When reviewing', path: '', body: '1. Read diffs\n2. Test', source: 'workspace' },
]);
assert.match(ws, /Workspace skills/);
assert.match(ws, /review/);
assert.match(ws, /Read diffs/);
assert.ok(clipText('abcd', 3).startsWith('abc'));

fs.rmSync(outDir, { recursive: true, force: true });
console.log('projectMemory format ok');
