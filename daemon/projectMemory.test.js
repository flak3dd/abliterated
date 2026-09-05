import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { readProjectMemory } from './projectMemory.js';

const root = path.join(os.tmpdir(), `ablit-mem-${Date.now()}`);
await mkdir(path.join(root, '.ablit'), { recursive: true });
await mkdir(path.join(root, '.cursor', 'rules'), { recursive: true });
await writeFile(path.join(root, 'AGENTS.md'), '# Agents\nUse relative paths.\n');
await writeFile(path.join(root, '.ablit', 'rules.md'), 'No telemetry.\n');
await writeFile(path.join(root, '.cursor', 'rules', 'style.mdc'), 'Tabs over spaces.\n');
await writeFile(path.join(root, 'README.md'), 'ignore me\n');

const files = await readProjectMemory(root);
const paths = files.map((f) => f.path);
assert.ok(paths.includes('AGENTS.md'));
assert.ok(paths.includes('.ablit/rules.md'));
assert.ok(paths.includes('.cursor/rules/style.mdc'));
assert.ok(!paths.includes('README.md'));
assert.match(files.find((f) => f.path === 'AGENTS.md').text, /relative paths/);

await rm(root, { recursive: true, force: true });
console.log('projectMemory.test.js ok');
