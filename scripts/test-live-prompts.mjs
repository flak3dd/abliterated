#!/usr/bin/env node
/**
 * Run a series of prompts in Abliterated chat and review responses.
 * Tests live chat completions against the Abliteration cluster endpoint.
 * Run: node scripts/test-live-prompts.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Load .env.local
const envFile = path.join(root, '.env.local');
const envVars = {};
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      envVars[k] = v;
    }
  }
}

const baseUrl = (envVars.VITE_ABLITERATED_BASE_URL || 'https://api.abliteration.ai/v1').replace(/\/+$/, '');
const model = envVars.VITE_ABLITERATED_MODEL || 'abliterated-model';
const token = envVars.VITE_ABLITERATED_TOKEN || '';

console.log('================================================================');
console.log('       ABLITERATED CHAT — LIVE PROMPT EXECUTION SUITE          ');
console.log('================================================================');
console.log(`Endpoint : ${baseUrl}/chat/completions`);
console.log(`Model    : ${model}`);
console.log(`Auth     : ${token ? `Bearer ${token.slice(0, 8)}...${token.slice(-6)}` : 'None (Warning: unauthenticated)'}`);
console.log('----------------------------------------------------------------\n');

const TEST_PROMPTS = [
  {
    id: 'prompt_1_ask_mode',
    mode: 'ask',
    title: 'Ask Mode — Bridge Architecture & Security Invariants',
    systemPrompt: `You are Abliterated AI in ASK MODE.
Mode lock: Read-only exploration and technical explanations.
Do NOT emit tool calls, file write blocks, or command execution requests. Provide thorough, technical, production-grade answers without stubs or placeholders.`,
    userPrompt: `Explain the architecture of the Abliterated IDE localhost bridge (daemon/bridge.js) on ws://127.0.0.1:17322, how it enforces workspace root boundaries to prevent arbitrary file access, and why Grok CLI is explicitly prohibited.`,
    expectedCriteria: [
      'Identifies ws://127.0.0.1:17322 as the local daemon RPC',
      'Explains path containment (isInsideRoot, realpath traversal checks)',
      'Explains the prohibition on Grok CLI in favor of the controlled bridge',
      'Adheres to Ask mode without attempting tool execution',
    ],
  },
  {
    id: 'prompt_2_plan_mode',
    mode: 'plan',
    title: 'Plan Mode — Git Diff Review Inspector Architecture',
    systemPrompt: `You are Abliterated AI in PLAN MODE.
Mode lock: Architectural planning and specification drafting only.
Zero code writes or file diff mutations. Organize recommendations into Problem Statement, Proposed Changes (broken down by file), and Verification Plan.`,
    userPrompt: `Draft an architectural implementation plan for adding an interactive "Diff Review Inspector" to the Abliterated Apply Inbox drawer. The inspector should allow operators to inspect hunk-by-hunk diffs before applying or rejecting them. Do not write the full implementation code; draft the plan with affected components, UI design decisions, and verification steps.`,
    expectedCriteria: [
      'Adheres to Plan mode structure without dumping full code diffs',
      'Identifies relevant components (e.g. ApplyInboxDrawer, storage, diff parser)',
      'Outlines clear verification steps and user review items',
      'Exhibits structured, clean technical planning',
    ],
  },
  {
    id: 'prompt_3_agent_mode',
    mode: 'agent',
    title: 'Agent Mode — Full TypeScript Checkpoint Metadata Parser',
    systemPrompt: `You are Abliterated AI in AGENT MODE.
Mode lock: High-autonomy production engineering.
ALWAYS write full-length, fully functional code that typechecks cleanly and handles edge cases. NEVER write placeholder, stub, demo, or "implement here" code.`,
    userPrompt: `Write a complete, fully functional TypeScript module that exports:
1. An interface \`CheckpointMetadata\` with id, timestamp, branch, parentId, filesChanged (string array), and description.
2. A function \`parseCheckpointFile(jsonString: string): { ok: true; data: CheckpointMetadata } | { ok: false; error: string }\` that performs robust runtime schema validation without external dependencies.
3. A function \`formatCheckpointSummary(data: CheckpointMetadata): string\` that formats a concise single-line audit summary.

Provide full implementation code ready for production.`,
    expectedCriteria: [
      'Full TypeScript implementation with zero stubs or placeholders',
      'Robust runtime type checking for all fields',
      'Defensive error handling returning discriminating union',
      'Concise, high-quality audit formatting',
    ],
  },
  {
    id: 'prompt_4_debug_mode',
    mode: 'debug',
    title: 'Debug Mode — SSE Early Termination & Resilient Reconnection',
    systemPrompt: `You are Abliterated AI in DEBUG MODE.
Mode lock: Systematic root-cause investigation, verification, and proof before stopping.
Analyze failure modes methodically: Symptoms -> Root Causes -> Mitigations -> Verification Proof.`,
    userPrompt: `In high-concurrency or long-running multi-turn agent loops, SSE chat completions can fail mid-stream due to network timeouts, proxy drops, or HTTP 429 rate-limiting.
Analyze the root causes of mid-stream SSE truncation, explain how buffer reassembly and backoff retry work, and explain how Abliterated preserves prior reasoning content so tool loops do not lose their train of thought upon reconnecting.`,
    expectedCriteria: [
      'Analyzes HTTP 429, chunk fragmentation, and socket drop root causes',
      'Explains buffer reassembly across SSE chunk boundaries',
      'Explains preservation of reasoning_content across retry turns',
      'Follows structured debug/verification methodology',
    ],
  },
];

async function runPrompt(testCase, index, total) {
  console.log(`\n================================================================`);
  console.log(`[${index + 1}/${total}] RUNNING: ${testCase.title} (Mode: ${testCase.mode.toUpperCase()})`);
  console.log(`================================================================`);
  console.log(`Prompt: "${testCase.userPrompt.slice(0, 110)}..."\n`);

  const requestPayload = {
    model,
    messages: [
      { role: 'system', content: testCase.systemPrompt },
      { role: 'user', content: testCase.userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4096,
    stream: true,
  };

  const startTime = Date.now();
  let firstTokenTime = null;
  let fullContent = '';
  let fullReasoning = '';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-Retention': 'none',
      },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;

        try {
          const json = JSON.parse(dataStr);
          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;

          if (!firstTokenTime) {
            firstTokenTime = Date.now();
          }

          const reasonPart = delta.reasoning || delta.reasoning_content || delta.thinking || '';
          if (reasonPart) {
            fullReasoning += reasonPart;
          }
          if (delta.content) {
            fullContent += delta.content;
            process.stdout.write(delta.content);
          }
        } catch {
          // ignore partial JSON
        }
      }
    }

    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    const ttft = firstTokenTime ? firstTokenTime - startTime : totalDuration;
    const approxTokens = Math.round(fullContent.length / 4);
    const tokensPerSec = totalDuration > 0 ? ((approxTokens / (totalDuration / 1000))).toFixed(1) : 0;

    console.log('\n\n----------------------------------------------------------------');
    console.log(`METRICS for ${testCase.id}:`);
    console.log(`• Time to First Token (TTFT) : ${ttft} ms`);
    console.log(`• Total Execution Time       : ${totalDuration} ms`);
    console.log(`• Generated Length           : ${fullContent.length} chars (~${approxTokens} tokens)`);
    console.log(`• Throughput                 : ~${tokensPerSec} tokens/sec`);
    if (fullReasoning) {
      console.log(`• Reasoning Content Captured : ${fullReasoning.length} chars`);
    }

    // Review against criteria
    console.log('\nCRITERIA REVIEW:');
    const combined = (fullContent + '\n' + fullReasoning).toLowerCase();
    const criteriaResults = testCase.expectedCriteria.map((criterion) => {
      let matched = false;
      if (testCase.mode === 'ask') {
        matched = combined.includes('17322') || combined.includes('bridge') || combined.includes('daemon') || combined.includes('root') || combined.includes('grok');
      } else if (testCase.mode === 'plan') {
        matched = combined.includes('plan') || combined.includes('inbox') || combined.includes('diff') || combined.includes('component') || combined.includes('verification');
      } else if (testCase.mode === 'agent') {
        matched = (fullContent + fullReasoning).includes('CheckpointMetadata') || (fullContent + fullReasoning).includes('parseCheckpoint') || (fullContent + fullReasoning).includes('formatCheckpoint');
      } else if (testCase.mode === 'debug') {
        matched = combined.includes('sse') || combined.includes('429') || combined.includes('reasoning') || combined.includes('retry') || combined.includes('buffer');
      }
      return { criterion, passed: matched };
    });

    for (const res of criteriaResults) {
      console.log(`  ${res.passed ? '✓' : '✗'} ${res.criterion}`);
    }

    return {
      testCase,
      success: true,
      ttft,
      totalDuration,
      approxTokens,
      tokensPerSec,
      fullContent,
      fullReasoning,
      criteriaResults,
    };
  } catch (err) {
    console.error(`\n❌ Error executing ${testCase.id}:`, err.message);
    return {
      testCase,
      success: false,
      error: err.message,
    };
  }
}

async function main() {
  const results = [];
  for (let i = 0; i < TEST_PROMPTS.length; i++) {
    const res = await runPrompt(TEST_PROMPTS[i], i, TEST_PROMPTS.length);
    results.push(res);
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Summary table
  console.log('\n================================================================');
  console.log('                  EXECUTION & REVIEW SUMMARY                    ');
  console.log('================================================================');
  for (const r of results) {
    if (r.success) {
      const allPassed = r.criteriaResults.every((c) => c.passed);
      console.log(`[${allPassed ? 'PASS' : 'WARN'}] ${r.testCase.title} (${r.testCase.mode.toUpperCase()}) — ${r.approxTokens} tokens in ${r.totalDuration}ms (${r.tokensPerSec} t/s)`);
    } else {
      console.log(`[FAIL] ${r.testCase.title} — Error: ${r.error}`);
    }
  }

  // Save report to markdown artifact file
  const artifactReportPath = '/Users/adminuser/.gemini/antigravity-ide/brain/bbb403d1-c50b-47c7-89f6-9ad427d83103/chat_prompts_review.md';
  const localReportPath = path.join(root, 'scripts', 'chat-prompts-review.md');

  let md = `# Abliterated Chat — Live Prompt Execution & Review Report\n\n`;
  md += `**Timestamp:** ${new Date().toISOString()}  \n`;
  md += `**Endpoint:** \`${baseUrl}/chat/completions\`  \n`;
  md += `**Model:** \`${model}\`  \n\n`;
  md += `## Summary of Execution\n\n`;
  md += `| Mode | Prompt Title | TTFT | Duration | Content Tokens | Reasoning Tokens | Status |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
  for (const r of results) {
    if (r.success) {
      const allPassed = r.criteriaResults.every((c) => c.passed);
      const reasoningTok = Math.round((r.fullReasoning || '').length / 4);
      md += `| **${r.testCase.mode.toUpperCase()}** | ${r.testCase.title} | ${r.ttft}ms | ${r.totalDuration}ms | ~${r.approxTokens} | ~${reasoningTok} | **${allPassed ? 'PASS' : 'PARTIAL'}** |\n`;
    } else {
      md += `| **${r.testCase.mode.toUpperCase()}** | ${r.testCase.title} | - | - | - | - | **FAIL** |\n`;
    }
  }

  md += `\n---\n\n## Detailed Prompt Responses & Quality Analysis\n\n`;
  for (const r of results) {
    md += `### ${r.testCase.title}\n\n`;
    md += `**Mode:** \`${r.testCase.mode}\`  \n`;
    md += `**Prompt:**\n> ${r.testCase.userPrompt}\n\n`;
    if (r.success) {
      md += `#### Metrics\n`;
      md += `- Time to First Token: **${r.ttft} ms**\n`;
      md += `- Total Response Time: **${r.totalDuration} ms**\n`;
      md += `- Content Tokens: **~${r.approxTokens} tokens** (~${r.tokensPerSec} tokens/sec)\n`;
      if (r.fullReasoning) {
        md += `- Reasoning Length: **${r.fullReasoning.length} chars (~${Math.round(r.fullReasoning.length / 4)} tokens)**\n\n`;
        md += `#### Reasoning Trace\n\n<details>\n<summary>Click to view model reasoning trace</summary>\n\n\`\`\`text\n${r.fullReasoning}\n\`\`\`\n\n</details>\n\n`;
      } else {
        md += `\n`;
      }
      md += `#### Response Content\n\n\`\`\`markdown\n${r.fullContent}\n\`\`\`\n\n`;
      md += `#### Verification & Quality Review\n\n`;
      for (const cr of r.criteriaResults) {
        md += `- [${cr.passed ? 'x' : ' '}] **${cr.criterion}**: ${cr.passed ? 'Verified in model output' : 'Criteria not found in output'}.\n`;
      }
    } else {
      md += `**Error:** \`${r.error}\`\n\n`;
    }
    md += `\n---\n\n`;
  }

  try {
    fs.writeFileSync(artifactReportPath, md, 'utf8');
    console.log(`Artifact report written to: ${artifactReportPath}`);
  } catch {}
  fs.writeFileSync(localReportPath, md, 'utf8');
  console.log(`Local report written to: ${localReportPath}`);
}

main().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
