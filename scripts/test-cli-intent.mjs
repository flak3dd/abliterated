#!/usr/bin/env node
/** Unit test for the CLI intent classifier — run: node scripts/test-cli-intent.mjs */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-cli-intent');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/cliIntent.ts',
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
const mod = await import(pathToFileURL(path.join(outDir, 'cliIntent.js')).href);
const { classifyCliTurn, isCommandTurn, looksDebugTurn, looksEditTurn, looksRunTurn, CLI_INTENT_META } = mod;

let passed = 0;
const intentOf = (text, signals) => classifyCliTurn(text, signals).intent;

// --- command detection (slash / shell / continue) ---
for (const t of ['/help', '/serve npm run dev', '$ ls -la', '!git status', 'continue', 'c', 'C']) {
  assert.equal(isCommandTurn(t), true, `isCommandTurn("${t}")`);
  assert.equal(intentOf(t), 'command', `intent("${t}") === command`);
  passed += 2;
}
assert.equal(isCommandTurn('build a thing'), false);
passed++;

// --- precedence: command > debug > web > build > edit > run > chat ---
// debug outranks build ("build fails …" must be debug, not build)
assert.equal(intentOf('the build fails with an error', { isBuild: true, isWeb: false }), 'debug', 'debug beats build');
// web outranks build when both injected true (overlap is effectively empty in practice)
assert.equal(intentOf('build me a scraper', { isBuild: true, isWeb: true }), 'web', 'web beats build');
// build when only build signal
assert.equal(intentOf('build a react app', { isBuild: true, isWeb: false }), 'build', 'build');
// web when only web signal
assert.equal(intentOf('search the web for the latest news', { isBuild: false, isWeb: true }), 'web', 'web');
passed += 4;

// --- injected build/web are authoritative over fallbacks ---
// caller says NOT a build → must not classify as build even though text has "build"
assert.equal(intentOf('tell me about the build process', { isBuild: false, isWeb: false }), 'chat', 'injected isBuild=false honored');
passed++;

// --- edit / run / chat (no injected signals → fallbacks) ---
assert.equal(intentOf('refactor the auth module', { isBuild: false, isWeb: false }), 'edit', 'edit');
assert.equal(intentOf('rename the handler function', { isBuild: false, isWeb: false }), 'edit', 'edit rename');
assert.equal(intentOf('serve the app on port 3000', { isBuild: false, isWeb: false }), 'run', 'run');
// bare "npm run dev" has no slash/shell prefix, so it is a run turn, not a command
assert.equal(intentOf('npm run dev', { isBuild: false, isWeb: false }), 'run', 'bare npm run → run');
assert.equal(intentOf('what is a closure in javascript?', { isBuild: false, isWeb: false }), 'chat', 'chat');
assert.equal(intentOf('explain how promises work', { isBuild: false, isWeb: false }), 'chat', 'chat explain');
passed += 5;

// --- predicates directly ---
assert.equal(looksDebugTurn('why does this crash?'), true);
assert.equal(looksDebugTurn('add a feature'), false);
assert.equal(looksEditTurn('update the config'), true);
assert.equal(looksRunTurn('launch the dev server'), true);
passed += 4;

// --- empty / whitespace ---
assert.equal(intentOf('', {}), 'chat');
assert.equal(intentOf('   ', {}), 'chat');
assert.equal(classifyCliTurn('', {}).confidence, 'low');
passed += 3;

// --- every intent has display metadata ---
for (const intent of ['command', 'chat', 'web', 'build', 'edit', 'run', 'debug']) {
  assert.ok(CLI_INTENT_META[intent] && CLI_INTENT_META[intent].label && CLI_INTENT_META[intent].glyph, `meta for ${intent}`);
  passed++;
}

fs.rmSync(outDir, { recursive: true, force: true });
console.log(`\ncli-intent: ${passed} assertions passed ✓`);
