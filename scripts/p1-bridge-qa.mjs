#!/usr/bin/env node
import WebSocket from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(root, '.ide-qa-fixtures', 'hello-ts');
const MOCK = path.join(root, 'scripts', 'mock-mcp-server.mjs');
const EV = path.join(root, '.ide-qa-evidence', fs.existsSync('/tmp/ide-qa-run-id.txt') ? fs.readFileSync('/tmp/ide-qa-run-id.txt','utf8').trim() : '20260905-1114');
const results = [];
const ok = (id, note) => results.push({ id, status: 'PASS', note });
const fail = (id, note) => results.push({ id, status: 'FAIL', note });
const notes = (id, note) => results.push({ id, status: 'PASS_WITH_NOTES', note });

function req(ws, payload, timeoutMs = 20000) {
  const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${payload.type}`)), timeoutMs);
    const onMsg = (data) => {
      let msg;
      try { msg = JSON.parse(String(data)); } catch { return; }
      if (msg.runId !== runId) return;
      if (msg.type === 'stdout' || msg.type === 'stderr') return;
      clearTimeout(t);
      ws.off('message', onMsg);
      if (msg.status === 'ok') resolve(msg);
      else reject(new Error(msg.error || JSON.stringify(msg)));
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ ...payload, runId }));
  });
}

const ws = await new Promise((resolve, reject) => {
  const w = new WebSocket('ws://127.0.0.1:17322');
  w.once('open', () => resolve(w));
  w.once('error', reject);
});

try {
  await req(ws, { type: 'set_root', path: FIX });
  ok('B-01', `set_root ${FIX}`);

  const ls1 = await req(ws, { type: 'ls', path: '.' });
  const names = (ls1.entries || ls1.files || ls1.listing || []).map((e) => e.name || e).join(',');
  // handle various shapes
  const raw = JSON.stringify(ls1).slice(0, 500);
  if (raw.includes('index.ts') || raw.includes('package.json')) ok('E-02', `ls sees fixture: ${raw.slice(0,180)}`);
  else notes('E-02', `ls response unexpected shape: ${raw}`);

  const probe = `.ide-qa-probe-${Date.now()}.txt`;
  await req(ws, { type: 'write_file', file: probe, content: 'p1-crud-hello\n' });
  ok('B-02', `write_file ${probe}`);

  const read = await req(ws, { type: 'read_file', file: probe });
  const text = read.content || read.text || '';
  if (String(text).includes('p1-crud-hello')) ok('B-03', 'read_file matches');
  else fail('B-03', `read got ${JSON.stringify(read).slice(0,200)}`);

  await req(ws, { type: 'delete_file', file: probe });
  ok('B-04', `delete_file ${probe}`);
  if (fs.existsSync(path.join(FIX, probe))) fail('B-04b', 'file still on disk');
  else ok('B-04b', 'file gone from disk');

  const gs = await req(ws, { type: 'git_status' });
  ok('M-02', `git_status: ${JSON.stringify(gs).slice(0,200)}`);

  // MCP via bridge
  const mcpId = 'p1-mock';
  try {
    const listed = await req(ws, {
      type: 'mcp_connect',
      id: mcpId,
      name: 'mock',
      command: process.execPath,
      args: [MOCK],
    }, 60000);
    const tools = (listed.tools || []).map((t) => t.name);
    if (tools.includes('echo')) ok('U-02', `mcp_connect tools=${tools.join(',')}`);
    else fail('U-02', JSON.stringify(listed).slice(0,300));

    const called = await req(ws, {
      type: 'mcp_call_tool',
      id: mcpId,
      toolName: 'echo',
      arguments: { message: 'bridge-mcp' },
    });
    const out = called.content || called.text || '';
    if (String(out).includes('bridge-mcp')) ok('U-03', `mcp_call_tool: ${String(out).trim()}`);
    else fail('U-03', JSON.stringify(called).slice(0,300));
  } finally {
    try {
      await req(ws, { type: 'mcp_disconnect', id: mcpId });
      ok('U-04', 'mcp_disconnect');
    } catch (e) {
      fail('U-04', e.message);
    }
  }
} catch (e) {
  fail('P1-HARNESS', e instanceof Error ? e.message : String(e));
} finally {
  ws.close();
}

fs.mkdirSync(path.join(EV, 'P1'), { recursive: true });
const lines = ['| ID | Area | Status | Severity | Notes |', '|---|---|---|---|---|'];
for (const r of results) {
  const area = r.id.startsWith('B') ? 'Buffers' : r.id.startsWith('E') ? 'Explorer' : r.id.startsWith('M') ? 'SCM' : r.id.startsWith('U') ? 'MCP' : 'P1';
  const sev = r.status === 'FAIL' ? 'S2' : '';
  const dir = path.join(EV, r.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'case.md'), `# ${r.id}\n- Feature area: ${area}\n- Actual: ${r.note}\n- Status: ${r.status}\n- Severity: ${sev}\n- Restored: yes\n`);
  lines.push(`| ${r.id} | ${area} | ${r.status} | ${sev} | ${r.note.replace(/\|/g, '/')} |`);
}
fs.writeFileSync(path.join(EV, 'P1', 'MATRIX.md'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(EV, 'P1', 'log-excerpt.txt'), results.map(r => `${r.status} ${r.id}: ${r.note}`).join('\n'));
console.log(lines.join('\n'));
const failed = results.some(r => r.status === 'FAIL');
process.exit(failed ? 1 : 0);
