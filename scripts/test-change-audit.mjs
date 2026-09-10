#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-change-audit');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
// Force CJS interpretation so the extensionless relative import resolves under Node.
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));

// 1. Compile TypeScript files for change audit and completion footer (commonjs so
//    changeAudit's `./completionFooter` import resolves via require without a .js suffix).
execFileSync(
  'node_modules/.bin/tsc',
  [
    'src/lib/completionFooter.ts',
    'src/lib/changeAudit.ts',
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
const { parseCompletionFooter, hasValidCompletionFooter } = require(path.join(outDir, 'lib/completionFooter.js'));
const {
  auditTurnChanges,
  extractModifiedFiles,
  extractReferencedFiles,
  buildVerifySummaryNudge,
} = require(path.join(outDir, 'lib/changeAudit.js'));

console.log('--- 1. Testing parseCompletionFooter ---');

// 1.1 Legacy footer format
const legacyMsg = `Here is the explanation of the bug.

---
**Done:** Fixed the memory leak in socket connection
**Continue:**
1. Run tests to verify socket teardown
2. Inspect log output for dangling listeners
3. Benchmark connection pooling`;

const legacyParsed = parseCompletionFooter(legacyMsg);
assert.ok(legacyParsed, 'Legacy footer should parse successfully');
assert.equal(legacyParsed.summary, 'Fixed the memory leak in socket connection');
assert.deepEqual(legacyParsed.options, [
  'Run tests to verify socket teardown',
  'Inspect log output for dangling listeners',
  'Benchmark connection pooling',
]);
assert.equal(hasValidCompletionFooter(legacyMsg), true);

// 1.2 Enhanced footer with Changes and Verified sections
const enhancedMsg = `I have updated the bridge server and billing configuration.

---
**Done:** Implemented billing wallet cache and bridge daemon auto-restart.
**Changes:**
- Updated src/lib/billingApi.ts with token quota checks
- Created daemon/mempalace.js MCP bridge server
**Verified:**
- [x] Billing API: curl test to wallet endpoint returns 200 OK
- [x] Mempalace MCP: automated test suite scripts/test-mempalace.mjs passes
**Continue:**
1. Deploy bridge daemon with launchctl
2. Inspect memory palace facts in settings
3. Verify wallet balance displays on billing screen`;

const enhancedParsed = parseCompletionFooter(enhancedMsg);
assert.ok(enhancedParsed, 'Enhanced footer should parse successfully');
assert.equal(enhancedParsed.summary, 'Implemented billing wallet cache and bridge daemon auto-restart.');
assert.deepEqual(enhancedParsed.changes, [
  'Updated src/lib/billingApi.ts with token quota checks',
  'Created daemon/mempalace.js MCP bridge server',
]);
assert.deepEqual(enhancedParsed.verifications, [
  'Billing API: curl test to wallet endpoint returns 200 OK',
  'Mempalace MCP: automated test suite scripts/test-mempalace.mjs passes',
]);
assert.equal(enhancedParsed.options.length, 3);
assert.equal(hasValidCompletionFooter(enhancedMsg), true);

console.log('--- 2. Testing extractModifiedFiles ---');
const files = extractModifiedFiles({
  toolCalls: [
    { name: 'write_file', arguments: { path: 'src/lib/billingApi.ts' } },
    { name: 'read_file', arguments: { path: 'src/lib/other.ts' } },
  ],
  grokResults: [
    { file: 'daemon/mempalace.js', status: 'ok' },
    { file: 'package.json', status: 'pending' },
  ],
  filesWritten: ['./scripts/test.mjs'],
});

assert.ok(files.includes('src/lib/billingApi.ts'));
assert.ok(files.includes('daemon/mempalace.js'));
assert.ok(files.includes('package.json'));
assert.ok(files.includes('scripts/test.mjs'));
assert.ok(!files.includes('src/lib/other.ts'), 'read_file should not be treated as a write tool');

console.log('--- 3. Testing auditTurnChanges ---');

// 3.1 Conversational turn with no modifications
const convAudit = auditTurnChanges({
  content: legacyMsg,
  toolCalls: [{ name: 'read_file', arguments: { path: 'src/lib/test.ts' } }],
});
assert.equal(convAudit.hasModifications, false);
assert.equal(convAudit.isVerified, true, 'Conversational turn without writes should be verified');
assert.equal(convAudit.needsVerificationNudge, false);

// 3.2 Turn with file writes but NO verification checklist (trigger nudge)
const unverifiedAudit = auditTurnChanges({
  content: legacyMsg,
  grokResults: [{ file: 'src/lib/billingApi.ts', status: 'ok' }],
});
assert.equal(unverifiedAudit.hasModifications, true);
assert.equal(unverifiedAudit.isVerified, false, 'Modifications without verification checklist should be unverified');
assert.equal(unverifiedAudit.needsVerificationNudge, true, 'Should trigger self-verification nudge');
assert.ok(unverifiedAudit.nudgePrompt?.includes('Verification and Change Summary required'));
assert.ok(unverifiedAudit.nudgePrompt?.includes('src/lib/billingApi.ts'));

// 3.3 Turn with file writes AND verified checklist
const verifiedAudit = auditTurnChanges({
  content: enhancedMsg,
  grokResults: [
    { file: 'src/lib/billingApi.ts', status: 'ok' },
    { file: 'daemon/mempalace.js', status: 'ok' },
  ],
});
assert.equal(verifiedAudit.hasModifications, true);
assert.equal(verifiedAudit.isVerified, true, 'Turn with verification checklist should be verified');
assert.equal(verifiedAudit.needsVerificationNudge, false, 'Should not nudge when verified');
assert.equal(verifiedAudit.changeSummary.verified, true);
assert.equal(verifiedAudit.changeSummary.files.length, 2);
assert.equal(verifiedAudit.changeSummary.changes.length, 2);
assert.equal(verifiedAudit.changeSummary.verifications.length, 2);

// Cleanup
fs.rmSync(outDir, { recursive: true, force: true });
console.log('All change audit tests PASSED!');
