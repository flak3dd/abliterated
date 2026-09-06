import { extractHttpErrorMessage } from './providerError';

export type FeatherlessProbeCase = {
  name: string;
  body: Record<string, unknown>;
};

export type FeatherlessProbeRow = {
  name: string;
  status: number;
  ok: boolean;
  detail: string;
  finish?: string;
  content?: string;
};

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

export function featherlessProbeCases(model: string): FeatherlessProbeCase[] {
  const user = [{ role: 'user', content: 'Reply with the single word pong.' }];
  return [
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
    {
      name: 'min_tokens',
      body: { model, stream: false, messages: user, max_tokens: 32, min_tokens: 1 },
    },
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
}

async function readLimited(res: Response, max = 1500): Promise<string> {
  if (!res.body) return await res.text().catch(() => '');
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('event-stream')) {
    const t = await res.text().catch(() => '');
    return t.slice(0, max);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  try {
    while (out.length < max) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
  return out.slice(0, max);
}

function summarizeBody(status: number, text: string): Pick<FeatherlessProbeRow, 'detail' | 'finish' | 'content'> {
  const detail = extractHttpErrorMessage(status, text);
  try {
    const json = JSON.parse(text) as {
      choices?: Array<{
        finish_reason?: string;
        message?: { content?: string | null };
        delta?: { content?: string | null };
      }>;
    };
    const ch = json.choices?.[0];
    const content = ch?.message?.content ?? ch?.delta?.content ?? undefined;
    return {
      detail: status >= 400 ? detail : 'ok',
      finish: ch?.finish_reason,
      content: content == null ? undefined : String(content).slice(0, 160),
    };
  } catch {
    const data = text.split('\n').find((l) => l.startsWith('data: ') && !l.includes('[DONE]'));
    if (data) {
      try {
        const json = JSON.parse(data.slice(6)) as {
          choices?: Array<{ finish_reason?: string; delta?: { content?: string | null } }>;
        };
        const ch = json.choices?.[0];
        return {
          detail: status >= 400 ? detail : 'ok',
          finish: ch?.finish_reason,
          content: ch?.delta?.content ? String(ch.delta.content).slice(0, 160) : undefined,
        };
      } catch {
        /* fall through */
      }
    }
    return { detail: status >= 400 ? detail : text.slice(0, 200) || 'ok' };
  }
}

export async function probeFeatherlessChat(opts: {
  url: string;
  token: string;
  model: string;
  extraHeaders?: Record<string, string>;
}): Promise<FeatherlessProbeRow[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'HTTP-Referer': 'http://localhost:5173',
    'X-Title': 'ablit',
    ...(opts.extraHeaders || {}),
  };
  if (opts.token.trim()) headers.Authorization = `Bearer ${opts.token.trim()}`;

  const rows: FeatherlessProbeRow[] = [];
  for (const c of featherlessProbeCases(opts.model)) {
    try {
      const res = await fetch(opts.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(c.body),
      });
      const text = await readLimited(res);
      const sum = summarizeBody(res.status, text);
      rows.push({ name: c.name, status: res.status, ok: res.ok, ...sum });
    } catch (err) {
      rows.push({
        name: c.name,
        status: 0,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return rows;
}

export function formatFeatherlessProbeReport(opts: {
  model: string;
  modelsHint?: string;
  features?: string;
  rows: FeatherlessProbeRow[];
}): string {
  const lines = [
    `Featherless debug · model ${opts.model}`,
    opts.features ? `features: ${opts.features}` : '',
    opts.modelsHint ? opts.modelsHint : '',
    '',
    'case            status  result',
    '--------------- ------- ------',
  ].filter(Boolean);
  for (const r of opts.rows) {
    const extra = [r.finish, r.content != null ? JSON.stringify(r.content) : '']
      .filter(Boolean)
      .join(' ');
    lines.push(
      `${r.name.padEnd(15)} ${String(r.status).padEnd(7)} ${r.ok ? 'ok' : r.detail}${extra ? ` · ${extra}` : ''}`,
    );
  }
  const bad = opts.rows.filter((r) => !r.ok);
  if (bad.length) {
    lines.push('', `failed: ${bad.map((r) => r.name).join(', ')}`);
  } else {
    lines.push('', 'all cases returned HTTP 2xx');
  }
  return lines.join('\n');
}
