#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist-test-featherless-qwen");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  "node_modules/.bin/tsc",
  [ "src/lib/featherlessQwen.ts", "--outDir", outDir, "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--strict"], { cwd: root, stdio: "inherit" });
const m = await import(pathToFileURL(path.join(outDir, "featherlessQwen.js")).href);
const {
  isLargeQwenAgentModel,
  isQwen38Abliterated27B,
  migrateFeatherlessModel,
  DEFAULT_FEATHERLESS_MODEL,
  filterFeatherlessQwenModels,
} = m;

assert.equal(DEFAULT_FEATHERLESS_MODEL, 'Qwen/Qwen3-32B');

const ADMIT = [
  'Qwen/Qwen3-32B',
  'huihui-ai/Qwen3-32B-abliterated',
  'Qwen/Qwen2.5-72B-Instruct',
  'huihui-ai/Qwen2.5-72B-Instruct-abliterated',
  'Qwen/Qwen2.5-Coder-32B-Instruct',
  'Qwen/Qwen3-235B-A22B',
  'Qwen/Qwen3.5-397B-A17B',
  'Qwen/Qwen3-VL-32B-Instruct',
  'huihui-ai/Huihui-Qwen3.8-27B-abliterated',
  'OBLITERATUS/Qwen3.8-27B-heretic',
];
const REJECT = [
  'Qwen/Qwen2.5-7B-Instruct',
  'Qwen/Qwen3-8B',
  'Qwen/Qwen3-14B',
  'huihui-ai/Huihui-Qwen3.5-27B-abliterated',
  'Qwen/Qwen3-30B-A3B-Instruct-2507',
  'Qwen/Qwen3-Next-80B-A3B-Instruct',
  'Qwen/Qwen3.6-35B-A3B',
  'huihui-ai/Huihui-Qwen3.6-35B-A3B-abliterated',
  'meta-llama/Llama-3.3-70B-Instruct',
  'mlabonne/NeuralLlama-3-8B-Instruct-abliterated',
];

for (const id of ADMIT) {
  assert.equal(isLargeQwenAgentModel(id), true, 'admit ' + id);
}
for (const id of REJECT) {
  assert.equal(isLargeQwenAgentModel(id), false, 'reject ' + id);
}
assert.equal(isQwen38Abliterated27B('huihui-ai/Huihui-Qwen3.8-27B-abliterated'), true);
assert.equal(isQwen38Abliterated27B('Qwen/Qwen3.8-27B'), false);
assert.equal(isQwen38Abliterated27B('huihui-ai/Huihui-Qwen3.5-27B-abliterated'), false);

const mig7 = migrateFeatherlessModel('Qwen/Qwen2.5-7B-Instruct');
assert.equal(mig7.model, 'Qwen/Qwen3-32B');
assert.equal(mig7.migrated, true);
assert.equal(mig7.patch?.reasoning, 'max');

const migOk = migrateFeatherlessModel('Qwen/Qwen3-32B');
assert.equal(migOk.migrated, false);

const filtered = filterFeatherlessQwenModels([...ADMIT, ...REJECT].map((id) => ({ id })));
assert.equal(filtered.length, ADMIT.length);

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-featherless-qwen: ok');
