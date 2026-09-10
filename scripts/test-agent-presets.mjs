#!/usr/bin/env node
/**
 * Unit tests for agentPresets module.
 * Tests setup profiles, match detection, toggle alignment, and setup application.
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

const mod = await import(pathToFileURL(path.join(outDir, 'agentPresets.js')).href);
const {
  AGENT_SETUP_PROFILES,
  TRACKED_TOGGLE_KEYS,
  applyAgentSetup,
  detectActiveSetup,
  evaluateSetupMatches,
  getSettingToggleValue,
  getToggleGuidance,
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
};

// Apply autonomous_builder
const autoApplied = applyAgentSetup(baseSettings, 'autonomous_builder');
assert.equal(autoApplied.buildModeEnabled, true);
assert.equal(autoApplied.planModeEnabled, false);
assert.equal(autoApplied.autoAcceptEdits, true);
assert.equal(autoApplied.verifyStrictProfile, true);
assert.equal(autoApplied.selfDeepenEnabled, true);
assert.equal(autoApplied.maxAgentTurns, 30);

// Apply architect_planner
const archApplied = applyAgentSetup(baseSettings, 'architect_planner');
assert.equal(archApplied.planModeEnabled, true);
assert.equal(archApplied.buildModeEnabled, false);
assert.equal(archApplied.autoAcceptEdits, false);
assert.equal(archApplied.autoRunShell, false);

// Apply fast_chat
const fastApplied = applyAgentSetup(baseSettings, 'fast_chat');
assert.equal(fastApplied.selfDeepenEnabled, false);
assert.equal(fastApplied.deepenCompleteness, false);
assert.equal(fastApplied.selfDeepenPasses, 0);

// Apply multi_agent
const multiApplied = applyAgentSetup(baseSettings, 'multi_agent');
assert.equal(multiApplied.multiAgentEnabled, true);
assert.equal(multiApplied.jobWorktreesEnabled, true);
assert.equal(multiApplied.maxConcurrentJobs, 2);

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

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-agent-presets.mjs ok!');
