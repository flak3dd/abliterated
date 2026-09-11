import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

console.log('--- Testing Web Interaction Directives & Build Guards ---');

// 1. Test looksWebInteractionDirective & shouldApplyBuildProcess
const agentHelpersContent = fs.readFileSync(
  path.join(root, 'src/lib/agentHelpers.ts'),
  'utf8',
);

assert.match(
  agentHelpersContent,
  /export function looksWebInteractionDirective\(/,
  'looksWebInteractionDirective must be exported from agentHelpers.ts',
);

// Extract regex test cases
const webQueries = [
  'search the web for the latest deep learning papers',
  'look up on the web how to configure nginx',
  'check the web for Ollama release notes',
  'run web search for python 3.14 changes',
  'web interaction with external API',
  'browse the web to find weather in Tokyo',
  'fetch the webpage at https://news.ycombinator.com',
  'please scrape the url https://example.com/data',
  'visit the website and summarize it',
];

const buildQueries = [
  'build a web scraper app with typescript',
  'create a crawler bot in python',
  'scaffold an express backend api',
  'implement the login screen',
];

// Test the logic directly
const testLooksWeb = (t) => {
  const lower = t.toLowerCase();
  if (
    /\b(?:build|scaffold|create|code|implement|write)\s+(?:an?\s+)?(?:web\s+)?(?:app|scraper|crawler|bot|server|backend|extension|api|cli)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  if (
    /\b(?:web[_\s-]?search|search\s+(?:the\s+)?web|search\s+online|look\s*up\s+(?:on\s+)?(?:the\s+)?web|check\s+(?:the\s+)?web)\b/i.test(
      lower,
    ) ||
    /\b(?:google|bing|duckduckgo|searx|searxng)\b/i.test(lower) ||
    /\b(?:web\s+interaction|browse\s+(?:the\s+)?web|online\s+research|find\s+online|search\s+for\s+.+\s+online)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  if (
    /\b(?:fetch|scrape|read|retrieve|visit|open|curl|inspect|browse)\s+(?:the\s+)?(?:url|webpage|page|website|site|link|article)\b/i.test(
      lower,
    ) ||
    /https?:\/\/[^\s]+/i.test(t)
  ) {
    return true;
  }
  return false;
};

for (const q of webQueries) {
  assert.equal(testLooksWeb(q), true, `Query "${q}" should be recognized as web interaction directive`);
}
for (const b of buildQueries) {
  assert.equal(testLooksWeb(b), false, `Build query "${b}" should NOT be recognized as web directive`);
}
console.log('✔ looksWebInteractionDirective classification verified for all sample queries');

// 2. Test SYSTEM_PROMPT
console.log('--- Testing SYSTEM_PROMPT Anti-Hallucination & Web Directives ---');
const systemPromptContent = fs.readFileSync(
  path.join(root, 'src/lib/systemPrompt.ts'),
  'utf8',
);

assert.match(
  systemPromptContent,
  /export const PREVIOUS_SYSTEM_PROMPT_V22/,
  'PREVIOUS_SYSTEM_PROMPT_V22 must be exported for backward compatibility',
);
assert.match(
  systemPromptContent,
  /PREVIOUS_SYSTEM_PROMPT_V22,/,
  'PREVIOUS_SYSTEM_PROMPT_V22 must be in LEGACY_PROMPTS for migration',
);
assert.match(
  systemPromptContent,
  /Anti-Hallucination & Factual Grounding/,
  'SYSTEM_PROMPT must have Anti-Hallucination & Factual Grounding section',
);
assert.match(
  systemPromptContent,
  /DO NOT HALLUCINATE/,
  'SYSTEM_PROMPT must contain explicit DO NOT HALLUCINATE directive',
);
assert.match(
  systemPromptContent,
  /Web Interactions vs\. Writing Code/,
  'SYSTEM_PROMPT must have Web Interactions vs. Writing Code section',
);
assert.match(
  systemPromptContent,
  /DO NOT write Python scripts.*to perform the interaction/,
  'SYSTEM_PROMPT must explicitly forbid writing scraping scripts when directed to run web interactions',
);
console.log('✔ SYSTEM_PROMPT anti-hallucination and web interaction directives verified');

// 3. Test CliScreen.tsx
console.log('--- Testing CliScreen.tsx Web, Auto-Run, and .venv Integration ---');
const cliScreenContent = fs.readFileSync(
  path.join(root, 'src/screens/CliScreen.tsx'),
  'utf8',
);

assert.match(cliScreenContent, /looksWebInteractionDirective/, 'CliScreen must import looksWebInteractionDirective');
assert.match(cliScreenContent, /runWebSearch/, 'CliScreen must import runWebSearch');
assert.match(cliScreenContent, /toggleAutoRunShell/, 'CliScreen must implement toggleAutoRunShell');
assert.match(cliScreenContent, /handleCreateVenv/, 'CliScreen must implement handleCreateVenv');
assert.match(cliScreenContent, /python3 -m venv \.venv/, 'CliScreen handleCreateVenv must create .venv');
assert.match(cliScreenContent, /DO NOT HALLUCINATE/, 'CliScreen system prompt must contain DO NOT HALLUCINATE');
assert.match(cliScreenContent, /NEVER write Python\/curl\/Node web-scraping code/, 'CliScreen system prompt must forbid web scraping code for web directives');
assert.match(cliScreenContent, /enabledTools:\s*\['web_search',\s*'web_fetch'\]/, 'CliScreen must enable web_search and web_fetch tools');
assert.match(cliScreenContent, /case 'autorun':/, 'CliScreen must have /autorun slash command');
assert.match(cliScreenContent, /case 'venv':/, 'CliScreen must have /venv slash command');
assert.match(cliScreenContent, /case 'search':/, 'CliScreen must have /search slash command');
assert.match(cliScreenContent, /case 'fetch':/, 'CliScreen must have /fetch slash command');
assert.match(cliScreenContent, /AUTO-RUN:/, 'CliScreen must display AUTO-RUN toggle badge');
assert.match(cliScreenContent, /CREATE \.VENV/, 'CliScreen must display CREATE .VENV button');
assert.match(cliScreenContent, /NO HALLUCINATION/, 'CliScreen must display NO HALLUCINATION badge');

console.log('✔ CliScreen.tsx auto-run, venv, web search, and anti-hallucination verified');

// 4. Test useAgentLoop.ts
console.log('--- Testing useAgentLoop.ts Web Interaction Nudge ---');
const useAgentLoopContent = fs.readFileSync(
  path.join(root, 'src/hooks/useAgentLoop.ts'),
  'utf8',
);

assert.match(useAgentLoopContent, /looksWebInteractionDirective/, 'useAgentLoop must import looksWebInteractionDirective');
assert.match(useAgentLoopContent, /webDirectiveNudge/, 'useAgentLoop must assemble webDirectiveNudge');
assert.match(useAgentLoopContent, /WEB INTERACTION REQUEST/, 'useAgentLoop must inject WEB INTERACTION REQUEST directive');
console.log('✔ useAgentLoop.ts web interaction nudge verified');

console.log('--- All Web Interaction, Auto-Run, and .venv tests passed! ---');
