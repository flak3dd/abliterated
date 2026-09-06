#!/usr/bin/env node
/** Unit smoke for reasoningWork — run: node scripts/test-reasoning-work.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-reasoning');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/reasoningWork.ts',
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
const mod = await import(pathToFileURL(path.join(outDir, 'reasoningWork.js')).href);
const { liftReasoningWork, reasoningLooksLikeStalledWork, buildReasoningOnlyNudge, stripImplementationFromText, splitReasoningSections, enforceThoughtNoCode, THOUGHT_CODE_MOVED_NOTE } = mod;

const fence = String.fromCharCode(96, 96, 96);
const script = [fence + 'bash', 'npm test', fence].join('\n');
const thinkThenScript = ['I will write a helper.', script].join('\n');
assert.equal(liftReasoningWork(thinkThenScript), script);
assert.ok(reasoningLooksLikeStalledWork(thinkThenScript));

const diff = '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,1 +1,2 @@\n keep\n+added\n';
assert.equal(liftReasoningWork(diff), diff.trim());
assert.ok(reasoningLooksLikeStalledWork(diff));

assert.equal(liftReasoningWork('just thinking about the problem'), '');
assert.equal(reasoningLooksLikeStalledWork('just thinking about the problem'), false);

assert.ok(reasoningLooksLikeStalledWork("I'll call list_dir on the root to show the workspace."));
assert.ok(typeof buildReasoningOnlyNudge() === 'string' && buildReasoningOnlyNudge().includes('tools channel'));

const planWithCode = [
  'Goal: add web_search.',
  '1. Inspect sse.ts',
  fence + 'diff',
  '--- a/src/lib/sse.ts',
  '+++ b/src/lib/sse.ts',
  '@@ -1,1 +1,2 @@',
  ' keep',
  '+added',
  fence,
  'Then stop.',
].join('\n');
const stripped = stripImplementationFromText(planWithCode);
assert.ok(stripped.includes('Goal: add web_search.'));
assert.ok(stripped.includes('1. Inspect sse.ts'));
assert.ok(!stripped.includes('+++ b/src/lib/sse.ts'));
assert.ok(!stripped.includes('```'));
assert.equal(stripImplementationFromText(diff), '');
assert.equal(stripImplementationFromText('just a plan bullet'), 'just a plan bullet');

const leakedFn = 'Goal: add helper.\nInspect: src/foo.ts\nfunction add(a, b) {\n  return a + b;\n}\nThen wire it.';
const leakedStripped = stripImplementationFromText(leakedFn);
assert.ok(leakedStripped.includes('Goal: add helper.'));
assert.ok(!leakedStripped.includes('function add'));
assert.ok(!leakedStripped.includes('return a + b'));

const unclosed = 'Inspect: bar.ts\n' + fence + 'ts\nconst x = 1;\n';
assert.ok(!stripImplementationFromText(unclosed).includes('const x'));

const bubble = {
  content: '',
  reasoning: 'Goal: patch sse.\n' + fence + 'diff\n--- a/src/lib/sse.ts\n+++ b/src/lib/sse.ts\n@@ -1,1 +1,2 @@\n keep\n+added\n' + fence + '\n',
};
assert.ok(enforceThoughtNoCode(bubble, { liftToContent: true }));
assert.ok((bubble.content || '').includes('+++ b/src/lib/sse.ts'));
assert.ok(!(bubble.reasoning || '').includes('+++ b/src/lib/sse.ts'));
assert.ok((bubble.reasoning || '').includes('Goal: patch sse.') || bubble.reasoning === THOUGHT_CODE_MOVED_NOTE);

const one = splitReasoningSections('just thinking about the problem');
assert.equal(one.length, 1);
assert.equal(one[0].title, 'Thought');

const labeled = splitReasoningSections('Goal: add search.\nInspect: sse.ts and agentTools.\nStep 1: wire the tool.\nStep 2: verify.');
assert.ok(labeled.length >= 3);
assert.equal(labeled[0].title, 'Goal');
assert.match(labeled[0].body, /add search/);
assert.ok(labeled.some((s) => s.title === 'Inspect' || s.title.startsWith('Step')));

const headed = splitReasoningSections('# Goal\nShip the dropdown.\n# Verify\nCheck chat.');
assert.equal(headed.length, 2);
assert.equal(headed[0].title, 'Goal');
assert.equal(headed[1].title, 'Verify');

console.log('reasoningWork ok');
fs.rmSync(outDir, { recursive: true, force: true });
