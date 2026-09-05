#!/usr/bin/env node
/** Smoke for Build-mode protocol helpers (mirrors src/lib/agentHelpers.ts). */
import assert from 'node:assert/strict';

function parseTodoBullets(text) {
  const raw = text || '';
  const lines = raw.split(/\n/);
  const items = [];
  let inBlock = false;
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+?)\s*$/);
    const header = /^\s*(?:#{1,3}\s*)?(?:to[- ]?do|todo|plan|tasks?)\b/i.test(line);
    if (header) {
      inBlock = true;
      continue;
    }
    if (m) {
      const body = m[1].replace(/\*\*/g, '').trim();
      if (body.length >= 3 && body.length <= 200) {
        items.push(body);
        inBlock = true;
      }
      continue;
    }
    if (inBlock && items.length && line.trim() === '') {
      if (items.length >= 2) break;
      continue;
    }
    if (inBlock && items.length >= 2 && !m) break;
  }
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= 16) break;
  }
  return out.length >= 2 ? out : [];
}

function parseTodoItems(text) {
  return parseTodoBullets(text)
    .map((raw) => {
      const m = raw.match(/^\[([xX ])\]\s*(.*)$/);
      if (m) return { text: (m[2] || '').trim() || raw, done: m[1].toLowerCase() === 'x' };
      return { text: raw, done: false };
    })
    .filter((t) => t.text.length >= 3);
}

function formatTodoBlock(items) {
  return `ToDo:\n${items.map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}`).join('\n')}`;
}

function liftTodoListToContent(content, reasoning) {
  if (parseTodoItems(content).length) return content;
  const fromR = parseTodoItems(reasoning);
  if (!fromR.length) return content;
  const block = formatTodoBlock(fromR);
  const body = (content || '').trim();
  return body ? `${block}\n\n${body}` : block;
}

function looksBuildIntent(userText) {
  const t = (userText || '').trim().toLowerCase();
  if (!t) return false;
  if (/\bfile structure\b|\bfolder structure\b|\bproject skeleton\b|\bscaffold\b/.test(t)) return true;
  if (/\b(build|implement|bootstrap|wire up|set up|setup)\b/.test(t) && t.length >= 24) return true;
  return /\b(create|add|new)\b.{0,48}\b(file|folder|dir(?:ectory)?|module|app|feature|project|structure|layout|tree|skeleton)\b/.test(
    t,
  );
}

assert.equal(looksBuildIntent('hi'), false);
assert.ok(looksBuildIntent('Build a file structure for the new feature module'));
assert.ok(looksBuildIntent('scaffold the project skeleton then implement auth'));

const lifted = liftTodoListToContent(
  '',
  'Thinking...\nToDo:\n- [ ] Scaffold src/app dirs\n- [ ] Add router\n- [x] Wire tests\n',
);
assert.ok(lifted.startsWith('ToDo:'));
assert.ok(lifted.includes('Scaffold src/app dirs'));
const items = parseTodoItems(lifted);
assert.ok(items.length >= 2);
assert.equal(items[0].done, false);

console.log('build protocol ok');
