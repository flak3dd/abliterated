#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist-test-capability-router');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
execFileSync(
  'npx',
  [
    'tsc',
    'src/lib/capabilityRouter.ts',
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

const cap = await import(pathToFileURL(path.join(outDir, 'capabilityRouter.js')).href);

const skills = [
  {
    id: 'verify-strict',
    name: 'Verify strict',
    description: 'Quality loop: lock criteria, implement, verify before done.',
    path: 'skills/verify-strict/SKILL.md',
    body: '# Verify\nCall verify after implement.',
    source: 'bundled',
  },
  {
    id: 'playwright-qa',
    name: 'Playwright QA',
    description: 'Browser automation and form fill with Playwright.',
    path: 'skills/playwright-qa/SKILL.md',
    body: '# Steps\n1. Open the page\n2. Fill the form',
    source: 'workspace',
  },
];

const mcp = [
  {
    serverName: 'playwright',
    name: 'browser_click',
    namespaced: 'mcp__playwright__browser_click',
    description: 'Click a locator in the page',
  },
  {
    serverName: 'time',
    name: 'get_current_time',
    namespaced: 'mcp__time__get_current_time',
    description: 'Current time in a timezone',
  },
];

const browserAsk = 'Use Playwright to fill the form on the signup page and screenshot the page';
const matchedSkills = cap.matchSkills(browserAsk, skills);
assert.ok(matchedSkills.some((s) => s.id === 'playwright-qa'), 'playwright skill should match');
assert.equal(
  matchedSkills.some((s) => s.id === 'verify-strict'),
  false,
  'unrelated verify-strict should not match a browser ask',
);

const matchedMcp = cap.matchMcpTools(browserAsk, mcp);
assert.ok(
  matchedMcp.some((t) => t.namespaced === 'mcp__playwright__browser_click'),
  'playwright MCP should match',
);

const plan = cap.planCapabilities({
  queryText: browserAsk,
  skills,
  mcpTools: mcp,
  allowAllMcp: false,
});
assert.ok(plan.systemBlock.includes('Matched skills'));
assert.ok(plan.systemBlock.includes('Matched MCP'));
assert.equal(plan.forceTools, true);
assert.equal(plan.extraMcp.some((t) => t.namespaced.includes('playwright')), true);
assert.equal(cap.needsMcpFollowNudge(plan, []), true);
assert.equal(cap.needsMcpFollowNudge(plan, ['mcp__playwright__browser_click']), false);
assert.equal(cap.needsSkillReadNudge(plan, []), false, 'body already injected — no read nudge');

const missing = cap.planCapabilities({
  queryText: browserAsk,
  skills: [],
  mcpTools: [],
});
assert.ok(missing.missingCatalog.some((e) => e.name === 'playwright'));
assert.ok(missing.systemBlock.includes('not connected'));

const create = cap.planCapabilities({
  queryText: 'Create a skill for our standard way to cut a release whenever we ship',
  skills: [],
  mcpTools: [],
  canWriteSkill: false,
});
assert.equal(create.suggestNewSkill, true);
assert.equal(create.writeSkillNow, false);
assert.equal(cap.needsSkillCreateNudge(create, []), true);
assert.equal(cap.needsSkillCreateNudge(create, ['suggest_skill']), false);

const writeNow = cap.planCapabilities({
  queryText: 'Create a new skill.md for our deploy playbook',
  skills: [],
  mcpTools: [],
  canWriteSkill: true,
});
assert.equal(writeNow.writeSkillNow, true);
assert.match(cap.buildSkillCreateNudge(writeNow), /write_skill/);

const covered = cap.shouldSuggestNewSkill(
  'Create a skill for playwright form fill',
  skills.map((s) => ({ id: s.id, name: s.name, description: s.description })),
  cap.matchSkills('playwright form fill skill', skills),
);
assert.equal(covered, false, 'do not suggest a duplicate of playwright-qa');

const tz = cap.matchMcpTools('what time is it in Tokyo timezone conversion', mcp);
assert.ok(tz.some((t) => t.serverName === 'time'));

fs.rmSync(outDir, { recursive: true, force: true });
console.log('test-capability-router: ok');
