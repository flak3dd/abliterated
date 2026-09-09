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
  shouldApplyGrokEditsNow,
  applyGrokEdits,
  dedupeEditsByToolTargets,
} = createRequire(import.meta.url)(path.join(outDir, 'lib/grokLayer.js'));

// dedupeEditsByToolTargets: content fences already covered by a write tool this
// turn are dropped (prefer the structured tool channel; no double-write).
{
  const root = '/Users/me/project';
  const edits = [
    { file: 'src/a.ts', kind: 'write' },
    { file: './src/b.ts', kind: 'write' },
    { file: 'src/c.ts', kind: 'write' },
  ];
  // Tool targets in mixed forms must all match canonically.
  const kept = dedupeEditsByToolTargets(edits, ['src/a.ts', '/Users/me/project/src/b.ts'], root);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].file, 'src/c.ts');
  // No tool targets → nothing dropped.
  assert.equal(dedupeEditsByToolTargets(edits, [], root).length, 3);
  assert.equal(dedupeEditsByToolTargets(edits, ['', '   '], root).length, 3);
  // A tool target that matches nothing leaves edits intact.
  assert.equal(dedupeEditsByToolTargets(edits, ['src/z.ts'], root).length, 3);
}

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

assert.equal(shouldApplyGrokEditsNow({ autoAccept: false, writeToWorkspace: true }), true);
assert.equal(shouldApplyGrokEditsNow({ autoAccept: true, writeToWorkspace: false }), false);
assert.equal(shouldApplyGrokEditsNow({ autoAccept: true, writeToWorkspace: true }), true);
assert.equal(shouldApplyGrokEditsNow({}), false);

const pendingApply = await applyGrokEdits(
  [{ file: 'src/hello.ts', kind: 'write', content: 'export const n = 1\n' }],
  { autoAccept: false, writeToWorkspace: false, root: '/Users/me/project' },
);
assert.equal(pendingApply.length, 1);
assert.equal(pendingApply[0].status, 'pending');
assert.equal(pendingApply[0].file, 'src/hello.ts');

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-grok-edits: ok');
