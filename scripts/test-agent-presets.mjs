#!/usr/bin/env node
/**
 * Unit tests for agentPresets module.
 * Tests setup profiles, match detection, toggle alignment, setup application,
 * and AI agent API / provider-specific workflow alignments.
 * Run: node scripts/test-agent-presets.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-agent-presets');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

execFileSync(
  'npx',
  [
    'tsc',
    'src/lib/agentPresets.ts',
    '--outDir',
    outDir,
    '--module',
    'esnext',
    '--target',
    'es2022',
    '--moduleResolution',
    'bundler',
    '--strict',
  ],
  { cwd: root, stdio: 'inherit' },
);

const possiblePaths = [
  path.join(outDir, 'agentPresets.js'),
  path.join(outDir, 'lib', 'agentPresets.js'),
  path.join(outDir, 'src', 'lib', 'agentPresets.js'),
];
const targetFile = possiblePaths.find((p) => fs.existsSync(p));
if (!targetFile) {
  throw new Error(
    `Compiled file not found in ${outDir}. Files: ${fs.readdirSync(outDir, { recursive: true }).join(', ')}`
  );
}
const mod = await import(pathToFileURL(targetFile).href);
const {
  AGENT_SETUP_PROFILES,
  TRACKED_TOGGLE_KEYS,
  PROVIDER_SETUP_ALIGNMENTS,
  applyAgentSetup,
  detectActiveSetup,
  evaluateSetupMatches,
  getSettingToggleValue,
  getToggleGuidance,
  getProviderSetupAlignment,
  alignSetupForProvider,
  checkProviderAlignment,
} = mod;

console.log('Running test-agent-presets.mjs assertions...');

// 1. Verify all 5 profiles are defined and valid
assert.equal(AGENT_SETUP_PROFILES.length, 5);
const profileIds = AGENT_SETUP_PROFILES.map((p) => p.id);
assert.deepEqual(profileIds, [
  'autonomous_builder',
  'architect_planner',
  'strict_verifier',
  'fast_chat',
  'multi_agent',
]);

// 2. Verify all tracked keys exist in every profile's recommendedToggles
for (const profile of AGENT_SETUP_PROFILES) {
  assert.ok(profile.recommendedAgentMode, `Profile ${profile.id} must define recommendedAgentMode`);
  assert.ok(Array.isArray(profile.preferredProviders), `Profile ${profile.id} must define preferredProviders`);
  for (const key of TRACKED_TOGGLE_KEYS) {
    assert.equal(
      typeof profile.recommendedToggles[key],
      'boolean',
      `Profile ${profile.id} must define boolean recommendation for ${key}`,
    );
  }
}

// 3. Test applyAgentSetup
const baseSettings = {
  baseUrl: '',
  token: '',
  defaultModel: '',
  reasoning: 'off',
  systemPrompt: '',
  remoteHostEnabled: true,
  pairingCode: 'TEST01',
  autoAcceptEdits: false,
  autoRunShell: false,
  maxAgentTurns: 24,
  maxConcurrentJobs: 1,
  selfDeepenEnabled: true,
  selfDeepenPasses: 2,
  deepenCompleteness: true,
  midRunInjectEnabled: true,
  completionFooterEnabled: true,
  coalesceReasoningToContent: true,
  planModeEnabled: false,
  buildModeEnabled: true,
  fastModel: '',
  inferenceProvider: 'abliteration',
  sparkEnabled: false,
  sparkBaseUrl: '',
  sparkToken: '',
  sparkModel: '',
  sparkViaProxy: true,
  sparkLanHost: '',
  sparkSshAlias: '',
  featherlessEnabled: true,
  featherlessBaseUrl: '',
  featherlessToken: '',
  featherlessModel: '',
  featherlessViaProxy: false,
  imageGenEnabled: false,
  imageBackend: 'spark',
  imageBaseUrl: '',
  imageToken: '',
  imageModel: '',
  imageViaProxy: false,
  xaiImageBaseUrl: '',
  xaiImageToken: '',
  xaiImageModel: '',
  xaiImageResolution: '2k',
  xaiImageQuality: 'auto',
  mcpServers: [],
  skillsEnabled: true,
  licenseKey: '',
  webSearchBraveKey: '',
  webSearchSearxUrl: '',
  jobWorktreesEnabled: false,
  multiAgentEnabled: false,
  mempalaceEnabled: true,
  mempalacePalacePath: '',
  mempalaceWing: '',
  mempalaceAutoRecall: true,
  mempalaceAutoSave: true,
  verifyStrictProfile: true,
  agentMode: 'agent',
  postEditDiagnostics: false,
};

// Apply autonomous_builder
const autoApplied = applyAgentSetup(baseSettings, 'autonomous_builder');
assert.equal(autoApplied.buildModeEnabled, true);
assert.equal(autoApplied.planModeEnabled, false);
assert.equal(autoApplied.autoAcceptEdits, true);
assert.equal(autoApplied.verifyStrictProfile, true);
assert.equal(autoApplied.selfDeepenEnabled, true);
assert.equal(autoApplied.maxAgentTurns, 30);
assert.equal(autoApplied.agentMode, 'agent');
assert.equal(autoApplied.postEditDiagnostics, true);

// Apply architect_planner
const archApplied = applyAgentSetup(baseSettings, 'architect_planner');
assert.equal(archApplied.planModeEnabled, true);
assert.equal(archApplied.buildModeEnabled, false);
assert.equal(archApplied.autoAcceptEdits, false);
assert.equal(archApplied.autoRunShell, false);
assert.equal(archApplied.agentMode, 'plan');

// Apply fast_chat
const fastApplied = applyAgentSetup(baseSettings, 'fast_chat');
assert.equal(fastApplied.selfDeepenEnabled, false);
assert.equal(fastApplied.deepenCompleteness, false);
assert.equal(fastApplied.selfDeepenPasses, 0);
assert.equal(fastApplied.agentMode, 'ask');

// Apply multi_agent
const multiApplied = applyAgentSetup(baseSettings, 'multi_agent');
assert.equal(multiApplied.multiAgentEnabled, true);
assert.equal(multiApplied.jobWorktreesEnabled, true);
assert.equal(multiApplied.maxConcurrentJobs, 2);
assert.equal(multiApplied.agentMode, 'agent');

// 4. Test detectActiveSetup and evaluateSetupMatches
const exactAuto = detectActiveSetup(autoApplied);
assert.equal(exactAuto.activeSetup.id, 'autonomous_builder');
assert.equal(exactAuto.isExactMatch, true);
assert.equal(exactAuto.matchScore, 100);
assert.equal(exactAuto.divergentCount, 0);

const exactArch = detectActiveSetup(archApplied);
assert.equal(exactArch.activeSetup.id, 'architect_planner');
assert.equal(exactArch.isExactMatch, true);
assert.equal(exactArch.matchScore, 100);

// Modify one setting on autonomous_builder to test divergence detection
const divergentSettings = { ...autoApplied, autoAcceptEdits: false };
const divergentResult = detectActiveSetup(divergentSettings);
assert.equal(divergentResult.activeSetup.id, 'autonomous_builder');
assert.equal(divergentResult.isExactMatch, false);
assert.equal(divergentResult.divergentCount, 1);
assert.deepEqual(divergentResult.divergentKeys, ['autoAcceptEdits']);

// 5. Test getToggleGuidance
const autoGuidanceAligned = getToggleGuidance('buildModeEnabled', autoApplied, 'autonomous_builder');
assert.equal(autoGuidanceAligned.recommendedValue, true);
assert.equal(autoGuidanceAligned.isAligned, true);
assert.match(autoGuidanceAligned.badgeLabel, /Recommended ON/i);

const autoGuidanceDivergent = getToggleGuidance('autoAcceptEdits', divergentSettings, 'autonomous_builder');
assert.equal(autoGuidanceDivergent.recommendedValue, true);
assert.equal(autoGuidanceDivergent.isAligned, false);
assert.match(autoGuidanceDivergent.badgeLabel, /recommends ON/i);

// 6. Test Provider Alignment Matrix
const providers = ['dgx-spark', 'featherless', 'platform', 'abliteration', 'custom'];
for (const p of providers) {
  const alignment = getProviderSetupAlignment(p);
  assert.ok(alignment, `Alignment must exist for provider ${p}`);
  assert.equal(alignment.provider, p);
  assert.ok(alignment.recommendedSetupId);
  assert.ok(alignment.recommendedMode);
  assert.ok(alignment.recommendedNumbers.maxAgentTurns > 0);
  assert.ok(alignment.recommendedNumbers.selfDeepenPasses >= 0);
  assert.ok(alignment.tips.length > 0);
}

// 7. Test alignSetupForProvider: DGX Spark (Local High-Compute)
const sparkAligned = alignSetupForProvider(baseSettings, 'dgx-spark');
assert.equal(sparkAligned.agentMode, 'agent');
assert.equal(sparkAligned.maxAgentTurns, 40);
assert.equal(sparkAligned.selfDeepenPasses, 3);
assert.equal(sparkAligned.verifyStrictProfile, true);
assert.equal(sparkAligned.jobWorktreesEnabled, true);
assert.equal(sparkAligned.postEditDiagnostics, true);
assert.equal(sparkAligned.remoteHostEnabled, true);

const sparkStatus = checkProviderAlignment(sparkAligned, 'dgx-spark');
assert.equal(sparkStatus.isAligned, true);
assert.equal(sparkStatus.divergentNumbers.length, 0);
assert.match(sparkStatus.summary, /Optimally tuned for DGX Spark/i);

// 8. Test alignSetupForProvider: Featherless (Serverless Open-Weights)
const featherAligned = alignSetupForProvider(baseSettings, 'featherless');
assert.equal(featherAligned.agentMode, 'plan');
assert.equal(featherAligned.planModeEnabled, true);
assert.equal(featherAligned.maxAgentTurns, 20);
assert.equal(featherAligned.selfDeepenPasses, 1);
assert.equal(featherAligned.deepenCompleteness, false);
assert.equal(featherAligned.mempalaceAutoRecall, true);
assert.equal(featherAligned.completionFooterEnabled, true);

const featherStatus = checkProviderAlignment(featherAligned, 'featherless');
assert.equal(featherStatus.isAligned, true);
assert.equal(featherStatus.divergentNumbers.length, 0);
assert.match(featherStatus.summary, /Optimally tuned for Featherless/i);

// 9. Test alignSetupForProvider: Custom (Defensive BYOK)
const customAligned = alignSetupForProvider(baseSettings, 'custom');
assert.equal(customAligned.agentMode, 'plan');
assert.equal(customAligned.maxAgentTurns, 16);
assert.equal(customAligned.autoAcceptEdits, false);
assert.equal(customAligned.autoRunShell, false);

const customStatus = checkProviderAlignment(customAligned, 'custom');
assert.equal(customStatus.isAligned, true);

// 10. Test provider-aware getToggleGuidance
const sparkGuidance = getToggleGuidance('jobWorktreesEnabled', sparkAligned, 'autonomous_builder', 'dgx-spark');
assert.equal(sparkGuidance.recommendedValue, true);
assert.equal(sparkGuidance.isAligned, true);
assert.match(sparkGuidance.tooltip, /DGX Spark optimization/i);

// 11. Test checkProviderAlignment when divergent
const divergentFromSpark = { ...sparkAligned, maxAgentTurns: 10 };
const divStatus = checkProviderAlignment(divergentFromSpark, 'dgx-spark');
assert.equal(divStatus.isAligned, false);
assert.equal(divStatus.divergentNumbers.length, 1);
assert.equal(divStatus.divergentNumbers[0].key, 'maxAgentTurns');

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-agent-presets.mjs ok! All tests passed.');
