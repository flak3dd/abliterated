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
  if (/\b(build|implement|bootstrap|wire\s+up|set\s+up|setup)\b/.test(t) && t.length >= 12) return true;
  return /\b(create|add|new)\b.{0,48}\b(file|folder|dir(?:ectory)?|module|app|feature|project|structure|layout|tree|skeleton)\b/.test(
    t,
  );
}

function looksReadOnlyOrControlPrompt(userText) {
  const t = (userText || '').trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  if (
    /\b(build|implement|scaffold|refactor|migrate|rewrite|overhaul|bootstrap|wire\s+up|create\s+.+\s+app)\b/.test(
      lower,
    ) ||
    looksBuildIntent(t)
  ) {
    return false;
  }
  if (
    /\bgit[_\s-]?status\b/.test(lower) ||
    /\b(git\s+status|show\s+status|repo\s+status|working\s+tree\s+status)\b/.test(lower)
  ) {
    return true;
  }
  if (/\b(run|start|launch|open)\s+(the\s+)?(app|server|dev\s*server|project)\b/.test(lower)) {
    return true;
  }
  if (
    /\b(summarize|summary|summarise)\b/.test(lower) ||
    /\b(list|show|print|dump)\s+(the\s+)?(files?|dirs?|directories|tree|contents?|status)\b/.test(lower) ||
    /^(list|ls|status|pwd|whoami|help)\b/.test(lower)
  ) {
    return true;
  }
  if (t.length < 40) {
    if (/\b(read|check|inspect|look|what|where|which|how|why|status|diff|log)\b/.test(lower)) {
      return true;
    }
    if (!/\b(build|create|add|fix|write|edit|delete|remove)\b/.test(lower)) {
      return true;
    }
  }
  return false;
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
  if (looksReadOnlyOrControlPrompt(t)) return false;
  if (looksBuildIntent(t) || looksLargeJob(t)) return true;
  if (!opts.buildMode) return false;
  if (looksMultiStep(t)) return true;
  return false;
}

function looksLikeBuildOutput(text) {
  const t = text || '';
  if (/```(?:diff|patch|bash|ts|tsx|js|jsx|mjs|cjs|py|go|rs|json|css|html|vue|svelte)/i.test(t)) return true;
  if (/^diff --git |^--- (a\/|\/dev\/null)|\+\+\+ b\//m.test(t)) return true;
  if (/^\/\/ [\w./+-]+\s*$/m.test(t) && t.length > 50) return true;
  return false;
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

// Read-only / inspect must stay false even when Build mode is on (never length-alone).
assert.equal(shouldApplyBuildProcess('git_status', { buildMode: true }), false);
assert.equal(shouldApplyBuildProcess('Run git_status and summarize the working tree.', { buildMode: true }), false);
assert.equal(shouldApplyBuildProcess('run app', { buildMode: true }), false);
assert.equal(shouldApplyBuildProcess('please run the app now', { buildMode: true }), false);
assert.equal(shouldApplyBuildProcess('short summarize', { buildMode: true }), false);
assert.equal(shouldApplyBuildProcess('summarize the current module briefly for me', { buildMode: true }), false);
assert.equal(shouldApplyBuildProcess('list the files in src', { buildMode: true }), false);
assert.equal(shouldApplyBuildProcess('status', { buildMode: true }), false);
assert.equal(looksReadOnlyOrControlPrompt('git_status'), true);
assert.equal(looksReadOnlyOrControlPrompt('run app'), true);
// Real build asks still trip the gate.
assert.equal(shouldApplyBuildProcess('build a web crawler', { buildMode: true }), true);
assert.equal(shouldApplyBuildProcess('Build a web crawler that scrapes product pages'), true);


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

console.log('build protocol ok');
