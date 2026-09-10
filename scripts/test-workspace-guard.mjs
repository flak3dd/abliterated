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
  BRIDGE_RESTARTING,
  WORKSPACE_REQUIRED,
  canonicalizePath,
  collapseDots,
  isInsideAppRoot,
  isPathInsideAppRoot,
  isSamePath,
  isTemporaryPath,
  isUnsetWorkspace,
  joinRoot,
  workspaceGate,
  shouldWriteWorkspaceFiles,
  connectedBridgeWriteRoot,
} = mod;

assert.equal(canonicalizePath('/private/tmp/ablit-smoke'), '/tmp/ablit-smoke');
assert.equal(canonicalizePath('/tmp/ablit-smoke'), '/tmp/ablit-smoke');
assert.equal(canonicalizePath('/private/var/folders/xyz'), '/var/folders/xyz');
assert.equal(isSamePath('/tmp/ablit-smoke', '/private/tmp/ablit-smoke'), true);
assert.equal(isSamePath('/tmp/ablit-smoke/', '/tmp/ablit-smoke'), true);
assert.equal(isSamePath('/Users/me/project', '/Users/me/project'), true);
assert.equal(isSamePath('/Users/me/project', '/Users/other/project'), false);
assert.equal(isSamePath('', ''), true);

assert.equal(isTemporaryPath('/tmp'), true);
assert.equal(isTemporaryPath('/tmp/ablit-smoke'), true);
assert.equal(isTemporaryPath('/private/tmp/ablit-smoke'), true);
assert.equal(isTemporaryPath('/private/var/folders/xx/yy'), true);
assert.equal(isTemporaryPath('C:\\Users\\me\\AppData\\Local\\Temp\\smoke'), true);
assert.equal(isTemporaryPath('/Users/me/project'), false);
assert.equal(isTemporaryPath(''), false);

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

assert.match(BRIDGE_RESTARTING, /hello/i);
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

assert.equal(
  connectedBridgeWriteRoot({
    workspaceRoot: '/Users/me/ui-stale',
    appRoot: '/Users/me/abliterated',
    bridgeRoot: '/Users/me/project',
  }),
  '/Users/me/project',
);
assert.equal(
  connectedBridgeWriteRoot({
    workspaceRoot: '/Users/me/project',
    appRoot: '/Users/me/abliterated',
    bridgeRoot: '/Users/me/abliterated',
  }),
  '/Users/me/project',
);
assert.equal(
  connectedBridgeWriteRoot({
    workspaceRoot: '',
    appRoot: '/Users/me/abliterated',
    bridgeRoot: '/Users/me/project',
  }),
  '/Users/me/project',
);
assert.equal(
  connectedBridgeWriteRoot({
    workspaceRoot: '',
    appRoot: '/Users/me/abliterated',
    bridgeRoot: '/Users/me/abliterated',
  }),
  '',
);
assert.equal(
  shouldWriteWorkspaceFiles({
    workspaceRoot: '',
    appRoot: '/Users/me/abliterated',
    connected: true,
    bridgeRoot: '/Users/me/project',
  }),
  true,
);

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-workspace-guard.mjs ok');
