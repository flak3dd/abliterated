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
    '--skipLibCheck',
  ],
  { cwd: root, stdio: 'inherit' },
);
const mod = await import(pathToFileURL(path.join(outDir, 'reasoningWork.js')).href);
const { liftReasoningWork, stripImplementationFromText, splitReasoningSections, enforceThoughtNoCode, THOUGHT_CODE_MOVED_NOTE, reasoningStepsNotExecuted, reasoningActionStepCount, contentHasExecution, buildReasoningExecuteNudge } = mod;

const fence = String.fromCharCode(96, 96, 96);
const script = [fence + 'bash', 'npm test', fence].join('\n');
const thinkThenScript = ['I will write a helper.', script].join('\n');
assert.equal(liftReasoningWork(thinkThenScript), script);

const diff = '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,1 +1,2 @@\n keep\n+added\n';
assert.equal(liftReasoningWork(diff), diff.trim());

assert.equal(liftReasoningWork('just thinking about the problem'), '');

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

// --- reasoningStepsNotExecuted: plan-in-reasoning but content only summarizes ---
const planReasoning =
  'Goal: build a hello world CLI.\nInspect: no existing files.\nStep 1: create cli.py with argparse.\nStep 2: edit README.md with usage.';

// TRUE POSITIVE: >=2 file-action steps in reasoning, content is a bare summary.
assert.equal(reasoningActionStepCount(planReasoning) >= 2, true);
assert.equal(reasoningStepsNotExecuted(planReasoning, 'DONE. Created cli.py and verified it.'), true);
assert.equal(contentHasExecution('DONE. Created cli.py and verified it.'), false);

// NEGATIVE: content actually carries execution (a fence / a // path file) — no nudge.
assert.equal(reasoningStepsNotExecuted(planReasoning, '```diff\n--- a/cli.py\n+++ b/cli.py\n@@ -0,0 +1 @@\n+x\n```'), false);
assert.equal(contentHasExecution('```python\nprint(1)\n```'), true);
assert.equal(contentHasExecution('// src/cli.py\nimport argparse\nprint("hi there world")\n'), true);

// NEGATIVE: fewer than 2 action steps (single ask / Q&A) — floor guards it.
assert.equal(reasoningStepsNotExecuted('Goal: create one file.\nStep 1: create cli.py.', 'Here you go.'), false);

// NEGATIVE: reasoning maps read-only steps (no file-producing verb) — not an execution gap.
assert.equal(
  reasoningStepsNotExecuted('Step 1: read the auth module.\nStep 2: verify my understanding.', 'It uses JWTs.'),
  false,
);

// NEGATIVE: empty reasoning.
assert.equal(reasoningStepsNotExecuted('', 'anything'), false);

// Stateful-regex guard: calling contentHasExecution twice on a fenced string must be stable.
const fenced = '```ts\nexport const n = 1;\n```';
assert.equal(contentHasExecution(fenced), true);
assert.equal(contentHasExecution(fenced), true);

assert.ok(buildReasoningExecuteNudge().includes('did not carry them out'));

console.log('reasoningWork ok');
fs.rmSync(outDir, { recursive: true, force: true });
