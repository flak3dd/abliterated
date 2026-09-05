import { ALL_TOOL_TYPES, type ChatOpenAiMessage, type ClientSettings, type ToolCallPayload, type ToolType } from '../types';
import { resolveActiveSettings } from './activeEndpoint';
import { endpointUrl } from './apiUrl';
import { detokenizeArtifacts } from './detokenizeArtifacts';

export interface StreamChatArgs {
  settings: ClientSettings;
  model: string;
  messages: ChatOpenAiMessage[];
  abortSignal?: AbortSignal;
  enabledTools?: ToolType[];
  extraTools?: typeof CHAT_TOOLS;
  onDelta: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
  onToolCallComplete?: (tool: ToolCallPayload) => void;
  toolChoice?: 'auto' | 'required';
}

export type StreamChatResult = {
  finishReason: string;
  toolCalls: ToolCallPayload[];
};

function lastUserPrompt(messages: ChatOpenAiMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function dummyEcho(prompt: string, onDelta: (text: string) => void, signal?: AbortSignal): Promise<void> {
  const text = `[Local Dummy] Echo: ${prompt}`;
  for (const ch of text) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    onDelta(ch);
    await sleep(12, signal);
  }
}

type ToolAcc = {
  id: string;
  name: string;
  arguments: string;
};

export const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read a file from the live workspace. Call this before citing or editing file contents. Never invent file contents.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the workspace root' },
          file: { type: 'string', description: 'Alias for path' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search file contents under the workspace root. Returns path:line:content like ripgrep.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'JS RegExp source, or substring if invalid' },
          path: { type: 'string', description: 'File or directory relative to workspace root (default .)' },
          glob: { type: 'string', description: 'Optional glob filter e.g. **/*.ts' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'List files under the workspace root matching a glob (supports *, **, ?).',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern e.g. src/**/*.ts' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and directories at a path relative to the workspace root (skips node_modules/.git). Use this to analyze/list directories — do not emit markdown bash ls/tree fences for discovery; call this tool and describe the result.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory relative to workspace root (default .)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_outline',
      description:
        'Return a compact outline of a file (exports, functions, classes, types, headings). Prefer before reading a large file whole.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace root' },
          file: { type: 'string', description: 'Alias for path' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'semantic_search',
      description:
        'Workspace search ranked by relevance (lexical + path scoring; not embeddings). Returns path:line:excerpt. Prefer before inventing structure.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language or keyword search query' },
          path: { type: 'string', description: 'Optional subdirectory to search under' },
          glob: { type: 'string', description: 'Optional glob filter e.g. **/*.{ts,tsx}' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Show git status (porcelain + branch) for the workspace. Prefer this over shell git status.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description:
        'Stage and commit inside the workspace root. Prefer this over shell git commit. Does not push. Message is required.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Commit message' },
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional paths to stage. Omit to git add -A . inside the root.',
          },
        },
        required: ['message'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Show git diff for the workspace (unstaged by default). Set staged=true for --cached. Optional path filter.',
      parameters: {
        type: 'object',
        properties: {
          staged: { type: 'boolean', description: 'If true, show staged/cached diff' },
          path: { type: 'string', description: 'Optional path relative to workspace root' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_pr',
      description:
        'Create a pull request with the GitHub gh CLI (gh pr create). Does not push unless gh does. Gated like git_commit unless auto-accept is on.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'PR title' },
          body: { type: 'string', description: 'PR body/description' },
          base: { type: 'string', description: 'Optional base branch' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkpoint_save',
      description: 'Save a lightweight workspace checkpoint under .ablit/checkpoints/ (git patches + status).',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Optional label' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkpoint_restore',
      description: 'Restore a previously saved checkpoint by id (best-effort git apply). Gated like git_commit unless auto-accept is on.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Checkpoint id from checkpoint_save' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'shell',
      description: 'Run a shell command in the workspace root. Prefer list_dir/glob/read_file/grep for inspection; use shell for builds/tests/scripts. Output comes back as a tool result only if executed (click-to-run or auto-run) — emitting ls/tree in a markdown bash fence does not run and gives no data.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description:
        'Generate an image via the optional local OpenAI-compatible image endpoint (not api.abliteration.ai). Requires image gen enabled in settings.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Image prompt' },
          size: { type: 'string', description: 'e.g. 1024x1024, 768x768, 512x512' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch a URL and return its text content. http(s) only.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'HTTP or HTTPS URL' },
        },
        required: ['url'],
      },
    },
  },
];

export function filterChatTools(
  enabled?: ToolType[],
  opts?: { imageGenEnabled?: boolean; extraTools?: typeof CHAT_TOOLS },
) {
  let tools = CHAT_TOOLS;
  if (enabled) {
    const set = new Set(enabled);
    tools = CHAT_TOOLS.filter((t) => set.has(t.function.name as ToolType));
  }
  if (!opts?.imageGenEnabled) {
    tools = tools.filter((t) => t.function.name !== 'generate_image');
  }
  if (opts?.extraTools?.length) {
    tools = [...tools, ...opts.extraTools];
  }
  return tools;
}

function isToolType(name: string): name is ToolType {
  return (ALL_TOOL_TYPES as readonly string[]).includes(name);
}

function materializeTools(acc: Map<number, ToolAcc>, onToolCallComplete?: (tool: ToolCallPayload) => void): ToolCallPayload[] {
  const out: ToolCallPayload[] = [];
  for (const tool of acc.values()) {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = tool.arguments ? (JSON.parse(tool.arguments) as Record<string, unknown>) : {};
    } catch {
      parsed = { raw: tool.arguments };
    }
    const name = isToolType(tool.name) || tool.name.startsWith('mcp__') ? tool.name : tool.name || 'shell';
    const payload: ToolCallPayload = {
      id: tool.id || `tool_${Math.random().toString(36).slice(2, 8)}`,
      name,
      arguments: parsed,
      status: 'pending',
    };
    out.push(payload);
    onToolCallComplete?.(payload);
  }
  return out;
}

/** Serialize chat streams so concurrent callers never overlap (single-flight). */
let streamChatFlight: Promise<unknown> = Promise.resolve();

export async function streamChatCompletion(args: StreamChatArgs): Promise<StreamChatResult> {
  const run = streamChatFlight.then(() => streamChatCompletionInner(args));
  // Keep the queue alive even if a call rejects; next caller waits either way.
  streamChatFlight = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function streamChatCompletionInner(args: StreamChatArgs): Promise<StreamChatResult> {
  const { settings, model, messages, abortSignal, enabledTools, extraTools, onDelta, onReasoningDelta, onToolCallComplete, toolChoice } = args;
  const active = resolveActiveSettings(settings);
  const provider = settings.inferenceProvider ?? 'abliteration';
  const providerInactive =
    (provider === 'dgx-spark' && !settings.sparkEnabled) ||
    (provider === 'featherless' && settings.featherlessEnabled === false);
  // remoteHostEnabled only gates Abliteration/Custom; Spark/Featherless use their own toggles.
  const needsRemoteToggle = provider === 'abliteration' || provider === 'custom';
  const offline =
    !active.baseUrl.trim() ||
    providerInactive ||
    (needsRemoteToggle && !settings.remoteHostEnabled);

  if (offline) {
    if (providerInactive) {
      throw new Error(
        provider === 'featherless'
          ? 'Featherless is selected but marked unavailable. Enable it in API, or switch provider.'
          : 'DGX Spark is selected but marked unavailable. Enable it in API, or switch provider.',
      );
    }
    await dummyEcho(lastUserPrompt(messages), onDelta, abortSignal);
    return { finishReason: 'stop', toolCalls: [] };
  }

  const url = endpointUrl(
    {
      baseUrl: active.baseUrl,
      sparkViaProxy: active.sparkViaProxy,
      featherlessViaProxy: active.featherlessViaProxy,
      inferenceProvider: active.provider,
    },
    '/chat/completions',
  );
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Retention': 'none',
  };
  if (active.token.trim()) {
    headers.Authorization = `Bearer ${active.token.trim()}`;
  }
  if (active.provider === 'featherless') {
    headers['HTTP-Referer'] = 'http://localhost:5173';
    headers['X-Title'] = 'ablit';
  }
  if (settings.reasoning !== 'off') {
    headers['X-Reasoning'] = settings.reasoning;
  }

  const tools = filterChatTools(enabledTools, { imageGenEnabled: settings.imageGenEnabled === true, extraTools });
  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages,
  };
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = toolChoice || 'auto';
  }
  body.max_tokens = settings.contextLength && settings.contextLength > 0 ? settings.contextLength : 4096;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abortSignal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    const detail = err instanceof Error ? err.message : String(err);
    const offlineHint =
      /Failed to fetch|NetworkError|ECONNREFUSED|load failed/i.test(detail)
        ? ' Provider appears offline or unreachable.'
        : '';
    throw new Error(
      `Chat request failed (${active.provider}): ${detail}.${offlineHint} Check API settings / network.`,
    );
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    const snippet = errText.slice(0, 400);
    const usedRequired = body.tool_choice === 'required';
    const mentionsToolChoice = /tool_choice|tool choice|toolChoice/i.test(snippet);
    if (usedRequired && res.status >= 400 && res.status < 500 && mentionsToolChoice) {
      body.tool_choice = 'auto';
      let retry: Response;
      try {
        retry = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: abortSignal,
        });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Chat retry failed after tool_choice fallback (${active.provider}): ${detail}`,
        );
      }
      if (!retry.ok) {
        const retryText = await retry.text().catch(() => retry.statusText);
        throw new Error(`HTTP ${retry.status}: ${retryText.slice(0, 400)}`);
      }
      if (!retry.body) throw new Error('Empty response body');
      res = retry;
    } else {
      const hint =
        res.status === 429
          ? ' Concurrency/rate limit; model may use full plan per request; Stop chat; wait ~30s; avoid parallel chats/jobs; self-deepen needs a free slot; or switch to cheaper model.'
          : res.status === 401 || res.status === 403
            ? ' Auth/token rejected.'
            : res.status >= 500
              ? ' Provider server error.'
              : '';
      throw new Error(`HTTP ${res.status}: ${snippet}${hint}`);
    }
  }
  if (!res.body) {
    throw new Error('Empty response body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const toolAcc = new Map<number, ToolAcc>();
  let finishReason = 'stop';
  let sawDone = false;

  const handleData = (payload: string) => {
    const trimmed = payload.trim();
    if (!trimmed || trimmed === '[DONE]') {
      if (trimmed === '[DONE]') sawDone = true;
      return trimmed === '[DONE]';
    }
    let json: {
      choices?: Array<{
        delta?: {
          content?: string | null;
          reasoning?: string | null;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string | null;
      }>;
    };
    try {
      json = JSON.parse(trimmed) as typeof json;
    } catch {
      return false;
    }
    const choice = json.choices?.[0];
    const delta = choice?.delta;
    if (delta?.content) onDelta(detokenizeArtifacts(delta.content));
    if (delta?.reasoning) {
      const r = detokenizeArtifacts(delta.reasoning);
      if (onReasoningDelta) onReasoningDelta(r);
      else onDelta(r);
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
    const toolCalls = materializeTools(toolAcc, onToolCallComplete);
    return { finishReason, toolCalls };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}
