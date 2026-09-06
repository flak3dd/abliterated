#!/usr/bin/env node
/** Unit smoke for workspaceGuard — run: node scripts/test-workspace-guard.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-workspace-guard');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'npx',
  [
    'tsc',
    'src/lib/workspaceGuard.ts',
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
const mod = await import(pathToFileURL(path.join(outDir, 'workspaceGuard.js')).href);
const {
  APP_ROOT_REFUSED,
  WORKSPACE_REQUIRED,
  collapseDots,
  isInsideAppRoot,
  isPathInsideAppRoot,
  isUnsetWorkspace,
  joinRoot,
  workspaceGate,
  shouldWriteWorkspaceFiles,
} = mod;

assert.equal(isUnsetWorkspace(''), true);
assert.equal(isUnsetWorkspace('/workspace'), true);
assert.equal(isUnsetWorkspace('.'), true);
assert.equal(isUnsetWorkspace('/Users/me/project'), false);

assert.equal(collapseDots('/Users/me/../me/project/.'), '/Users/me/project');
assert.equal(isInsideAppRoot('/Users/me/abliterated', '/Users/me/abliterated'), true);
assert.equal(isInsideAppRoot('/Users/me/abliterated', '/Users/me/abliterated/src/App.tsx'), true);
assert.equal(isInsideAppRoot('/Users/me/abliterated', '/Users/me/other'), false);
assert.equal(isInsideAppRoot('/Users/me/abliterated', '/Users/me'), false);

assert.equal(joinRoot('/Users/me/project', 'src/foo.ts'), '/Users/me/project/src/foo.ts');
assert.equal(isPathInsideAppRoot('src/App.tsx', '/Users/me/abliterated', '/Users/me/abliterated'), true);
assert.equal(isPathInsideAppRoot('src/App.tsx', '/Users/me/project', '/Users/me/abliterated'), false);
assert.equal(
  isPathInsideAppRoot('/Users/me/abliterated/src/App.tsx', '/Users/me', '/Users/me/abliterated'),
  true,
);

assert.equal(workspaceGate('', '/Users/me/abliterated').ok, false);
assert.equal(workspaceGate('', '/Users/me/abliterated').message, WORKSPACE_REQUIRED);
assert.equal(workspaceGate('/Users/me/abliterated', '/Users/me/abliterated').ok, false);
assert.equal(workspaceGate('/Users/me/abliterated', '/Users/me/abliterated').message, APP_ROOT_REFUSED);
assert.equal(workspaceGate('/Users/me/abliterated/src', '/Users/me/abliterated').reason, 'app_root');
assert.equal(workspaceGate('/Users/me/project', '/Users/me/abliterated').ok, true);

assert.equal(
  shouldWriteWorkspaceFiles({
    workspaceRoot: '/Users/me/project',
    appRoot: '/Users/me/abliterated',
    connected: true,
  }),
  true,
);
assert.equal(
  shouldWriteWorkspaceFiles({
    planMode: true,
    workspaceRoot: '/Users/me/project',
    appRoot: '/Users/me/abliterated',
    connected: true,
  }),
  false,
);
assert.equal(
  shouldWriteWorkspaceFiles({
    workspaceRoot: '/Users/me/project',
    connected: false,
  }),
  false,
);

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-workspace-guard.mjs ok');
