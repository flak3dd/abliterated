#!/usr/bin/env node
/** Unit test for reasoning display and coalescing logic — run: node scripts/test-reasoning-ui.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-reasoning-ui');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/agentPhase.ts',
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

const agentPhaseMod = await import(pathToFileURL(path.join(outDir, 'agentPhase.js')).href);
const reasoningWorkMod = await import(pathToFileURL(path.join(outDir, 'reasoningWork.js')).href);

const {
  stripThinkingWrappers,
  promoteReasoningToContent,
  coalesceEmptyContentFromReasoning,
  finalizeReasoningChannel,
} = agentPhaseMod;
const { stripImplementationFromText } = reasoningWorkMod;

// 1. Test coalesceEmptyContentFromReasoning:
// Promotes reasoning into content when content is empty.
const asstCoalesce = {
  content: '',
  reasoning: 'Here is the plan and the complete solution to your question.',
};
const didCoalesce = coalesceEmptyContentFromReasoning(asstCoalesce, true);
assert.equal(didCoalesce, true);
assert.equal(asstCoalesce.content, 'Here is the plan and the complete solution to your question.');
assert.equal(asstCoalesce.reasoning, 'Here is the plan and the complete solution to your question.');

// 2. Test MessageBubble displayContent & reasoningForUi logic:
// When content is coalesced from reasoning (identical text),
// displayContent must NOT be wiped out to empty string; it must show the answer!
function computeMessageBubbleState(m) {
  const raw = m.reasoning || '';
  const stripped = raw.trim() ? stripImplementationFromText(raw) : '';
  const body = stripThinkingWrappers(m.content || '');

  // Updated logic in MessageBubble.tsx:
  // If content is already displaying this exact text (coalesced from reasoning),
  // suppress the redundant Thought accordion so the answer renders cleanly as the message body.
  const reasoningForUi = (body.trim() && stripped.trim() === body.trim()) ? '' : stripped;
  const displayContent = body;
  const hasAnswer = !!displayContent.trim();
  const reasoningLive = m.status === 'streaming' && !hasAnswer;

  return { reasoningForUi, displayContent, hasAnswer, reasoningLive };
}

// Case A: Coalesced message (model only output reasoning)
const coalescedState = computeMessageBubbleState({
  role: 'assistant',
  status: 'complete',
  content: asstCoalesce.content,
  reasoning: asstCoalesce.reasoning,
});
assert.equal(coalescedState.displayContent, 'Here is the plan and the complete solution to your question.');
assert.equal(coalescedState.hasAnswer, true, 'Coalesced message must have hasAnswer=true so content is visible');
assert.equal(coalescedState.reasoningForUi, '', 'Redundant reasoning accordion is suppressed to avoid duplicate text');

// Case B: Dual-channel message (model output distinct reasoning and final answer)
const dualChannelState = computeMessageBubbleState({
  role: 'assistant',
  status: 'complete',
  content: 'Here is your final answer.',
  reasoning: 'Let me think about how to solve this step by step.',
});
assert.equal(dualChannelState.displayContent, 'Here is your final answer.');
assert.equal(dualChannelState.hasAnswer, true);
assert.equal(dualChannelState.reasoningForUi, 'Let me think about how to solve this step by step.');

// Case C: Active streaming reasoning (no content tokens yet)
const streamingState = computeMessageBubbleState({
  role: 'assistant',
  status: 'streaming',
  content: '',
  reasoning: 'Analyzing user query...',
});
assert.equal(streamingState.displayContent, '');
assert.equal(streamingState.hasAnswer, false);
assert.equal(streamingState.reasoningLive, true);
assert.equal(streamingState.reasoningForUi, 'Analyzing user query...');

// 3. Test finalizeReasoningChannel with coalesce enabled vs disabled
const asstNoCoalesce = {
  content: '',
  reasoning: 'Some internal thoughts',
};
const changedOff = finalizeReasoningChannel(asstNoCoalesce, false);
assert.equal(changedOff, false);
assert.equal(asstNoCoalesce.content, '');

const asstOn = {
  content: '',
  reasoning: 'Some internal thoughts',
};
const changedOn = finalizeReasoningChannel(asstOn, true);
assert.equal(changedOn, true);
assert.equal(asstOn.content, 'Some internal thoughts');

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-reasoning-ui: all assertions passed!');
