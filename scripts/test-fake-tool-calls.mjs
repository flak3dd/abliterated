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
const { parseFakeToolCalls, looksLikeFakeToolTheater, buildFakeToolNudge } = mod;
const fence = String.fromCharCode(96, 96, 96);
const sample = [
  "I'll analyse the workspace.",
  fence + "bash",
  "list_dir .",
  "git_status .",
  "git_commit -m msg",
  fence,
].join('\n');
const parsed = parseFakeToolCalls(sample);
const names = parsed.map((p) => p.name);
assert.ok(names.includes('list_dir'), 'expected list_dir');
assert.ok(names.includes('git_status'), 'expected git_status');
assert.ok(!names.includes('git_commit'), 'must not parse git_commit');
assert.equal(parsed.find((p) => p.name === "list_dir")?.arguments?.path, ".");
assert.ok(looksLikeFakeToolTheater(sample));
assert.ok(typeof buildFakeToolNudge() === "string" && buildFakeToolNudge().length > 20);
console.log("fakeToolCalls ok", JSON.stringify(parsed));
fs.rmSync(outDir, { recursive: true, force: true });
