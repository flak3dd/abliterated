#!/usr/bin/env node
/** Unit smoke for contextWindow — run: node scripts/test-context-window.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-context-window');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/contextWindow.ts',
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
const mod = await import(pathToFileURL(path.join(outDir, 'contextWindow.js')).href);
const {
  defaultContextWindow,
  parseContextLengthError,
  fitChatPayload,
  estimateMessagesTokens,
  promptTokenBudget,
  sanitizeOpenAiMessages,
  isInvalidRequestError,
} = mod;

assert.equal(defaultContextWindow('featherless'), 32768);
assert.equal(defaultContextWindow('featherless', 16000), 16000);
assert.equal(defaultContextWindow('abliteration'), 131072);

const err = parseContextLengthError(
  "Maximum context length for model 'mlabonne/NeuralLlama-3-8B-Instruct-abliterated' allowed on your plan is 32768 tokens. Your prompt has 76695 tokens, which exceeds the maximum context length limit by 43927 tokens. Please reduce the length of your prompt.",
);
assert.ok(err);
assert.equal(err.limit, 32768);
assert.equal(err.prompt, 76695);

execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/featherlessLimits.ts',
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
const limits = await import(pathToFileURL(path.join(outDir, 'featherlessLimits.js')).href);
assert.equal(
  limits.effectiveContextWindow({ modelContext: 8192, planMax: 32768, fallback: 32768 }),
  8192,
);
assert.equal(
  limits.effectiveContextWindow({ modelContext: 131072, planMax: 32768, settingsContext: 16000, fallback: 32768 }),
  16000,
);

const big = 'x'.repeat(20_000);
const messages = [
  { role: 'system', content: 'You are the agent.\n' + 'rules '.repeat(2000) },
  { role: 'user', content: 'old question' },
  { role: 'assistant', content: big },
  { role: 'tool', content: big, tool_call_id: 't1' },
  { role: 'user', content: 'what is 2+2?' },
];
const fitted = fitChatPayload({
  messages,
  tools: [{ type: 'function', function: { name: 'read_file', parameters: {} } }],
  contextWindow: 32768,
  maxTokens: 4096,
});
assert.ok(fitted.estimatedTokens <= fitted.budget, `est ${fitted.estimatedTokens} > budget ${fitted.budget}`);
assert.equal(fitted.messages[fitted.messages.length - 1].content, 'what is 2+2?');
assert.equal(fitted.messages[0].role, 'system');
assert.ok(
  fitted.messages.some((m) => m.role === 'user' && m.content === 'old question'),
  'locked first user goal must stay pinned',
);
assert.ok(fitted.dropped > 0 || fitted.truncated);

const budget = promptTokenBudget(32768, 4096);
assert.ok(budget < 32768 - 4096);
assert.ok(estimateMessagesTokens(fitted.messages) <= budget + 8);

assert.equal(
  isInvalidRequestError('The request was rejected as invalid. Please check your request parameters.'),
  true,
);
const cleaned = sanitizeOpenAiMessages(
  [
    { role: 'system', content: 'sys' },
    { role: 'assistant', content: 'call', tool_calls: [{ id: 'c1' }] },
    { role: 'tool', content: 'orphan', tool_call_id: 'nope' },
    { role: 'tool', content: 'ok', tool_call_id: 'c1' },
    { role: 'assistant', content: '', reasoning_content: 'think' },
    { role: 'user', content: 'hi' },
  ],
  { stripReasoning: true },
);
assert.equal(cleaned.some((m) => m.tool_call_id === 'nope'), false);
assert.equal(cleaned.some((m) => m.tool_call_id === 'c1'), true);
assert.equal(cleaned.some((m) => m.reasoning_content), false);
assert.equal(cleaned.some((m) => m.role === 'assistant' && !m.content && !m.tool_calls), false);

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-context-window: ok');
