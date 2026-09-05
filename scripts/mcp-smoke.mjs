#!/usr/bin/env node
/**
 * MCP smoke: daemon framing + mock server connect/list/call + client naming helpers.
 * Run: node scripts/mcp-smoke.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, callTool, disconnect } from '../daemon/mcp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mock = path.join(root, 'scripts/mock-mcp-server.mjs');
const fails = [];
const passes = [];
const ok = (n, d = '') => passes.push(d ? `${n}: ${d}` : n);
const fail = (n, d) => fails.push(`${n}: ${d}`);

function mcpNamespace(serverName, toolName) {
  const safeServer = String(serverName || 'server').replace(/[^a-zA-Z0-9_-]+/g, '_');
  const safeTool = String(toolName || 'tool').replace(/[^a-zA-Z0-9_-]+/g, '_');
  return 'mcp__' + safeServer + '__' + safeTool;
}

function parseMcpToolName(namespaced) {
  if (!namespaced.startsWith('mcp__')) return null;
  const rest = namespaced.slice('mcp__'.length);
  const i = rest.indexOf('__');
  if (i < 0) return null;
  return { server: rest.slice(0, i), tool: rest.slice(i + 2) };
}

// naming unit checks
const ns = mcpNamespace('filesystem', 'read_file');
if (ns !== 'mcp__filesystem__read_file') fail('namespace', ns);
else ok('namespace', ns);
const parsed = parseMcpToolName(ns);
if (!parsed || parsed.server !== 'filesystem' || parsed.tool !== 'read_file') fail('parse', JSON.stringify(parsed));
else ok('parse', JSON.stringify(parsed));
if (parseMcpToolName('read_file') !== null) fail('parse non-mcp', 'should be null');
else ok('parse non-mcp', 'null');

const id = 'smoke-mock';
try {
  const listed = await connect(
    { id, name: 'mock', command: process.execPath, args: [mock] },
    root,
  );
  const names = (listed.tools || []).map((t) => t.name).sort();
  if (!names.includes('echo') || !names.includes('add')) fail('tools/list', JSON.stringify(names));
  else ok('tools/list', names.join(', '));

  const echo = await callTool(id, 'echo', { message: 'hello-mcp' });
  if (!String(echo).includes('hello-mcp')) fail('tools/call echo', echo);
  else ok('tools/call echo', echo.trim());

  const sum = await callTool(id, 'add', { a: 2, b: 40 });
  if (String(sum).trim() !== '42') fail('tools/call add', sum);
  else ok('tools/call add', String(sum).trim());

  let threw = false;
  try {
    await callTool(id, 'nope', {});
  } catch {
    threw = true;
  }
  if (!threw) fail('unknown tool', 'did not throw');
  else ok('unknown tool', 'throws');
} catch (e) {
  fail('connect/run', e instanceof Error ? e.message : String(e));
} finally {
  try {
    await disconnect(id);
    ok('disconnect', 'ok');
  } catch (e) {
    fail('disconnect', e instanceof Error ? e.message : String(e));
  }
}

console.log('\n=== MCP smoke ===\n');
for (const p of passes) console.log('  ✓', p);
if (fails.length) {
  console.log('');
  for (const f of fails) console.log('  ✗', f);
  process.exit(1);
}
console.log('\nMCP smoke passed.');
process.exit(fails.length ? 1 : 0);
