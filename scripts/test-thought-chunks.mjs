#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseThoughtChunks } from '../src/lib/thoughtChunks.ts';

const passes = [];
const fails = [];

function test(name, fn) {
  try {
    fn();
    passes.push(name);
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fails.push({ name, err });
    console.error(`  ✗ ${name}:`, err.message);
  }
}

console.log('\n=== Running Thought Chunks & Auto-Run Tests ===\n');

test('Parses empty or whitespace text into empty array', () => {
  assert.deepEqual(parseThoughtChunks(''), []);
  assert.deepEqual(parseThoughtChunks('   \n\n  '), []);
});

test('Parses markdown headers into distinct thought chunks with titles', () => {
  const reasoning = `
## Problem Analysis
The user requested an auto-run code execution toggle.
We need to add it to ChatScreen and synchronize with settings.

## Component Design
In ReasoningTrace.tsx, we will create a dropdown that renders thought chunks.
This avoids streaming raw walls of text.

### Verification Plan
We should run the unit test suite and type check with tsc.
`;

  const chunks = parseThoughtChunks(reasoning);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].id, 1);
  assert.equal(chunks[0].title, 'Problem Analysis');
  assert.ok(chunks[0].content.includes('auto-run code execution toggle'));

  assert.equal(chunks[1].id, 2);
  assert.equal(chunks[1].title, 'Component Design');
  assert.ok(chunks[1].content.includes('ReasoningTrace.tsx'));

  assert.equal(chunks[2].id, 3);
  assert.equal(chunks[2].title, 'Verification Plan');
  assert.ok(chunks[2].content.includes('unit test suite'));
});

test('Parses numbered steps into discrete chunks', () => {
  const reasoning = `
Step 1: Inspect the workspace
Check what files are modified and what tests are passing.

Step 2: Add auto-run toggle
Update ChatScreen with the new toggle and sync state.

Step 3: Test and verify
Execute npm run build and check for type errors.
`;

  const chunks = parseThoughtChunks(reasoning);
  assert.equal(chunks.length, 3);
  assert.ok(chunks[0].title.includes('Inspect the workspace'));
  assert.ok(chunks[1].title.includes('Add auto-run toggle'));
  assert.ok(chunks[2].title.includes('Test and verify'));
});

test('Parses paragraphs without headers into readable chunks with synthesized titles', () => {
  const reasoning = `
We are analyzing the user request to keep thinking in a dropdown.
This requires modifying how thoughts are formatted during streaming.

Next, we should examine TerminalPane to ensure auto-run executes bash code blocks automatically.
When autoRun is true, it triggers run() immediately on mount.

Finally, we update the status bar to make the auto-run badge clickable.
This lets the user toggle auto-run from anywhere in the interface.
`;

  const chunks = parseThoughtChunks(reasoning);
  assert.equal(chunks.length, 3);
  for (const chunk of chunks) {
    assert.ok(chunk.title.length > 5, `Title too short: "${chunk.title}"`);
    assert.ok(chunk.content.length > 20, `Content too short: "${chunk.content}"`);
    assert.ok(chunk.wordCount > 5, `Word count too low: ${chunk.wordCount}`);
  }
});

test('Merges tiny fragments into previous chunks to avoid clutter', () => {
  const reasoning = `
First major chunk of thinking about the architecture.
We need to design the data flow carefully.

OK.

Now onto the next major chunk of thinking about the implementation details.
Everything should be typed and tested.
`;

  const chunks = parseThoughtChunks(reasoning);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].content.includes('OK.'));
});

console.log(`\n=== Thought Chunks Test Summary ===`);
console.log(`Total: ${passes.length + fails.length} | Passed: ${passes.length} | Failed: ${fails.length}\n`);

if (fails.length > 0) {
  process.exit(1);
}
