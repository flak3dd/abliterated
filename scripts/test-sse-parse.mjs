#!/usr/bin/env node
/** Unit smoke for sseParse — run: node scripts/test-sse-parse.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-sse-parse');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/sseParse.ts',
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
const mod = await import(pathToFileURL(path.join(outDir, 'sseParse.js')).href);
const {
  extractTextPart,
  applyCompletionChunk,
  completionChunkError,
  thinkingChatTemplateKwargs,
  isThinkingFamilyModel,
} = mod;

function collect(json) {
  let content = '';
  let reasoning = '';
  const tools = [];
  const result = applyCompletionChunk(json, {
    onContent: (t) => {
      content += t;
    },
    onReasoning: (t) => {
      reasoning += t;
    },
    onToolCallDelta: (tc) => {
      tools.push(tc);
    },
  });
  return { content, reasoning, tools, result };
}

assert.equal(extractTextPart('hello'), 'hello');
assert.equal(extractTextPart([{ type: 'text', text: 'ab' }, { type: 'text', text: 'c' }]), 'abc');
assert.equal(extractTextPart(null), '');

const delta = collect({
  choices: [{ delta: { content: 'Hello ' }, finish_reason: null }],
});
assert.equal(delta.content, 'Hello ');
assert.equal(delta.reasoning, '');

const reasoningDelta = collect({
  choices: [{ delta: { reasoning_content: 'think ' } }],
});
assert.equal(reasoningDelta.reasoning, 'think ');

const alias = collect({
  choices: [{ delta: { reasoning: 'plan', thinking: '' } }],
});
assert.equal(alias.reasoning, 'plan');

const messageOnly = collect({
  choices: [
    {
      message: { role: 'assistant', content: 'Final answer.', reasoning_content: 'I reasoned.' },
      finish_reason: 'stop',
    },
  ],
});
assert.equal(messageOnly.content, 'Final answer.');
assert.equal(messageOnly.reasoning, 'I reasoned.');
assert.equal(messageOnly.result.finishReason, 'stop');

const emptyDeltaWithMessage = collect({
  choices: [
    {
      delta: {},
      message: { content: 'From message fallback', reasoning_content: 'hidden think' },
      finish_reason: 'stop',
    },
  ],
});
assert.equal(emptyDeltaWithMessage.content, 'From message fallback');
assert.equal(emptyDeltaWithMessage.reasoning, 'hidden think');

const arrayContent = collect({
  choices: [
    {
      delta: {
        content: [
          { type: 'reasoning', text: 'step 1' },
          { type: 'text', text: 'done' },
        ],
      },
    },
  ],
});
assert.equal(arrayContent.content, 'done');
assert.equal(arrayContent.reasoning, 'step 1');

const preferDelta = collect({
  choices: [
    {
      delta: { content: ' chunk' },
      message: { content: 'full duplicated text' },
    },
  ],
});
assert.equal(preferDelta.content, ' chunk');

const toolMsg = collect({
  choices: [
    {
      message: {
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
});
assert.equal(toolMsg.tools.length, 1);
assert.equal(toolMsg.tools[0].name, 'read_file');
assert.equal(toolMsg.tools[0].arguments, '{"path":"a.ts"}');
assert.equal(toolMsg.result.finishReason, 'tool_calls');

assert.equal(isThinkingFamilyModel('Qwen/Qwen3-32B'), true);
assert.equal(isThinkingFamilyModel('Qwen/Qwen2.5-7B-Instruct'), false);
assert.deepEqual(thinkingChatTemplateKwargs('Qwen/Qwen3-32B', 'max'), { enable_thinking: true, thinking_budget: 16384 });
assert.deepEqual(thinkingChatTemplateKwargs('Qwen/Qwen3-32B', 'off'), { enable_thinking: false });
assert.equal(thinkingChatTemplateKwargs('Qwen/Qwen2.5-7B-Instruct', 'max'), undefined);
assert.equal(thinkingChatTemplateKwargs('Qwen/Qwen3.5-27B', 'max').preserve_thinking, true);
assert.equal(thinkingChatTemplateKwargs('Qwen/Qwen3-32B', 'low').thinking_budget, 1024);


const objectReasoning = collect({
  choices: [{ delta: { reasoning: { content: 'hidden think' } }, finish_reason: 'length' }],
});
assert.equal(objectReasoning.reasoning, 'hidden think');
assert.equal(objectReasoning.result.finishReason, 'length');

const choiceText = collect({
  choices: [{ text: 'plain completion text', finish_reason: 'stop' }],
});
assert.equal(choiceText.content, 'plain completion text');

assert.equal(completionChunkError({ error: { message: 'model overloaded' } }), 'model overloaded');
assert.equal(completionChunkError({ choices: [] }), null);

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-sse-parse: ok');
