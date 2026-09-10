#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-mcp-catalog');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/mcpCatalog.ts',
    '--outDir',
    outDir,
    '--rootDir',
    'src',
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
const { featuredMcpCatalog, catalogMatch, MCP_FEATURED_IDS } = await import(
  pathToFileURL(path.join(outDir, 'lib/mcpCatalog.js')).href,
);
assert.deepEqual([...MCP_FEATURED_IDS], ['filesystem', 'playwright', 'git', 'mempalace']);
const featured = featuredMcpCatalog();
assert.equal(featured[0].id, 'filesystem');
assert.ok(featured.some((e) => e.id === 'playwright'));
assert.ok(featured.some((e) => e.id === 'git'));
assert.ok(featured.some((e) => e.id === 'mempalace'));
const git = featured.find((e) => e.id === 'git');
const hit = catalogMatch(
  [{ id: '1', name: 'Git', command: 'uvx', args: [], enabled: true }],
  git,
);
assert.equal(hit?.id, '1');
fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-mcp-catalog.mjs ok');
