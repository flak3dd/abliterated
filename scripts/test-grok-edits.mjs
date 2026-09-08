#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-grok-edits');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));
execFileSync(
  'npx',
  [
    'tsc',
    'src/lib/grokLayer.ts',
    '--outDir',
    outDir,
    '--rootDir',
    'src',
    '--module',
    'commonjs',
    '--esModuleInterop',
    '--target',
    'es2022',
    '--moduleResolution',
    'node',
    '--strict',
    '--skipLibCheck',
  ],
  { cwd: root, stdio: 'inherit' },
);

const {
  parseGrokEdits,
  resolveCodeFenceWrite,
  hasNonShellCodeFences,
} = createRequire(import.meta.url)(path.join(outDir, 'lib/grokLayer.js'));

const whole = parseGrokEdits('```ts\n// src/hello.ts\nexport const n = 1;\n```', '/Users/me/project');
assert.equal(whole.length, 1);
assert.equal(whole[0].kind, 'write');
assert.equal(whole[0].file, 'src/hello.ts');
assert.ok(String(whole[0].content).includes('export const n = 1'));

const dump = parseGrokEdits('```diff\n@@ -1 +1 @@\n-a\n+b\n```', '/Users/me/project');
assert.equal(dump.length, 0, 'unlabeled dump must not write workspace/patch.ts');

const named = parseGrokEdits(
  '```diff\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-a\n+b\n```',
  '/Users/me/project',
);
assert.equal(named.length, 1);
assert.equal(named[0].file, 'src/app.ts');
assert.equal(named[0].kind, 'patch');

const escape = parseGrokEdits('```ts /etc/passwd\nroot:x\n```', '/Users/me/project');
assert.equal(escape.length, 0);


const unfencedNamed = parseGrokEdits(
  'Here is a patch:\n\n--- a/src/unfenced.ts\n+++ b/src/unfenced.ts\n@@ -1 +1 @@\n-old\n+new\n',
  '/Users/me/project',
);
assert.equal(unfencedNamed.length, 1, 'named unfenced ---/+++ diffs must apply without pendingPath');
assert.equal(unfencedNamed[0].file, 'src/unfenced.ts');
assert.equal(unfencedNamed[0].kind, 'patch');

const unfencedBare = parseGrokEdits('@@ -1 +1 @@\n-a\n+b\n', '/Users/me/project');
assert.equal(unfencedBare.length, 0, 'unlabeled unfenced hunk must not invent a path');

const resolved = resolveCodeFenceWrite('ts', '// src/ping.ts\nexport const ping = 1\n');
assert.equal(resolved?.path, 'src/ping.ts');
assert.ok(String(resolved?.body).includes('export const ping'));
assert.equal(resolveCodeFenceWrite('ts', 'export const x = 1\n'), null);
assert.equal(hasNonShellCodeFences('```ts\nconst x = 1\n```'), true);
assert.equal(hasNonShellCodeFences('```bash\necho hi\n```'), false);

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-grok-edits: ok');
