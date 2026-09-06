#!/usr/bin/env node
/** Unit smoke for modelSettingsGuide — run: node scripts/test-model-settings-guide.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-model-guide');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'npx',
  [
    'tsc',
    'src/lib/modelSettingsGuide.ts',
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
const mod = await import(pathToFileURL(path.join(outDir, 'modelSettingsGuide.js')).href);
const {
  classifyModel,
  recommendedApiPatch,
  applyRecommendedApiSettings,
  buildModelSettingsGuide,
} = mod;

assert.equal(classifyModel('Qwen/Qwen3-32B').family, 'thinking');
assert.equal(classifyModel('Qwen/Qwen3-32B').chip, 'think');
assert.equal(classifyModel('Qwen/Qwen2.5-7B-Instruct').family, 'instruct');
assert.equal(classifyModel('meta-llama/Llama-3.1-8B').family, 'base');
assert.equal(classifyModel('Qwen/Qwen2.5-VL-7B-Instruct').family, 'vision');
assert.equal(classifyModel('Qwen/Qwen2.5-Coder-32B-Instruct').family, 'code');

const base = {
  inferenceProvider: 'featherless',
  reasoning: 'off',
  coalesceReasoningToContent: true,
  featherlessEnabled: true,
  featherlessToken: 'sk-test',
  featherlessModel: 'Qwen/Qwen3-32B',
};

const qwen3 = recommendedApiPatch('Qwen/Qwen3-32B', base);
assert.equal(qwen3.reasoning, 'max');
assert.equal(qwen3.coalesceReasoningToContent, true);

const instruct = recommendedApiPatch('Qwen/Qwen2.5-7B-Instruct', { ...base, reasoning: 'max' });
assert.equal(instruct.reasoning, 'off');

const applied = applyRecommendedApiSettings({ ...base, reasoning: 'off' }, 'Qwen/Qwen3-32B');
assert.equal(applied.reasoning, 'max');

const guideOff = buildModelSettingsGuide('Qwen/Qwen3-32B', base);
assert.ok(guideOff.applyPatch);
assert.equal(guideOff.applyPatch.reasoning, 'max');
assert.equal(guideOff.items.find((i) => i.id === 'reasoning').status, 'warn');

const guideOn = buildModelSettingsGuide('Qwen/Qwen3-32B', { ...base, reasoning: 'max' });
assert.equal(guideOn.applyPatch, null);
assert.equal(guideOn.items.find((i) => i.id === 'reasoning').status, 'ok');

const instructWarn = buildModelSettingsGuide('Qwen/Qwen2.5-7B-Instruct', { ...base, reasoning: 'max' });
assert.equal(instructWarn.items.find((i) => i.id === 'reasoning').status, 'warn');
assert.equal(instructWarn.applyPatch.reasoning, 'off');

const noKey = buildModelSettingsGuide('Qwen/Qwen3-32B', { ...base, featherlessToken: '' });
assert.equal(noKey.items.find((i) => i.id === 'endpoint').status, 'block');

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-model-settings-guide: ok');
