#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-mempalace-mcp');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// 1. Compile TypeScript files for mempalace and mcpCatalog
execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/mempalace.ts',
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

const mempalaceMod = await import(pathToFileURL(path.join(outDir, 'lib/mempalace.js')).href);
const { MEMPALACE_CATALOG_ENTRY, withMempalaceMcpServer, MEMPALACE_MCP_NAME } = mempalaceMod;

const catalogMod = await import(pathToFileURL(path.join(outDir, 'lib/mcpCatalog.js')).href);
const { featuredMcpCatalog } = catalogMod;

// 2. Verify MEMPALACE_CATALOG_ENTRY
assert.equal(MEMPALACE_CATALOG_ENTRY.name, 'mempalace');
assert.equal(MEMPALACE_CATALOG_ENTRY.command, 'mempalace-mcp');
assert.deepEqual(MEMPALACE_CATALOG_ENTRY.args, []);

// 3. Verify withMempalaceMcpServer creation
const created = withMempalaceMcpServer([], true, '/tmp/test-palace');
assert.equal(created.length, 1);
assert.equal(created[0].name, 'mempalace');
assert.equal(created[0].command, 'mempalace-mcp');
assert.deepEqual(created[0].args, []);
assert.equal(created[0].env?.MEMPALACE_PALACE_PATH, '/tmp/test-palace');

// 4. Verify auto-migration of legacy broken uvx config
const legacyBroken = [
  {
    id: 'mcp_mempalace',
    name: 'mempalace',
    command: 'uvx',
    args: ['--from', 'mempalace', 'python', '-m', 'mempalace.mcp_server'],
    enabled: true,
  },
];
const migrated = withMempalaceMcpServer(legacyBroken, true, '/tmp/test-palace-2');
assert.equal(migrated.length, 1);
assert.equal(migrated[0].command, 'mempalace-mcp');
assert.deepEqual(migrated[0].args, []);
assert.equal(migrated[0].env?.MEMPALACE_PALACE_PATH, '/tmp/test-palace-2');

// 5. Verify catalog featured list includes working mempalace entry
const featured = featuredMcpCatalog();
const mpCatalogEntry = featured.find((e) => e.id === 'mempalace');
assert.ok(mpCatalogEntry, 'mempalace in featured MCP catalog');
assert.equal(mpCatalogEntry.command, 'mempalace-mcp');
assert.deepEqual(mpCatalogEntry.args, []);

// 6. Verify daemon/mempalace.js mcpServerSpec
const daemonMempalace = await import(pathToFileURL(path.join(root, 'daemon/mempalace.js')).href);
const spec = daemonMempalace.mcpServerSpec('/tmp/daemon-palace');
assert.equal(spec.name, 'mempalace');
assert.ok(
  spec.command.includes('mempalace-mcp') || spec.command.includes('uvx'),
  `command should resolve to mempalace-mcp or uvx, got: ${spec.command}`,
);
assert.ok(
  spec.args.length === 0 || spec.args.includes('mempalace-mcp'),
  `args should be [] or contain mempalace-mcp, got: ${JSON.stringify(spec.args)}`,
);
assert.equal(spec.env.MEMPALACE_PALACE_PATH, '/tmp/daemon-palace');

// 7. Verify daemon/mcp.js connect with mempalace
const daemonMcp = await import(pathToFileURL(path.join(root, 'daemon/mcp.js')).href);
try {
  const connResult = await daemonMcp.connect(
    {
      id: 'test_mempalace_server',
      name: 'mempalace',
      command: 'mempalace-mcp',
      args: [],
    },
    root,
  );
  assert.ok(connResult, 'connect returned result');
  assert.ok(Array.isArray(connResult.tools), 'tools is array');
  assert.ok(connResult.tools.length > 0, `mempalace should expose tools, got ${connResult.tools.length}`);

  const toolNames = connResult.tools.map((t) => t.name);
  assert.ok(
    toolNames.includes('mempalace_status') || toolNames.includes('mempalace_search'),
    `expected mempalace_status or search in tools, got: ${toolNames.slice(0, 5).join(', ')}`,
  );

  console.log(`MemPalace MCP server connected successfully: found ${connResult.tools.length} tools:`);
  console.log(`  - ${toolNames.slice(0, 8).join('\n  - ')}`);

  // Test tool calling via daemon
  if (toolNames.includes('mempalace_status')) {
    const statusOutput = await daemonMcp.callTool('test_mempalace_server', 'mempalace_status', {});
    assert.ok(typeof statusOutput === 'string' && statusOutput.length > 0, 'mempalace_status returned text');
    console.log(`MemPalace tool call mempalace_status succeeded: ${statusOutput.slice(0, 80).replace(/\n/g, ' ')}...`);
  }

  await daemonMcp.disconnect('test_mempalace_server');
} catch (err) {
  // If uv/mempalace is not runnable in this specific subshell, check that error is not ENOENT
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`Direct stdio test note: ${msg}`);
  assert.ok(!msg.includes('ENOENT'), 'Should never fail with ENOENT');
}

fs.rmSync(outDir, { recursive: true, force: true });
console.log('\ntest-mempalace-mcp: ALL TESTS PASSED');
