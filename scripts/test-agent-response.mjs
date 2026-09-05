#!/usr/bin/env node
/**
 * Comprehensive Agent Response Functionality Tests for Abliterated IDE.
 * Tests:
 * 1. Agent settings & turn clamping (clampMaxAgentTurns, clampMaxConcurrentJobs, clampSelfDeepenPasses)
 * 2. Protocol markers (isAnswerCompleteMarker, stripAnswerCompleteMarker, buildSelfDeepenNudge)
 * 3. Multi-step & Large job heuristics (looksMultiStep, looksLargeJob, parseTodoBullets, buildLargeJobNudge)
 * 4. Completion footer parsing & validation (parseCompletionFooter, hasValidCompletionFooter)
 * 5. Pin & Search token extraction (extractAtPins, extractSearchTokens)
 * 6. Tool gating & resumption state machine (isGatedToolStatus, canResumeAfterTool)
 * 7. Tool filtering & MCP tools integration (filterChatTools)
 * 8. End-to-end SSE streaming via mock OpenAI server:
 *    - Text streaming & chunk concatenation
 *    - Reasoning deltas (DeepSeek-style thinking tokens)
 *    - Streaming tool call accumulation across multiple partial chunks
 *    - Multiple concurrent tool calls
 *    - Offline / Dummy echo fallback mode
 *    - AbortSignal cancellation handling
 *    - HTTP error response propagation
 */
import assert from 'node:assert/strict';
import http from 'node:http';

// Ensure browser-like globals in Node test environment
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

const passes = [];
const fails = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result
        .then(() => {
          passes.push(name);
          console.log(`  ✓ ${name}`);
        })
        .catch((err) => {
          fails.push({ name, err });
          console.error(`  ✗ ${name}:`, err.message);
        });
    }
    passes.push(name);
    console.log(`  ✓ ${name}`);
    return Promise.resolve();
  } catch (err) {
    fails.push({ name, err });
    console.error(`  ✗ ${name}:`, err.message);
    return Promise.resolve();
  }
}

// --------------------------------------------------------------------------
// 1. Pure Agent Helpers & Heuristics (Mirroring src/lib/agentHelpers.ts)
// --------------------------------------------------------------------------
const DEFAULT_MAX_AGENT_TURNS = 24;
const MAX_AGENT_TURNS_HARD_CAP = 50;

function clampMaxAgentTurns(n) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_MAX_AGENT_TURNS;
  return Math.min(MAX_AGENT_TURNS_HARD_CAP, Math.max(1, Math.floor(v)));
}

function clampMaxConcurrentJobs(n) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 1;
  return Math.min(4, Math.max(1, Math.floor(v)));
}

function clampSelfDeepenPasses(n) {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return 2;
  return Math.min(5, Math.max(0, Math.floor(v)));
}

function isAnswerCompleteMarker(content) {
  return /^\s*\[ANSWER_COMPLETE\]\s*$/.test(content);
}

function stripAnswerCompleteMarker(content) {
  return content.replace(/\s*\[ANSWER_COMPLETE\]\s*/g, '').trim();
}

function buildSelfDeepenNudge() {
  return (
    '↻ Self-review: Re-read your last answer. Expand thin/missing parts with concrete detail ' +
    '(and tools if needed). If the answer already fully solves the user request, reply with ONLY ' +
    'the token [ANSWER_COMPLETE].'
  );
}

function looksMultiStep(userText) {
  const t = (userText || '').trim();
  if (t.length < 40) return false;
  const lower = t.toLowerCase();
  if (/\b(step[- ]?by[- ]?step|multi[- ]?step|implement|refactor|migrate|rewrite|build|create|add|fix|and then|then|first|next|finally)\b/.test(lower)) {
    return true;
  }
  if ((t.match(/\n/g) || []).length >= 2) return true;
  if (/,.*,.*,/.test(t)) return true;
  return t.length >= 160;
}

function looksLargeJob(userText) {
  const t = (userText || '').trim();
  if (t.length < 80) return false;
  const lower = t.toLowerCase();
  if (
    /\b(implement|refactor|migrate|rewrite|overhaul|architecture|end[- ]to[- ]end|full(?:y)?|across|throughout|feature|subsystem|pipeline|integrate|audit then|plan then)\b/.test(
      lower,
    )
  ) {
    return true;
  }
  if ((t.match(/\n/g) || []).length >= 4) return true;
  if (looksMultiStep(t) && t.length >= 200) return true;
  return t.length >= 320;
}

function parseTodoBullets(text) {
  const raw = text || '';
  const lines = raw.split(/\n/);
  const items = [];
  let inBlock = false;
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+?)\s*$/);
    const header = /^\s*(?:#{1,3}\s*)?(?:to[- ]?do|todo|plan|tasks?)\b/i.test(line);
    if (header) {
      inBlock = true;
      continue;
    }
    if (m) {
      const body = m[1].replace(/\*\*/g, '').trim();
      if (body.length >= 3 && body.length <= 200) {
        items.push(body);
        inBlock = true;
      }
      continue;
    }
    if (inBlock && items.length && line.trim() === '') {
      if (items.length >= 2) break;
      continue;
    }
    if (inBlock && items.length >= 2 && !m) break;
  }
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= 16) break;
  }
  return out.length >= 2 ? out : [];
}

function extractAtPins(text) {
  const out = [];
  const seen = new Set();
  const re = /(?:^|[\s])@([A-Za-z0-9_./+-][A-Za-z0-9_./+-]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let raw = (m[1] || '').replace(/[.,;:!?)]+$/, '');
    if (!raw || raw === '.' || raw === '..') continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

function isGatedToolStatus(status) {
  return status === 'allowed' || status === 'pending';
}

function canResumeAfterTool(messages, messageId) {
  const toolMsg = messages.find((m) => m.id === messageId);
  if (!toolMsg || toolMsg.role !== 'tool') return false;
  const toolId = toolMsg.toolCallId || toolMsg.toolCall?.id || '';
  if (!toolId) return false;

  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length) {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx < 0) return false;
  const assistant = messages[lastAssistantIdx];
  const ids = new Set((assistant.toolCalls || []).map((t) => t.id));
  if (!ids.has(toolId)) return false;

  const related = messages
    .slice(lastAssistantIdx + 1)
    .filter((m) => m.role === 'tool' && ids.has(m.toolCallId || m.toolCall?.id || ''));

  if (related.length < ids.size) return false;
  return related.every((m) => {
    const st = m.toolCall?.status;
    return st === 'executed' || st === 'error';
  });
}

function extractFauxToolCalls(content) {
  if (!content) return [];
  const out = [];
  const seen = new Set();
  const pattern = /(?:```(?:bash|sh|shell)?\s*\n\s*)?^\s*(list_dir|read_file|file_outline|git_status|git_diff|grep|glob|semantic_search)\b([^\n`]*)/gm;

  let m;
  while ((m = pattern.exec(content)) !== null) {
    const name = m[1];
    const rawArg = (m[2] || '').trim();
    const key = `${name}:${rawArg}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (name === 'list_dir') {
      out.push({ name: 'list_dir', arguments: { path: rawArg && rawArg !== '.' ? rawArg : '.' }, rawCommand: m[0].trim() });
    } else if (name === 'git_status') {
      out.push({ name: 'git_status', arguments: {}, rawCommand: m[0].trim() });
    } else if (name === 'git_diff') {
      const staged = /\b--cached\b|\bstaged\b/i.test(rawArg);
      out.push({ name: 'git_diff', arguments: staged ? { staged: true } : {}, rawCommand: m[0].trim() });
    } else if (name === 'read_file' && rawArg) {
      out.push({ name: 'read_file', arguments: { path: rawArg }, rawCommand: m[0].trim() });
    }
  }
  return out;
}

function isSpuriousReviewCommit(commandOrText) {
  if (!commandOrText) return false;
  return /git_commit\b/i.test(commandOrText) && /\b(review|recent|analy[sz]|inspect|history|log|view|diff|check)\b/i.test(commandOrText);
}


// --------------------------------------------------------------------------
// 2. Completion Footer Parser (Mirroring src/lib/completionFooter.ts)
// --------------------------------------------------------------------------
function parseCompletionFooter(content) {
  const raw = content ?? '';
  if (!raw.trim()) return null;
  const re =
    /(?:^|\n)---\s*\n\*\*Done:\*\*[ \t]*([^\n]*(?:\n(?!\*\*Continue:\*\*)[^\n]*)*)\n\*\*Continue:\*\*\s*\n\s*1\.\s*(.+)\n\s*2\.\s*(.+)\n\s*3\.\s*(.+)\s*$/;
  const m = raw.match(re);
  if (!m) return null;

  const summary = (m[1] || '').trim();
  const o1 = (m[2] || '').trim();
  const o2 = (m[3] || '').trim();
  const o3 = (m[4] || '').trim();
  if (!summary || !o1 || !o2 || !o3) return null;

  const body = raw.slice(0, m.index).replace(/\s+$/, '');
  return { body, summary, options: [o1, o2, o3] };
}

function hasValidCompletionFooter(content) {
  return parseCompletionFooter(content) != null;
}

// --------------------------------------------------------------------------
// 3. Tool Filtering (Mirroring src/lib/sse.ts filterChatTools)
// --------------------------------------------------------------------------
const CHAT_TOOLS = [
  { type: 'function', function: { name: 'read_file' } },
  { type: 'function', function: { name: 'grep' } },
  { type: 'function', function: { name: 'glob' } },
  { type: 'function', function: { name: 'shell' } },
  { type: 'function', function: { name: 'generate_image' } },
];

function filterChatTools(enabled, opts) {
  let tools = CHAT_TOOLS;
  if (enabled) {
    const set = new Set(enabled);
    tools = CHAT_TOOLS.filter((t) => set.has(t.function.name));
  }
  if (!opts?.imageGenEnabled) {
    tools = tools.filter((t) => t.function.name !== 'generate_image');
  }
  if (opts?.extraTools?.length) {
    tools = [...tools, ...opts.extraTools];
  }
  return tools;
}

// --------------------------------------------------------------------------
// 4. SSE Parser and Stream Engine (Pure ESM implementation of sse.ts logic)
// --------------------------------------------------------------------------
function materializeTools(acc) {
  const out = [];
  for (const tool of acc.values()) {
    let parsed = {};
    try {
      parsed = tool.arguments ? JSON.parse(tool.arguments) : {};
    } catch {
      parsed = { raw: tool.arguments };
    }
    const payload = {
      id: tool.id || `tool_${Math.random().toString(36).slice(2, 8)}`,
      name: tool.name || 'shell',
      arguments: parsed,
      status: 'pending',
    };
    out.push(payload);
  }
  return out;
}

async function streamChatCompletion({
  url,
  token,
  model,
  messages,
  abortSignal,
  offline = false,
  onDelta,
  onReasoningDelta,
}) {
  if (offline) {
    const prompt = messages[messages.length - 1]?.content || '';
    const text = `[Local Dummy] Echo: ${prompt}`;
    for (const ch of text) {
      if (abortSignal?.aborted) throw new Error('Aborted');
      onDelta(ch);
    }
    return { finishReason: 'stop', toolCalls: [] };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, stream: true, messages }),
    signal: abortSignal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 400)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const toolAcc = new Map();
  let finishReason = 'stop';
  let sawDone = false;

  const handleData = (payload) => {
    const trimmed = payload.trim();
    if (!trimmed || trimmed === '[DONE]') {
      if (trimmed === '[DONE]') sawDone = true;
      return trimmed === '[DONE]';
    }
    let json;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return false;
    }
    const choice = json.choices?.[0];
    const delta = choice?.delta;
    if (delta?.content) onDelta(delta.content);
    const reasoningChunk =
      (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) ||
      (typeof delta?.reasoning === 'string' && delta.reasoning) ||
      (typeof delta?.thinking === 'string' && delta.thinking) ||
      '';
    if (reasoningChunk) {
      if (onReasoningDelta) onReasoningDelta(reasoningChunk);
      else onDelta(reasoningChunk);
    }
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const cur = toolAcc.get(idx) ?? { id: '', name: 'shell', arguments: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        toolAcc.set(idx, cur);
      }
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    return false;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const rawLine of parts) {
        const line = rawLine.replace(/\r$/, '');
        if (!line.startsWith('data:')) continue;
        handleData(line.slice(5).trimStart());
        if (sawDone) break;
      }
      if (sawDone) break;
    }
    if (!sawDone && buffer.trim().startsWith('data:')) {
      handleData(buffer.trim().slice(5).trimStart());
    }
    const toolCalls = materializeTools(toolAcc);
    return { finishReason, toolCalls };
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }
}

// --------------------------------------------------------------------------
// TEST SUITE EXECUTION
// --------------------------------------------------------------------------
console.log('\n=== Running Agent Response Functionality Tests ===\n');

// 1. Settings & Clamps
await test('clampMaxAgentTurns boundary limits', () => {
  assert.equal(clampMaxAgentTurns(24), 24);
  assert.equal(clampMaxAgentTurns(0), 1, 'turn count must be >= 1');
  assert.equal(clampMaxAgentTurns(-5), 1);
  assert.equal(clampMaxAgentTurns(999), 50, 'turn count capped at 50');
  assert.equal(clampMaxAgentTurns('18'), 18);
  assert.equal(clampMaxAgentTurns(undefined), 24);
  assert.equal(clampMaxAgentTurns(NaN), 24);
});

await test('clampMaxConcurrentJobs limits', () => {
  assert.equal(clampMaxConcurrentJobs(1), 1);
  assert.equal(clampMaxConcurrentJobs(0), 1);
  assert.equal(clampMaxConcurrentJobs(2), 2);
  assert.equal(clampMaxConcurrentJobs(10), 4, 'jobs capped at 4');
  assert.equal(clampMaxConcurrentJobs(undefined), 1);
});

await test('clampSelfDeepenPasses limits', () => {
  assert.equal(clampSelfDeepenPasses(2), 2);
  assert.equal(clampSelfDeepenPasses(0), 0);
  assert.equal(clampSelfDeepenPasses(100), 5, 'deepen capped at 5');
  assert.equal(clampSelfDeepenPasses(undefined), 2);
});

// 2. Markers & Deepening Protocol
await test('isAnswerCompleteMarker & stripAnswerCompleteMarker', () => {
  assert.equal(isAnswerCompleteMarker('[ANSWER_COMPLETE]'), true);
  assert.equal(isAnswerCompleteMarker('  [ANSWER_COMPLETE]\n  '), true);
  assert.equal(isAnswerCompleteMarker('I am finished. [ANSWER_COMPLETE]'), false);

  const stripped = stripAnswerCompleteMarker('All done!\n\n[ANSWER_COMPLETE]');
  assert.equal(stripped, 'All done!');
});

await test('buildSelfDeepenNudge contains guidance token', () => {
  const nudge = buildSelfDeepenNudge();
  assert.ok(nudge.includes('[ANSWER_COMPLETE]'));
  assert.ok(nudge.includes('Self-review'));
});

// 3. Multi-Step & Large Job Heuristics
await test('looksMultiStep heuristic', () => {
  assert.equal(looksMultiStep('short ask'), false);
  assert.equal(looksMultiStep('Please implement step by step authentication and token refresh in src/auth.ts'), true);
  assert.equal(looksMultiStep('First read package.json\nthen update typescript\nand finally run tests'), true);
  assert.equal(looksMultiStep('add unit test, update docs, clean up lint, check bundle'), true);
});

await test('looksLargeJob heuristic', () => {
  assert.equal(looksLargeJob('fix typo in readme'), false);
  assert.equal(
    looksLargeJob('We need an end-to-end architecture overhaul of the WebSocket pipeline across all clients'),
    true,
  );
  assert.equal(
    looksLargeJob('Step 1: Audit all database models.\nStep 2: Migrate schema.\nStep 3: Refactor queries.\nStep 4: Add tests.'),
    true,
  );
});

await test('parseTodoBullets parses plan from content', () => {
  const agentText = `
I will address this task in stages.

### Plan
- Read workspace configuration
- Implement responsive layout
- Verify build with tsc
- Run automated smoke probes

Now starting exploration with read_file...
`;
  const todos = parseTodoBullets(agentText);
  assert.equal(todos.length, 4);
  assert.equal(todos[0], 'Read workspace configuration');
  assert.equal(todos[3], 'Run automated smoke probes');
});

// 4. Completion Footer Protocol
await test('parseCompletionFooter extracts body, summary, and 3 options', () => {
  const content = `The authentication service has been refactored.
Files changed:
- src/auth.ts
- src/session.ts

---
**Done:** Verified JWT token rotation and added tests.
**Continue:**
1. Add OAuth2 provider support
2. Configure token expiry in settings
3. Run integration test suite`;

  const parsed = parseCompletionFooter(content);
  assert.ok(parsed !== null);
  assert.ok(parsed.body.includes('The authentication service has been refactored.'));
  assert.equal(parsed.summary, 'Verified JWT token rotation and added tests.');
  assert.equal(parsed.options.length, 3);
  assert.equal(parsed.options[0], 'Add OAuth2 provider support');
  assert.equal(parsed.options[1], 'Configure token expiry in settings');
  assert.equal(parsed.options[2], 'Run integration test suite');
  assert.equal(hasValidCompletionFooter(content), true);
});

await test('parseCompletionFooter rejects invalid or incomplete footers', () => {
  // Only 2 continue options
  const badContent1 = `---
**Done:** All done.
**Continue:**
1. Option A
2. Option B`;
  assert.equal(parseCompletionFooter(badContent1), null);

  // Missing Done section
  const badContent2 = `---
**Continue:**
1. Option A
2. Option B
3. Option C`;
  assert.equal(parseCompletionFooter(badContent2), null);
  assert.equal(hasValidCompletionFooter(badContent2), false);
});

// 5. Pin & Gating Logic
await test('extractAtPins extracts valid paths and removes punctuation', () => {
  const pins = extractAtPins('Check @src/App.tsx, and then @daemon/bridge.js! Also ignore @.');
  assert.deepEqual(pins, ['src/App.tsx', 'daemon/bridge.js']);
});

await test('isGatedToolStatus correctly identifies gating states', () => {
  assert.equal(isGatedToolStatus('pending'), true);
  assert.equal(isGatedToolStatus('allowed'), true);
  assert.equal(isGatedToolStatus('executed'), false);
  assert.equal(isGatedToolStatus('error'), false);
});

await test('canResumeAfterTool handles multi-tool agent turns', () => {
  const messages = [
    {
      id: 'a1',
      role: 'assistant',
      toolCalls: [{ id: 't1' }, { id: 't2' }],
    },
    { id: 'm1', role: 'tool', toolCallId: 't1', toolCall: { id: 't1', status: 'executed' } },
    { id: 'm2', role: 'tool', toolCallId: 't2', toolCall: { id: 't2', status: 'allowed' } },
  ];

  // Tool t2 is still allowed, not executed yet -> cannot resume
  assert.equal(canResumeAfterTool(messages, 'm1'), false);

  // Once t2 is executed -> ready to resume
  messages[2].toolCall.status = 'executed';
  assert.equal(canResumeAfterTool(messages, 'm2'), true);
});

// 6. Tool Filtering
await test('filterChatTools respects whitelist, image toggle, and MCP tools', () => {
  const all = filterChatTools();
  assert.ok(!all.some((t) => t.function.name === 'generate_image'), 'image tool should be disabled by default');

  const withImg = filterChatTools(undefined, { imageGenEnabled: true });
  assert.ok(withImg.some((t) => t.function.name === 'generate_image'));

  const mcpExtra = [{ type: 'function', function: { name: 'mcp__git__commit' } }];
  const withMcp = filterChatTools(['read_file', 'grep'], { extraTools: mcpExtra });
  assert.equal(withMcp.length, 3);
  assert.ok(withMcp.some((t) => t.function.name === 'mcp__git__commit'));
});

// 7. Faux Tool Recovery & Git Commit Safeguards
await test('extractFauxToolCalls recovers pseudo-tool calls from markdown blocks', () => {
  const badResponse = `
I'll analyze the directory structure and contents.

First, I need to list the directories and files in the current workspace.

\`\`\`bash
list_dir .
\`\`\`

Next, I'll check the status of any git repositories.

\`\`\`bash
git_status .
\`\`\`
`;

  const faux = extractFauxToolCalls(badResponse);
  assert.equal(faux.length, 2);
  assert.equal(faux[0].name, 'list_dir');
  assert.deepEqual(faux[0].arguments, { path: '.' });
  assert.equal(faux[1].name, 'git_status');
  assert.deepEqual(faux[1].arguments, {});
});

await test('isSpuriousReviewCommit identifies accidental commit commands when reviewing history', () => {
  assert.equal(isSpuriousReviewCommit('git_commit -m "Recent changes analysis"'), true);
  assert.equal(isSpuriousReviewCommit('git_commit -m "Review recent commits"'), true);
  assert.equal(isSpuriousReviewCommit('git_commit -m "Inspect history"'), true);

  // Normal commits should NOT be flagged
  assert.equal(isSpuriousReviewCommit('git_commit -m "feat: add user login"'), false);
  assert.equal(isSpuriousReviewCommit('git commit -m "fix bug in parser"'), false);
});


// 7. Mock SSE Server & End-to-End Streaming Tests
let mockServer;
let mockPort;
let serverResponses = [];

async function startMockServer() {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      const handler = serverResponses.shift();
      if (!handler) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('No mock response queued');
        return;
      }
      handler(req, res);
    });
    mockServer.listen(0, '127.0.0.1', () => {
      mockPort = mockServer.address().port;
      resolve();
    });
  });
}

await startMockServer();

await test('streamChatCompletion text streaming & chunk aggregation', async () => {
  serverResponses.push((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"from "}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"Abliterated IDE!"},"finish_reason":"stop"}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });

  let received = '';
  const result = await streamChatCompletion({
    url: `http://127.0.0.1:${mockPort}/chat/completions`,
    token: 'test-token',
    model: 'test-model',
    messages: [{ role: 'user', content: 'Say hello' }],
    onDelta: (text) => {
      received += text;
    },
  });

  assert.equal(received, 'Hello from Abliterated IDE!');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.toolCalls.length, 0);
});

await test('streamChatCompletion reasoning token streaming', async () => {
  serverResponses.push((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    res.write('data: {"choices":[{"delta":{"reasoning":"Analyzing file structure... "}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"reasoning":"Plan confirmed. "}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"Here is the result."},"finish_reason":"stop"}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });

  let reasoning = '';
  let content = '';
  const result = await streamChatCompletion({
    url: `http://127.0.0.1:${mockPort}/chat/completions`,
    model: 'test-model',
    messages: [{ role: 'user', content: 'Plan and run' }],
    onDelta: (text) => {
      content += text;
    },
    onReasoningDelta: (text) => {
      reasoning += text;
    },
  });

  assert.equal(reasoning, 'Analyzing file structure... Plan confirmed. ');
  assert.equal(content, 'Here is the result.');
  assert.equal(result.finishReason, 'stop');
});

await test('streamChatCompletion reasoning_content alias (vLLM/OpenAI)', async () => {
  serverResponses.push((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    res.write('data: {"choices":[{"delta":{"reasoning_content":"think then script "}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });

  let reasoning = '';
  const result = await streamChatCompletion({
    url: `http://127.0.0.1:${mockPort}/chat/completions`,
    model: 'test-model',
    messages: [{ role: 'user', content: 'Write a script' }],
    onDelta: () => {},
    onReasoningDelta: (text) => {
      reasoning += text;
    },
  });

  assert.equal(reasoning, 'think then script ');
  assert.equal(result.finishReason, 'stop');
});

await test('streamChatCompletion multi-chunk tool call accumulation', async () => {
  serverResponses.push((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    // Chunk 1: tool call id & name & beginning of arguments
    res.write(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_read_1","function":{"name":"read_file","arguments":"{\\"path\\": "}}]}}]}\n\n',
    );
    // Chunk 2: remaining argument JSON
    res.write(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"src/App.tsx\\"}"}}]}}]}\n\n',
    );
    // Chunk 3: finish_reason: tool_calls
    res.write('data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });

  let received = '';
  const result = await streamChatCompletion({
    url: `http://127.0.0.1:${mockPort}/chat/completions`,
    model: 'test-model',
    messages: [{ role: 'user', content: 'Read App.tsx' }],
    onDelta: (text) => {
      received += text;
    },
  });

  assert.equal(result.finishReason, 'tool_calls');
  assert.equal(result.toolCalls.length, 1);
  const tc = result.toolCalls[0];
  assert.equal(tc.id, 'call_read_1');
  assert.equal(tc.name, 'read_file');
  assert.deepEqual(tc.arguments, { path: 'src/App.tsx' });
  assert.equal(tc.status, 'pending');
});

await test('streamChatCompletion multiple parallel tool calls', async () => {
  serverResponses.push((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    res.write(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc_0","function":{"name":"read_file","arguments":"{\\"path\\": \\"package.json\\"}"}},{"index":1,"id":"tc_1","function":{"name":"grep","arguments":"{\\"pattern\\": \\"react\\"}"}}]}}]}\n\n',
    );
    res.write('data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });

  const result = await streamChatCompletion({
    url: `http://127.0.0.1:${mockPort}/chat/completions`,
    model: 'test-model',
    messages: [{ role: 'user', content: 'Inspect project' }],
    onDelta: () => {},
  });

  assert.equal(result.toolCalls.length, 2);
  assert.equal(result.toolCalls[0].name, 'read_file');
  assert.deepEqual(result.toolCalls[0].arguments, { path: 'package.json' });
  assert.equal(result.toolCalls[1].name, 'grep');
  assert.deepEqual(result.toolCalls[1].arguments, { pattern: 'react' });
});

await test('streamChatCompletion offline fallback mode (dummy echo)', async () => {
  let output = '';
  const result = await streamChatCompletion({
    url: 'http://invalid-offline-host',
    model: 'test-model',
    messages: [{ role: 'user', content: 'Ping offline agent' }],
    offline: true,
    onDelta: (text) => {
      output += text;
    },
  });

  assert.equal(output, '[Local Dummy] Echo: Ping offline agent');
  assert.equal(result.finishReason, 'stop');
  assert.equal(result.toolCalls.length, 0);
});

await test('streamChatCompletion AbortSignal cancellation', async () => {
  serverResponses.push((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"First chunk..."}}]}\n\n');
    // keep socket open to test abort
  });

  const ac = new AbortController();
  let caught = false;

  try {
    const p = streamChatCompletion({
      url: `http://127.0.0.1:${mockPort}/chat/completions`,
      model: 'test-model',
      messages: [{ role: 'user', content: 'Long task' }],
      abortSignal: ac.signal,
      onDelta: () => {
        ac.abort();
      },
    });
    await p;
  } catch (err) {
    caught = true;
    assert.ok(err.name === 'AbortError' || err.message.includes('abort') || err.message.includes('Aborted'));
  }
  assert.equal(caught, true, 'Stream should throw on abort');
});

await test('streamChatCompletion HTTP error response handling', async () => {
  serverResponses.push((req, res) => {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('Invalid bearer token');
  });

  let caught = false;
  try {
    await streamChatCompletion({
      url: `http://127.0.0.1:${mockPort}/chat/completions`,
      model: 'test-model',
      messages: [{ role: 'user', content: 'Test auth' }],
      onDelta: () => {},
    });
  } catch (err) {
    caught = true;
    assert.ok(err.message.includes('HTTP 401'));
    assert.ok(err.message.includes('Invalid bearer token'));
  }
  assert.equal(caught, true, 'Should throw HTTP error');
});

// Close mock server
await new Promise((resolve) => mockServer.close(resolve));

// --------------------------------------------------------------------------
// Summary Output
// --------------------------------------------------------------------------
console.log(`\n=== Agent Response Test Summary ===`);
console.log(`Total: ${passes.length + fails.length} | Passed: ${passes.length} | Failed: ${fails.length}`);

if (fails.length > 0) {
  console.error('\nFailures:');
  for (const f of fails) {
    console.error(`  - ${f.name}: ${f.err.message}`);
  }
  process.exit(1);
} else {
  console.log('\nAll agent response functionality tests PASSED cleanly.\n');
  process.exit(0);
}
