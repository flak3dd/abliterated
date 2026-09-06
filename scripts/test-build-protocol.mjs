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

function looksLargeJob(userText) {
  const t = (userText || '').trim();
  if (t.length < 80) return false;
  const lower = t.toLowerCase();
  if (
    /\b(implement|refactor|migrate|rewrite|overhaul|architecture|end[- ]to[- ]end|full(?:y)?|across|throughout|feature|subsystem|pipeline|integrate|audit then|plan then)\b/.test(
      lower,
    )
  ) {
    return true;
  }
  return t.length >= 320;
}

function looksMultiStep(userText) {
  const t = (userText || '').trim();
  if (t.length < 40) return false;
  const lower = t.toLowerCase();
  if (/\b(step[- ]?by[- ]?step|multi[- ]?step|implement|refactor|migrate|rewrite|build|create|add|fix|and then|then|first|next|finally)\b/.test(lower)) {
    return true;
  }
  return t.length >= 160;
}

function shouldApplyBuildProcess(userText, opts = {}) {
  if (opts.planMode) return false;
  const t = (userText || '').trim();
  if (!t) return false;
  if (looksBuildIntent(t) || looksLargeJob(t)) return true;
  if (!opts.buildMode) return false;
  if (looksTrivialFileEdit(t)) return false;
  if (looksMultiStep(t)) return true;
  return t.length >= 40;
}

function hasBuildFileWrites(toolsUsed) {
  if (!toolsUsed || !toolsUsed.length) return false;
  const set = new Set(['write_file', 'apply_patch', 'search_replace', 'edit_file', 'str_replace']);
  return toolsUsed.some((t) => set.has(String(t || '').toLowerCase()));
}

function looksLikeBuildOutput(text, toolsUsed) {
  if (hasBuildFileWrites(toolsUsed)) return true;
  const t = text || '';
  if (/```(?:diff|patch|bash|ts|tsx|js|jsx|mjs|cjs|py|go|rs|json|css|html|vue|svelte)/i.test(t)) return true;
  if (/^diff --git |^--- (a\/|\/dev\/null)|\+\+\+ b\//m.test(t)) return true;
  if (/^\/\/ [\w.\/+-]+\s*$/m.test(t) && t.length > 50) return true;
  return false;
}

function looksTrivialFileEdit(userText) {
  const t = (userText || '').trim();
  if (!t || t.length >= 120) return false;
  const lower = t.toLowerCase();
  if (/\b(scaffold|bootstrap|multi[- ]?file|whole\s+app|entire\s+(app|project)|project\s+skeleton|file\s+structure|folder\s+structure)\b/.test(lower)) return false;
  if (/\b(build\s+(a|an|the|me)\s+(app|project|website|site|system)|create\s+(a|an|the)\s+(app|project))\b/.test(lower)) return false;
  return /\b(edit|fix|wire|change|update|patch|typo|rename)\b/.test(lower);
}

assert.equal(looksBuildIntent('hi'), false);
assert.ok(looksBuildIntent('Build a file structure for the new feature module'));
assert.ok(looksBuildIntent('scaffold the project skeleton then implement auth'));

assert.equal(shouldApplyBuildProcess('hi'), false);
assert.equal(shouldApplyBuildProcess('thanks'), false);
assert.equal(shouldApplyBuildProcess('Build a file structure for the new feature module'), true);
assert.equal(shouldApplyBuildProcess('please implement the auth subsystem across the api'), true);
assert.equal(shouldApplyBuildProcess('hi', { planMode: true }), false);
assert.equal(shouldApplyBuildProcess('Build a file structure for the new feature module', { planMode: true }), false);
assert.ok(shouldApplyBuildProcess('Please add the missing tests for the parser module now.', { buildMode: true }));

function canonicalizeToolName(name) {
  const raw = (name || '').trim();
  if (!raw) return raw;
  const aliases = new Set(['todo', 'todos', 'todo_write', 'todowrite', 'todo_update', 'update_todo', 'create_todo']);
  if (aliases.has(raw.toLowerCase())) return 'todo';
  return raw;
}

assert.equal(canonicalizeToolName('ToDo'), 'todo');
assert.equal(canonicalizeToolName('todo_write'), 'todo');
assert.equal(canonicalizeToolName('TODO'), 'todo');
assert.equal(canonicalizeToolName('read_file'), 'read_file');

assert.equal(looksLikeBuildOutput('ToDo:\n- [ ] a\n- [ ] b'), false);
assert.ok(looksLikeBuildOutput('```diff\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n```'));

const lifted = liftTodoListToContent(
  '',
  'Thinking...\nToDo:\n- [ ] Scaffold src/app dirs\n- [ ] Add router\n- [x] Wire tests\n',
);
assert.ok(lifted.startsWith('ToDo:'));
assert.ok(lifted.includes('Scaffold src/app dirs'));
const items = parseTodoItems(lifted);
assert.ok(items.length >= 2);
assert.equal(items[0].done, false);

assert.equal(looksLikeBuildOutput('ToDo:\n- [ ] a\n- [ ] b', ['write_file']), true);
assert.equal(looksLikeBuildOutput('ToDo:\n- [ ] a\n- [ ] b', ['read_file']), false);
assert.equal(looksTrivialFileEdit('fix the typo in main.ts'), true);
assert.equal(looksTrivialFileEdit('scaffold the whole app project skeleton now'), false);
assert.equal(shouldApplyBuildProcess('fix the typo in main.ts', { buildMode: true }), false);
assert.ok(shouldApplyBuildProcess('Build a file structure for the new feature module', { buildMode: true }));

console.log('build protocol ok');
