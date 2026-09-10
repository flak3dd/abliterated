#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-thread-io');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/threadMarkdown.ts',
    '--outDir',
    outDir,
    '--rootDir',
    'src',
    '--module',
    'esnext',
    '--target',
    'es2022',
    '--moduleResolution',
    'bundler',
    '--strict',
    '--skipLibCheck',
  ],
  { cwd: root, stdio: 'inherit' },
);

const { threadToMarkdown } = await import(pathToFileURL(path.join(outDir, 'lib/threadMarkdown.js')).href);
const md = threadToMarkdown(
  {
    id: 't1',
    title: 'Hello',
    model: 'qwen',
    pinned: false,
    systemPrompt: '',
    enabledTools: [],
    createdAt: 1,
    updatedAt: 2,
  },
  [
    { id: 'm1', threadId: 't1', role: 'user', content: 'Hi', createdAt: 1 },
    { id: 'm2', threadId: 't1', role: 'assistant', content: 'Hello back', createdAt: 2 },
  ],
);
assert.match(md, /# Hello/);
assert.match(md, /## User/);
assert.match(md, /Hi/);
assert.match(md, /## Assistant/);
fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-thread-io.mjs ok');
