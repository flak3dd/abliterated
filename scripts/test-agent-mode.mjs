#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-agent-mode');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));

// Compile TypeScript files for agent mode verification
execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/types/index.ts',
    'src/lib/turnWorkflow.ts',
    'src/lib/systemPrompt.ts',
    'src/lib/agentHelpers.ts',
    'src/lib/verifyDone.ts',
    'src/lib/changeAudit.ts',
    'src/lib/completionFooter.ts',
    'src/lib/deepenComplete.ts',
    'src/lib/tokenCollapse.ts',
    '--outDir',
    outDir,
    '--rootDir',
    'src',
    '--module',
    'commonjs',
    '--moduleResolution',
    'node',
    '--esModuleInterop',
    '--target',
    'es2022',
    '--strict',
    '--skipLibCheck',
  ],
  { cwd: root, stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const {
  ALL_TOOL_TYPES,
  ASK_MODE_TOOLS,
  PLAN_MODE_TOOLS,
  DEBUG_MODE_TOOLS,
  ALL_AGENT_MODES,
} = require(path.join(outDir, 'types/index.js'));
const {
  filterModeTools,
  filterPlanModeTools,
  buildModeNudge,
  canonicalizeToolName,
} = require(path.join(outDir, 'lib/agentHelpers.js'));
const {
  buildModePromptSection,
  AGENT_MODE_SECTION,
  ASK_MODE_SECTION,
  PLAN_MODE_SECTION,
  DEBUG_MODE_SECTION,
} = require(path.join(outDir, 'lib/systemPrompt.js'));

console.log('--- 1. Testing Agent Modes & Tool Allowlists ---');
assert.deepEqual(ALL_AGENT_MODES, ['agent', 'ask', 'plan', 'debug']);
assert.equal(DEBUG_MODE_TOOLS.length, ALL_TOOL_TYPES.length);
console.log('   ✓ ALL_AGENT_MODES and DEBUG_MODE_TOOLS match');

console.log('--- 2. Testing filterModeTools across all modes ---');
const allTools = [...ALL_TOOL_TYPES];

// Ask Mode: Read-only, no mutations
const askTools = filterModeTools(allTools, 'ask');
assert.ok(askTools.includes('read_file'), 'Ask mode should include read_file');
assert.ok(askTools.includes('grep'), 'Ask mode should include grep');
assert.ok(askTools.includes('semantic_search'), 'Ask mode should include semantic_search');
assert.equal(askTools.includes('write_file'), false, 'Ask mode must not include write_file');
assert.equal(askTools.includes('shell'), false, 'Ask mode must not include shell');
assert.equal(askTools.includes('verify'), false, 'Ask mode must not include verify');
assert.equal(askTools.includes('checkpoint_save'), false, 'Ask mode must not include checkpoint_save');
assert.equal(askTools.length, ASK_MODE_TOOLS.length);
console.log('   ✓ Ask mode tool filter verified (read-only enforced)');

// Plan Mode: Research / checklist only
const planTools = filterModeTools(allTools, 'plan');
assert.ok(planTools.includes('read_file'), 'Plan mode should include read_file');
assert.ok(planTools.includes('todo'), 'Plan mode should include todo');
assert.equal(planTools.includes('write_file'), false, 'Plan mode must not include write_file');
assert.equal(planTools.includes('shell'), false, 'Plan mode must not include shell');
assert.equal(planTools.length, PLAN_MODE_TOOLS.length);
assert.deepEqual(filterPlanModeTools(allTools), planTools);
console.log('   ✓ Plan mode tool filter verified (write-gated)');

// Debug Mode: Full tools
const debugTools = filterModeTools(allTools, 'debug');
assert.deepEqual(debugTools, allTools);
console.log('   ✓ Debug mode tool filter verified (full tools)');

// Agent Mode: Full tools
const agentTools = filterModeTools(allTools, 'agent');
assert.deepEqual(agentTools, allTools);
console.log('   ✓ Agent mode tool filter verified (full tools)');

console.log('--- 3. Testing Tool Aliases Canonicalization ---');
assert.equal(canonicalizeToolName('codebase_search'), 'semantic_search');
assert.equal(canonicalizeToolName('search_code'), 'semantic_search');
assert.equal(canonicalizeToolName('find_in_files'), 'semantic_search');
assert.equal(canonicalizeToolName('run_terminal_cmd'), 'shell');
assert.equal(canonicalizeToolName('terminal'), 'shell');
assert.equal(canonicalizeToolName('run_command'), 'shell');
assert.equal(canonicalizeToolName('exec'), 'shell');
assert.equal(canonicalizeToolName('edit_file'), 'write_file');
assert.equal(canonicalizeToolName('modify_file'), 'write_file');
assert.equal(canonicalizeToolName('patch_file'), 'write_file');
console.log('   ✓ Tool aliases canonicalized correctly');

console.log('--- 4. Testing System Prompt Sections & Nudges ---');
assert.ok(buildModePromptSection('agent').includes('Mode: Agent'));
assert.ok(buildModePromptSection('ask').includes('Mode: Ask (read-only)'));
assert.ok(buildModePromptSection('plan').includes('Mode: Plan'));
assert.ok(buildModePromptSection('debug').includes('Mode: Debug (systematic)'));

assert.ok(buildModeNudge('ask').includes('Ask mode — READ ONLY'));
assert.ok(buildModeNudge('plan').includes('Plan mode — LOCKED'));
assert.ok(buildModeNudge('debug').includes('Debug mode — SYSTEMATIC'));
console.log('   ✓ Prompt sections and nudges match each mode');

// Cleanup temporary test artifacts
fs.rmSync(outDir, { recursive: true, force: true });
console.log('\nAll agent mode test suites passed successfully!');
