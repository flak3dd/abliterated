#!/usr/bin/env node
/**
 * Integration test: per-write root pinning in daemon/bridge.js.
 * Spins up an isolated daemon on a test port (does not touch the user's daemon)
 * and proves a write pinned to an explicit root lands there regardless of the
 * daemon's mutable global ROOT. Run: node scripts/test-write-root.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, '..');
// realpath so ROOT (from ABLIT_ROOT) is canonical — macOS /var -> /private/var.
// Production always realpaths the root via set_root; env-set ROOT does not.
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ablit-write-root-')));
const dirA = path.join(tmp, 'globalRoot');
const dirB = path.join(tmp, 'pinnedRoot');
fs.mkdirSync(dirA, { recursive: true });
fs.mkdirSync(dirB, { recursive: true });

const PORT = 17399;
const daemon = spawn('node', ['daemon/bridge.js'], {
  cwd: repo,
  env: { ...process.env, ABLIT_PORT: String(PORT), ABLIT_ROOT: dirA },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const cleanup = () => {
  try { daemon.kill('SIGKILL'); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
};
process.on('exit', cleanup);

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    const t = setTimeout(() => reject(new Error('connect timeout')), 5000);
    ws.on('open', () => { clearTimeout(t); resolve(ws); });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

let seq = 0;
function rpc(ws, payload) {
  return new Promise((resolve, reject) => {
    const runId = `t${++seq}`;
    const timer = setTimeout(() => reject(new Error('rpc timeout ' + payload.type)), 5000);
    const onMsg = (buf) => {
      let msg;
      try { msg = JSON.parse(String(buf)); } catch { return; }
      if (msg.runId !== runId) return;
      clearTimeout(timer);
      ws.off('message', onMsg);
      resolve(msg);
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ ...payload, runId }));
  });
}

// Wait for the daemon to bind.
async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try { return await connect(); } catch { await new Promise((r) => setTimeout(r, 150)); }
  }
  throw new Error('daemon never came up');
}

let appRoot = '';
try {
  const ws = await waitReady();
  // Drain the hello (carries appRoot) — it has no runId.
  await new Promise((resolve) => {
    const onHello = (buf) => {
      let m;
      try { m = JSON.parse(String(buf)); } catch { return; }
      if (m.type === 'hello') { appRoot = m.appRoot || ''; ws.off('message', onHello); resolve(); }
    };
    ws.on('message', onHello);
    setTimeout(resolve, 500);
  });

  // Global ROOT is dirA (ABLIT_ROOT). A write pinned to dirB must land in dirB.
  const pinned = await rpc(ws, { type: 'write_file', file: 'pinned.txt', content: 'B', root: dirB });
  assert.equal(pinned.status, 'ok', 'pinned write should succeed: ' + JSON.stringify(pinned));
  assert.ok(fs.existsSync(path.join(dirB, 'pinned.txt')), 'file must land in the pinned root (dirB)');
  assert.ok(!fs.existsSync(path.join(dirA, 'pinned.txt')), 'file must NOT land in the global root (dirA)');

  // No root → falls back to the global ROOT (dirA).
  const global = await rpc(ws, { type: 'write_file', file: 'global.txt', content: 'A' });
  assert.equal(global.status, 'ok');
  assert.ok(fs.existsSync(path.join(dirA, 'global.txt')), 'unpinned write uses the global root');

  // Pinning at the install dir is refused.
  if (appRoot) {
    const refused = await rpc(ws, { type: 'write_file', file: 'x.txt', content: 'x', root: appRoot });
    assert.equal(refused.status, 'error', 'writing into the install dir must be refused');
  }

  // Path escape under a pinned root is refused.
  const escape = await rpc(ws, { type: 'write_file', file: '../escape.txt', content: 'x', root: dirB });
  assert.equal(escape.status, 'error', 'path escape (..) must be refused');
  assert.ok(!fs.existsSync(path.join(tmp, 'escape.txt')), 'escape write must not land above the root');

  ws.close();
  console.log('test-write-root: ok');
} finally {
  cleanup();
}
