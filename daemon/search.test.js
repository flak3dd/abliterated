import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { globToRegExp, matchGlob, isInsideRoot, skipSearchName, walkFiles, toRel } from './search.js';

assert.equal(matchGlob('src/**/*.ts', 'src/a/b.ts'), true);
assert.equal(matchGlob('src/**/*.ts', 'src/b.ts'), true);
assert.equal(matchGlob('src/**/*.ts', 'lib/b.ts'), false);
assert.equal(matchGlob('*.ts', 'src/a.ts'), false);
assert.equal(matchGlob('*.ts', 'a.ts'), true);
assert.equal(matchGlob('**/*.swift', 'Foo.swift'), true);
assert.equal(matchGlob('**/*.swift', 'ios/Foo.swift'), true);
assert.equal(matchGlob('src/?at.ts', 'src/cat.ts'), true);
assert.equal(matchGlob('src/?at.ts', 'src/caat.ts'), false);
assert.ok(globToRegExp('a*b').test('axb'));

assert.equal(isInsideRoot('/workspace', '/workspace/src'), true);
assert.equal(isInsideRoot('/workspace', '/workspace'), true);
assert.equal(isInsideRoot('/workspace', '/etc/passwd'), false);
assert.equal(isInsideRoot('/workspace', '/workspace/../etc/passwd'), false);
assert.equal(isInsideRoot('/workspace', path.join('/workspace', '..', 'etc')), false);
assert.equal(skipSearchName('node_modules'), true);
assert.equal(skipSearchName('dist'), true);
assert.equal(skipSearchName('build'), true);
assert.equal(skipSearchName('.git'), true);
assert.equal(skipSearchName('src'), false);

const root = path.join(os.tmpdir(), `ablit-search-${Date.now()}`);
await mkdir(root, { recursive: true });
await mkdir(path.join(root, 'src'), { recursive: true });
await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
await writeFile(path.join(root, 'src', 'a.ts'), 'export const n = 1;\nhello grep\n');
await writeFile(path.join(root, 'node_modules', 'pkg', 'x.ts'), 'secret should skip\n');
const found = [];
await walkFiles(root, root, async (abs) => {
  found.push(toRel(root, abs));
  return false;
});
assert.ok(found.includes('src/a.ts'));
assert.ok(!found.some((f) => f.includes('node_modules')));

const escaped = isInsideRoot(root, path.join(root, '..', 'etc', 'passwd'));
assert.equal(escaped, false);

await rm(root, { recursive: true, force: true });
console.log('search.test.js ok');
