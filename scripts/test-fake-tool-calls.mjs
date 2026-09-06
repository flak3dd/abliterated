#!/usr/bin/env node
/** Unit smoke for fakeToolCalls — run: node scripts/test-fake-tool-calls.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-fake');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync('npx', ['tsc', 'src/lib/fakeToolCalls.ts', '--outDir', outDir, '--module', 'esnext', '--target', 'es2022', '--moduleResolution', 'bundler', '--strict'], { cwd: root, stdio: 'inherit' });
const mod = await import(pathToFileURL(path.join(outDir, 'fakeToolCalls.js')).href);
const { parseFakeToolCalls, looksLikeFakeToolTheater, buildFakeToolNudge, parseJsonToolCallFence, looksLikeJsonToolCallFence } = mod;
const fence = String.fromCharCode(96, 96, 96);
const sample = [
  "I'll analyse the workspace.",
  fence + "bash",
  "list_dir .",
  "git_status .",
  "git_commit -m msg",
  "web_search qwen abliterated",
  fence,
].join('\n');
const parsed = parseFakeToolCalls(sample);
const names = parsed.map((p) => p.name);
assert.ok(names.includes('list_dir'), 'expected list_dir');
assert.ok(names.includes('git_status'), 'expected git_status');
assert.ok(names.includes('web_search'), 'expected web_search');
assert.ok(!names.includes('git_commit'), 'must not parse git_commit');
assert.equal(parsed.find((p) => p.name === "web_search")?.arguments?.query, "qwen abliterated");
assert.equal(parsed.find((p) => p.name === "list_dir")?.arguments?.path, ".");
assert.ok(looksLikeFakeToolTheater(sample));
assert.ok(typeof buildFakeToolNudge() === "string" && buildFakeToolNudge().length > 20);

// JSON-fenced tool_calls must parse (zero Tool-recovery loops).
const jsonFence = [
  "I'll inspect the tree.",
  fence + "json",
  JSON.stringify({
    tool_calls: [
      { name: "list_dir", arguments: { path: "." } },
      { type: "function", function: { name: "git_status", arguments: {} } },
      { name: "git_commit", arguments: { message: "nope" } },
    ],
  }, null, 2),
  fence,
].join("\n");
assert.ok(looksLikeJsonToolCallFence(jsonFence));
assert.ok(looksLikeFakeToolTheater(jsonFence));
const fromJson = parseFakeToolCalls(jsonFence);
const jsonNames = fromJson.map((p) => p.name);
assert.ok(jsonNames.includes("list_dir"), "json fence list_dir");
assert.ok(jsonNames.includes("git_status"), "json fence git_status");
assert.ok(!jsonNames.includes("git_commit"), "json fence must not parse git_commit");
assert.equal(parseJsonToolCallFence(jsonFence).length, fromJson.length);
// Nudge text must not push repeated "emit API tool_calls" death spirals as the only path.
const nudge = buildFakeToolNudge();
assert.ok(typeof nudge === "string" && nudge.length > 20);
assert.ok(/one retry/i.test(nudge) || /Do not paste/i.test(nudge));

console.log("fakeToolCalls ok", JSON.stringify(parsed));

fs.rmSync(outDir, { recursive: true, force: true });
