#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getPromptSuggestions } from '../src/lib/promptSuggestions.ts';

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

console.log('\n=== Running Prompt Suggestions Tests ===\n');

test('Preserves valid footerOptions when provided', () => {
  const result = getPromptSuggestions('Some message content', {
    footerOptions: [
      '1. Run npm test to verify',
      '2. Add edge case coverage',
      '3. Commit these changes',
    ],
  });
  assert.equal(result.length, 3);
  assert.equal(result[0], 'Run npm test to verify');
  assert.equal(result[1], 'Add edge case coverage');
  assert.equal(result[2], 'Commit these changes');
});

test('Extracts embedded Continue list from markdown', () => {
  const content = `
I have implemented the requested feature.

**Continue:**
1. Run the test suite to verify
2. Review the diff for any potential issues
3. Push the branch to origin
`;
  const result = getPromptSuggestions(content);
  assert.equal(result.length, 3);
  assert.equal(result[0], 'Run the test suite to verify');
  assert.equal(result[1], 'Review the diff for any potential issues');
  assert.equal(result[2], 'Push the branch to origin');
});

test('Generates diff/code-change suggestions when diff blocks exist', () => {
  const content = `
I have patched the authentication handler in src/auth.ts:

\`\`\`diff
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,3 +10,4 @@
+  validateToken(token);
\`\`\`
`;
  const result = getPromptSuggestions(content, { hasDiff: true });
  assert.equal(result.length, 3);
  assert.ok(result.some((s) => s.toLowerCase().includes('test') || s.toLowerCase().includes('verify')));
  assert.ok(result.some((s) => s.toLowerCase().includes('edge case') || s.toLowerCase().includes('review')));
});

test('Generates plan suggestions when in plan mode or plan content', () => {
  const content = `
### Implementation Plan
1. Refactor user session store
2. Update login component
3. Run verification tests
`;
  const result = getPromptSuggestions(content, { mode: 'plan' });
  assert.equal(result.length, 3);
  assert.ok(result.some((s) => s.toLowerCase().includes('approve') || s.toLowerCase().includes('plan')));
  assert.ok(result.some((s) => s.toLowerCase().includes('risk') || s.toLowerCase().includes('tradeoff') || s.toLowerCase().includes('edge case')));
});

test('Generates debug/error suggestions when error or diagnostics exist', () => {
  const content = 'TypeError: Cannot read properties of undefined (reading "token") at auth.ts:42';
  const result = getPromptSuggestions(content, { mode: 'debug', diagnosticsCount: 1 });
  assert.equal(result.length, 3);
  assert.ok(result.some((s) => s.toLowerCase().includes('fix') || s.toLowerCase().includes('diagnostic') || s.toLowerCase().includes('cause')));
  assert.ok(result.some((s) => s.toLowerCase().includes('reproduce') || s.toLowerCase().includes('defensive')));
});

test('Generates answer choices when assistant asks a question', () => {
  const content = 'Would you like me to proceed with the automatic migration or would you prefer a manual diff?';
  const result = getPromptSuggestions(content);
  assert.equal(result.length, 3);
  assert.ok(result.some((s) => s.toLowerCase().includes('proceed') || s.toLowerCase().includes('yes')));
  assert.ok(result.some((s) => s.toLowerCase().includes('tradeoff') || s.toLowerCase().includes('pros')));
});

test('Generates conceptual exploration suggestions for ask mode', () => {
  const content = 'React Server Components render on the server without shipping JavaScript bundles to the client.';
  const result = getPromptSuggestions(content, { mode: 'ask' });
  assert.equal(result.length, 3);
  assert.ok(result.some((s) => s.toLowerCase().includes('example') || s.toLowerCase().includes('code')));
  assert.ok(result.some((s) => s.toLowerCase().includes('compare') || s.toLowerCase().includes('pitfall') || s.toLowerCase().includes('best practice')));
});

test('Always returns exactly 3 non-empty distinct suggestions for any arbitrary content', () => {
  const testInputs = [
    '',
    'Done.',
    'OK',
    'Here is the result of your query.',
    'Listing files: a.txt, b.txt, c.txt',
    '```python\ndef hello():\n    pass\n```',
  ];

  for (const input of testInputs) {
    const res = getPromptSuggestions(input);
    assert.equal(res.length, 3, `Expected 3 items for input: "${input}"`);
    assert.ok(res[0] && res[0].length > 3, `Invalid suggestion 1 for "${input}": ${res[0]}`);
    assert.ok(res[1] && res[1].length > 3, `Invalid suggestion 2 for "${input}": ${res[1]}`);
    assert.ok(res[2] && res[2].length > 3, `Invalid suggestion 3 for "${input}": ${res[2]}`);
    assert.notEqual(res[0], res[1], `Duplicate suggestions for "${input}"`);
    assert.notEqual(res[1], res[2], `Duplicate suggestions for "${input}"`);
  }
});

console.log(`\n=== Prompt Suggestions Test Summary ===`);
console.log(`Total: ${passes.length + fails.length} | Passed: ${passes.length} | Failed: ${fails.length}\n`);

if (fails.length > 0) {
  process.exit(1);
}
