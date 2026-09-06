#!/usr/bin/env node
/**
 * Probe Featherless chat cases for a model. Does not print the API key.
 *   FEATHERLESS_API_KEY=... node scripts/debug-featherless.mjs [model]
 */
const token = (process.env.FEATHERLESS_API_KEY || process.env.FEATHERLESS_TOKEN || '').trim();
const model = process.argv[2] || 'Qwen/Qwen2.5-7B-Instruct';
if (!token) {
  console.error(
    'Set FEATHERLESS_API_KEY and rerun.\n  FEATHERLESS_API_KEY=fl-... node scripts/debug-featherless.mjs Qwen/Qwen2.5-7B-Instruct',
  );
  process.exit(1);
}

const ECHO_TOOL = [
  {
    type: 'function',
    function: {
      name: 'echo',
      description: 'Echo a short string',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
    },
  },
];
const user = [{ role: 'user', content: 'Reply with the single word pong.' }];
const cases = [
  { name: 'plain', body: { model, stream: false, messages: user, max_tokens: 32 } },
  { name: 'stream', body: { model, stream: true, messages: user, max_tokens: 32 } },
  {
    name: 'tools-auto',
    body: { model, stream: false, messages: user, max_tokens: 64, tools: ECHO_TOOL, tool_choice: 'auto' },
  },
  {
    name: 'tools-required',
    body: { model, stream: false, messages: user, max_tokens: 64, tools: ECHO_TOOL, tool_choice: 'required' },
  },
  {
    name: 'kwargs-thinking-off',
    body: {
      model,
      stream: false,
      messages: user,
      max_tokens: 32,
      chat_template_kwargs: { enable_thinking: false },
    },
  },
  { name: 'min_tokens', body: { model, stream: false, messages: user, max_tokens: 32, min_tokens: 1 } },
  {
    name: 'reasoning_content',
    body: {
      model,
      stream: false,
      max_tokens: 32,
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello', reasoning_content: 'thinking' },
        { role: 'user', content: 'Reply with the single word pong.' },
      ],
    },
  },
];

function extractMsg(status, text) {
  const raw = String(text || '').trim();
  try {
    const json = JSON.parse(raw);
    const err = json.error;
    if (typeof err === 'string' && err.trim()) return err.trim();
    if (err && typeof err === 'object' && typeof err.message === 'string') return err.message.trim();
    if (typeof json.message === 'string' && json.message.trim()) return json.message.trim();
  } catch {
    /* plain */
  }
  return raw.slice(0, 240) || `HTTP ${status}`;
}

const base = 'https://api.featherless.ai/v1';
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'http://localhost:5173',
  'X-Title': 'ablit',
};

let features = '';
let modelsHint = '';
try {
  const detailRes = await fetch(`${base}/models/${model}`, { headers });
  const detailText = await detailRes.text();
  if (detailRes.ok) {
    const json = JSON.parse(detailText);
    features = JSON.stringify(json.features ?? {}) + ` context=${json.context_length ?? ''}`;
  } else {
    features = `GET model ${detailRes.status}: ${extractMsg(detailRes.status, detailText)}`;
  }
} catch (err) {
  features = err instanceof Error ? err.message : String(err);
}
try {
  const toolRes = await fetch(`${base}/models?capabilities=tool-use&per_page=5`, { headers });
  const toolText = await toolRes.text();
  if (toolRes.ok) {
    const json = JSON.parse(toolText);
    const ids = (json.data || []).map((m) => m.id).filter(Boolean);
    modelsHint = 'tool-use sample: ' + (ids.join(', ') || '(none)');
  } else {
    modelsHint = `GET tool-use ${toolRes.status}: ${extractMsg(toolRes.status, toolText)}`;
  }
} catch (err) {
  modelsHint = err instanceof Error ? err.message : String(err);
}

const rows = [];
for (const c of cases) {
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(c.body),
    });
    const text = (await res.text()).slice(0, 1500);
    let finish = '';
    let content = '';
    try {
      const json = JSON.parse(text);
      finish = json.choices?.[0]?.finish_reason || '';
      content = json.choices?.[0]?.message?.content ?? '';
    } catch {
      /* sse or plain */
    }
    rows.push({
      name: c.name,
      status: res.status,
      ok: res.ok,
      detail: res.ok ? 'ok' : extractMsg(res.status, text),
      finish,
      content: typeof content === 'string' ? content.slice(0, 80) : '',
    });
  } catch (err) {
    rows.push({
      name: c.name,
      status: 0,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
      finish: '',
      content: '',
    });
  }
}

console.log(`Featherless debug · model ${model}`);
console.log(`features: ${features}`);
console.log(modelsHint);
console.log('');
console.log('case            status  result');
console.log('--------------- ------- ------');
for (const r of rows) {
  const extra = [r.finish, r.content ? JSON.stringify(r.content) : ''].filter(Boolean).join(' ');
  console.log(`${r.name.padEnd(15)} ${String(r.status).padEnd(7)} ${r.ok ? 'ok' : r.detail}${extra ? ` · ${extra}` : ''}`);
}
const bad = rows.filter((r) => !r.ok);
console.log('');
console.log(bad.length ? `failed: ${bad.map((r) => r.name).join(', ')}` : 'all cases returned HTTP 2xx');
