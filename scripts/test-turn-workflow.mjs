#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-turn-workflow');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'npx',
  [
    'tsc',
    'src/lib/turnWorkflow.ts',
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
const mod = await import(pathToFileURL(path.join(outDir, 'turnWorkflow.js')).href);
const {
  buildTurnPlan,
  buildTurnSteps,
  planRangeForStep,
  kindForRun,
  syncStepsFromRun,
  collectTurnFiles,
} = mod;

const pins = ['src/lib/sse.ts', 'docs/APP.md'];
const plan = buildTurnPlan('fix the chat stream parser', pins);
assert.ok(plan.length >= 4);
assert.equal(plan[0].id, 'plan-read');
assert.ok(plan.some((p) => p.label.includes('sse.ts')));
assert.ok(plan.some((p) => p.label.startsWith('Revise')));
assert.equal(buildTurnPlan('write individual prompts for KYC', [], { promptOnly: true })[1].label, 'Write prompt files');

const steps = buildTurnSteps('fix the chat stream parser', pins);
assert.equal(steps.length, 4);
assert.deepEqual(steps.map((s) => s.kind), ['plan', 'edit', 'check', 'done']);
assert.ok(steps[0].log[0].startsWith('intent:'));

assert.deepEqual(planRangeForStep('plan', 2), [0, 1]);
assert.deepEqual(planRangeForStep('edit', 2), [1, 3]);
assert.deepEqual(planRangeForStep('check', 2), [3, 4]);
assert.deepEqual(planRangeForStep('done', 2), [4, 5]);

assert.equal(kindForRun({ phase: 'reasoning', toolsUsed: [] }), 'plan');
assert.equal(kindForRun({ phase: 'tool_exec', toolsUsed: ['read_file'] }), 'plan');
assert.equal(kindForRun({ phase: 'tool_exec', toolsUsed: ['write_file'] }), 'edit');
assert.equal(kindForRun({ phase: 'waiting_gate', toolsUsed: ['write_file'] }), 'edit');
assert.equal(kindForRun({ phase: 'tool_exec', toolsUsed: ['verify'] }), 'check');
assert.equal(kindForRun({ phase: 'finishing', toolsUsed: ['write_file'] }), 'done');
assert.equal(kindForRun({ phase: 'stopped', toolsUsed: [] }), 'plan');

const live = syncStepsFromRun({
  steps,
  plan,
  phase: 'tool_exec',
  toolsUsed: ['read_file', 'write_file'],
  grokResults: [{ file: 'src/lib/sse.ts', status: 'ok' }],
  now: 1,
});
assert.equal(live.steps.find((s) => s.kind === 'plan').status, 'done');
assert.equal(live.steps.find((s) => s.kind === 'edit').status, 'active');
assert.ok(live.steps.find((s) => s.kind === 'edit').log.some((l) => l.includes('sse.ts')));
assert.equal(live.steps.find((s) => s.kind === 'check').status, 'pending');
assert.equal(live.plan[0].status, 'done');

const done = syncStepsFromRun({
  steps: live.steps,
  plan: live.plan,
  phase: 'finishing',
  toolsUsed: ['read_file', 'write_file', 'verify'],
  grokResults: [{ file: 'src/lib/sse.ts', status: 'ok' }],
  verifyEvidence: true,
  content: 'Patched the SSE parser.\n\n---\n**Done:** shipped\n**Continue:**\n1. a\n2. b\n3. c',
  now: 2,
});
assert.equal(done.steps.find((s) => s.kind === 'check').status, 'done');
assert.equal(done.steps.find((s) => s.kind === 'done').status, 'done');

const stopped = syncStepsFromRun({
  steps: buildTurnSteps('x', []),
  plan: buildTurnPlan('x', []),
  phase: 'stopped',
  toolsUsed: [],
  now: 3,
});
assert.equal(stopped.steps.find((s) => s.kind === 'plan').status, 'failed');

const files = collectTurnFiles({
  grokResults: [{ file: 'src/a.ts', status: 'ok' }],
  toolCalls: [{ name: 'write_file', arguments: { path: 'src/b.ts' } }],
});
assert.deepEqual(files.map((f) => f.path).sort(), ['src/a.ts', 'src/b.ts']);

console.log('turn-workflow ok');
fs.rmSync(outDir, { recursive: true, force: true });
