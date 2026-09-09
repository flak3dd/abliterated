#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-bridge-handshake');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));

execFileSync(
  'npx',
  [
    'tsc',
    'src/lib/bridgeClient.ts',
    '--outDir',
    outDir,
    '--rootDir',
    'src',
    '--module',
    'commonjs',
    '--esModuleInterop',
    '--target',
    'es2022',
    '--moduleResolution',
    'node',
    '--strict',
    '--skipLibCheck',
  ],
  { cwd: root, stdio: 'inherit' },
);

const {
  BRIDGE_HELLO_TIMEOUT_MS,
  BRIDGE_RPC_TIMEOUT_MS,
  BRIDGE_RESTARTING,
  BridgeClient,
} = createRequire(import.meta.url)(path.join(outDir, 'lib/bridgeClient.js'));

assert.equal(BRIDGE_HELLO_TIMEOUT_MS, 5000);
assert.equal(BRIDGE_RPC_TIMEOUT_MS, 45_000);
assert.match(BRIDGE_RESTARTING, /hello/);
assert.equal(typeof BridgeClient.prototype.reconnect, 'function');
assert.equal(typeof BridgeClient.prototype.connect, 'function');

const src = fs.readFileSync(path.join(root, 'src/lib/bridgeClient.ts'), 'utf8');
assert.match(src, /armHelloTimer/);
assert.match(src, /hello timeout/);
assert.match(src, /BRIDGE_RPC_TIMEOUT_MS/);
assert.match(src, /assertWritableWorkspace\(dirPath\)/);

const daemon = fs.readFileSync(path.join(root, 'daemon/bridge.js'), 'utf8');
assert.match(daemon, /assertWorkspaceNotInstall\('create_dir'\)/);
assert.match(daemon, /const abs = resolveInside\(raw\)/);

const electron = fs.readFileSync(path.join(root, 'electron/main.mjs'), 'utf8');
assert.match(electron, /bridgeEnsureLock/);
assert.match(electron, /already ours/);

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-bridge-handshake.mjs ok');
