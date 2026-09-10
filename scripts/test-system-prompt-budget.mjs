#!/usr/bin/env node
/** Unit smoke for systemPromptBudget — run: node scripts/test-system-prompt-budget.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-system-prompt-budget');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/systemPromptBudget.ts',
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
const { assembleSystemPrompt, COMPACT_SYSTEM_MAX_CHARS } = await import(
  pathToFileURL(path.join(outDir, 'systemPromptBudget.js')).href
);

// No budget: every non-empty block survives, in declared order.
{
  const out = assembleSystemPrompt([
    { text: 'base rules', essential: true },
    { text: '' },
    { text: '   ' },
    { text: 'skills catalog' },
  ]);
  assert.equal(out, 'base rules\n\nskills catalog');
}

// Steering directives outrank bulk context in the joined string, so downstream
// tail-clipping (fitChatPayload) eats memory/catalog before the nudges.
{
  const out = assembleSystemPrompt([
    { text: 'BUILD MODE: diffs in content', essential: true },
    { text: 'PROJECT MEMORY: ' + 'x'.repeat(200) },
  ]);
  assert.ok(
    out.indexOf('BUILD MODE') < out.indexOf('PROJECT MEMORY'),
    'essential steering must precede bulk context',
  );
}

// Tight budget: optional blocks drop, essential ones always survive.
{
  const bulk = 'y'.repeat(5_000);
  const out = assembleSystemPrompt(
    [
      { text: 'locked goal: ship the fix', essential: true },
      { text: 'thought nudge', essential: true },
      { text: `TASK GRAPH ${bulk}` },
      { text: `PROJECT MEMORY ${bulk}` },
      { text: 'small skills note' },
    ],
    { maxChars: 6_000 },
  );
  assert.ok(out.includes('locked goal: ship the fix'), 'essential block dropped');
  assert.ok(out.includes('thought nudge'), 'essential block dropped');
  assert.ok(out.includes('TASK GRAPH'), 'first optional block should fit');
  assert.ok(!out.includes('PROJECT MEMORY'), 'second bulk block must be pruned');
  assert.ok(out.includes('small skills note'), 'a small optional block still fits after pruning');
  assert.ok(out.length <= 6_000, `assembled ${out.length} chars over budget`);
}

// Essential content alone may exceed the cap — it is never dropped, and every
// optional block is pruned in that case.
{
  const out = assembleSystemPrompt(
    [
      { text: 'z'.repeat(9_000), essential: true },
      { text: 'optional context' },
    ],
    { maxChars: COMPACT_SYSTEM_MAX_CHARS },
  );
  assert.equal(out.length, 9_000);
  assert.ok(!out.includes('optional context'));
}

assert.equal(COMPACT_SYSTEM_MAX_CHARS, 8_000);

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-system-prompt-budget: ok');
