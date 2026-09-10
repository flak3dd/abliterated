#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-apply-inbox');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => {
    mem.set(k, String(v));
  },
  removeItem: (k) => {
    mem.delete(k);
  },
};

execFileSync(
  'npx',
  [
    'tsc',
    'src/lib/applyInbox.ts',
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
  APPLY_INBOX_KEY,
  enqueuePendingEdits,
  listApplyInbox,
  rejectInboxItem,
  clearApplyInbox,
  hydrateApplyInbox,
} = createRequire(import.meta.url)(path.join(outDir, 'lib/applyInbox.js'));

assert.equal(listApplyInbox().length, 0);

const added = enqueuePendingEdits(
  [
    { file: 'src/a.ts', kind: 'write', content: 'export const a = 1\n' },
    { file: 'src/b.ts', kind: 'patch', patch: '@@ -1 +1 @@\n-a\n+b\n' },
  ],
  'msg_1',
);
assert.equal(added.length, 2);
assert.equal(listApplyInbox().length, 2);
assert.equal(listApplyInbox()[0].file, 'src/b.ts');

const raw = JSON.parse(String(mem.get(APPLY_INBOX_KEY)));
assert.equal(raw.length, 2);
assert.equal(raw[0].kind, 'patch');

enqueuePendingEdits([{ file: 'src/a.ts', kind: 'write', content: 'export const a = 2\n' }], 'msg_2');
assert.equal(listApplyInbox().length, 2, 'same file+kind replaces');
assert.equal(listApplyInbox().find((i) => i.file === 'src/a.ts').content, 'export const a = 2\n');

const id = listApplyInbox().find((i) => i.file === 'src/b.ts').id;
rejectInboxItem(id);
assert.equal(listApplyInbox().length, 1);

clearApplyInbox();
assert.equal(listApplyInbox().length, 0);
assert.equal(JSON.parse(String(mem.get(APPLY_INBOX_KEY))).length, 0);

mem.set(
  APPLY_INBOX_KEY,
  JSON.stringify([{ id: 'diff_x', file: 'src/c.ts', kind: 'write', content: 'c', createdAt: 1 }]),
);
hydrateApplyInbox();
assert.equal(listApplyInbox().length, 1);
assert.equal(listApplyInbox()[0].file, 'src/c.ts');

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-apply-inbox.mjs ok');
