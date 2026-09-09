#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-tool-args');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'npx',
  [
    'tsc',
    'src/lib/toolArgs.ts',
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
const { parseToolCallArguments } = await import(pathToFileURL(path.join(outDir, 'toolArgs.js')).href);

assert.deepEqual(parseToolCallArguments('{"path":"a.md","content":"hello"}'), {
  path: 'a.md',
  content: 'hello',
});

const truncated = '{"path":"prompts/docFront.md","content":"FRONT of the identity document\\nPreserve text"}';
const recovered = parseToolCallArguments(truncated.slice(0, truncated.lastIndexOf('"')) );
assert.equal(recovered.path, 'prompts/docFront.md');
assert.ok(String(recovered.content).includes('FRONT of the identity document'));

const aliased = parseToolCallArguments('{"file_path":"x.md","body":"y"}');
assert.equal(aliased.file_path, 'x.md');
assert.equal(aliased.body, 'y');

console.log('toolArgs ok');
fs.rmSync(outDir, { recursive: true, force: true });
