#!/usr/bin/env node
/**
 * Pure-helper smoke tests for Phase 0/1 (no network, no daemon).
 * Run: node scripts/smoke-agent.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// Daemon pure helpers (CJS/ESM via node)
const { isInsideRoot } = await import(path.join(root, 'daemon/search.js'));
const { outlineFromText } = await import(path.join(root, 'daemon/outline.js'));
const { tokenizeQuery, semanticSearch } = await import(path.join(root, 'daemon/semantic.js'));

// Re-implement clamp/telemetry checks inline (TS sources; mirror agentHelpers)
function clampMaxAgentTurns(n) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 24;
  return Math.min(50, Math.max(1, Math.floor(v)));
}
function extractAtPins(text) {
  const out = [];
  const seen = new Set();
  const re = /(?:^|[\s])@([A-Za-z0-9_./+-][A-Za-z0-9_./+-]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let raw = (m[1] || '').replace(/[.,;:!?)]+$/, '');
    if (!raw || raw === '.' || raw === '..') continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}
function canResumeAfterTool(messages, messageId) {
  const toolMsg = messages.find((m) => m.id === messageId);
  if (!toolMsg || toolMsg.role !== 'tool') return false;
  const toolId = toolMsg.toolCallId || toolMsg.toolCall?.id || '';
  if (!toolId) return false;
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx < 0) return false;
  const assistant = messages[lastAssistantIdx];
  const ids = new Set((assistant.toolCalls || []).map((t) => t.id));
  if (!ids.has(toolId)) return false;
  const related = messages
    .slice(lastAssistantIdx + 1)
    .filter((m) => m.role === 'tool' && ids.has(m.toolCallId || m.toolCall?.id || ''));
  if (related.length < ids.size) return false;
  return related.every((m) => {
    const st = m.toolCall?.status;
    return st === 'executed' || st === 'error';
  });
}

assert.equal(clampMaxAgentTurns(12), 12);
assert.equal(clampMaxAgentTurns(0), 1);
assert.equal(clampMaxAgentTurns(999), 50);
assert.equal(clampMaxAgentTurns('24'), 24);
assert.equal(clampMaxAgentTurns(undefined), 24);

assert.equal(isInsideRoot('/workspace', '/workspace/src'), true);
assert.equal(isInsideRoot('/workspace', '/etc/passwd'), false);
assert.equal(isInsideRoot('/workspace', '/workspace/../etc'), false);

assert.deepEqual(extractAtPins('see @src/foo.ts and @daemon/'), ['src/foo.ts', 'daemon/']);

const outline = outlineFromText('src/x.ts', 'export function hello() {}\nexport class Foo {}\n');
assert.ok(outline.includes('function:hello'));
assert.ok(outline.includes('class:Foo'));

assert.ok(tokenizeQuery('find the ChatScreen agent loop').includes('chatscreen') || tokenizeQuery('find ChatScreen agent').length >= 1);

const msgs = [
  { id: 'a1', role: 'assistant', toolCalls: [{ id: 't1' }] },
  { id: 'm1', role: 'tool', toolCallId: 't1', toolCall: { id: 't1', status: 'allowed' } },
];
assert.equal(canResumeAfterTool(msgs, 'm1'), false);
msgs[1].toolCall.status = 'executed';
assert.equal(canResumeAfterTool(msgs, 'm1'), true);
assert.equal(canResumeAfterTool(msgs, 'nope'), false);

console.log('smoke-agent.mjs ok');
