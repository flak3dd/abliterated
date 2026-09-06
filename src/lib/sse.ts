import { ALL_TOOL_TYPES, type ChatOpenAiMessage, type ClientSettings, type ToolCallPayload, type ToolType } from '../types';
import { canonicalizeToolName } from './agentHelpers';
import { missingInferenceAuthError, rejectedInferenceAuthError, resolveActiveSettings } from './activeEndpoint';
import { endpointUrl } from './apiUrl';
import { detokenizeArtifacts } from './detokenizeArtifacts';
import {
  assertBuiltinQuota,
  estimateTokensFromText,
  isBuiltinEndpoint,
  recordBuiltinUsage,
} from './builtinTokens';
import { applyCompletionChunk, thinkingChatTemplateKwargs } from './sseParse';

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
  /** Per-caller flight lane (e.g. "chat" or "job:<id>"). Same lane stays single-flight. */
  flightKey?: string;
  /** Override provider HTTP concurrency cap for this call. */
  concurrencyCap?: number;
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
      description:
        'Run a shell command in the workspace root. Prefer list_dir/glob/read_file/grep for inspection; use shell for builds/tests/scripts. pip install against Homebrew/system Python hits PEP 668 (externally-managed-environment) — the bridge reroutes those to workspace .venv. Output comes back as a tool result only if executed (click-to-run or auto-run) — emitting ls/tree in a markdown bash fence does not run and gives no data.',
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
      name: 'todo',
      description:
        'Create or update the session ToDo checklist (build/plan steps). Prefer this over a markdown-only ToDo list. Aliases: ToDo, todo_write. merge=true updates matching items; omit merge to replace the list.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Checklist items as strings or {text, done} / {content, status} objects',
            items: {
              anyOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                    content: { type: 'string' },
                    done: { type: 'boolean' },
                    status: { type: 'string', description: 'pending | completed | in_progress' },
                  },
                },
              ],
            },
          },
          todos: { type: 'array', description: 'Alias for items' },
          merge: { type: 'boolean', description: 'If true, merge/update by item text instead of replacing' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_skills',
      description:
        'List available SKILL.md recipes (bundled, user global, workspace). Returns JSON catalog of id/name/description/source.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_skill',
      description:
        'Read the full markdown body of a skill by skill_id (slug). Call before following a matching recipe.',
      parameters: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: 'Skill id/slug from list_skills' },
          id: { type: 'string', description: 'Alias for skill_id' },
        },
        required: ['skill_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suggest_skill',
      description:
        'Propose a new reusable build-quality skill without writing. Use only when a clear multi-step process is not already covered. Wait for user confirm before write_skill.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Skill display name' },
          description: { type: 'string', description: 'When to use this skill' },
          body: { type: 'string', description: 'Markdown steps outline' },
          reason: { type: 'string', description: 'Why this skill would help' },
        },
        required: ['name', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_skill',
      description:
        'Save a SKILL.md recipe. Default scope=workspace (.ablit/skills/<slug>/). scope=user writes ~/.abliterated/skills/. Not available in Plan mode. Prefer suggest_skill then confirm first.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          body: { type: 'string', description: 'Markdown body/steps' },
          scope: { type: 'string', description: 'workspace (default) or user' },
        },
        required: ['name', 'description', 'body'],
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
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the public web and return titles, URLs, and snippets. Use when you do not already have a URL. Then web_fetch the best links. Not local-repo search (use semantic_search / grep).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          count: { type: 'number', description: 'How many results (1–12, default 8)' },
        },
        required: ['query'],
      },
    },
  },
];

export function filterChatTools(
  enabled?: ToolType[],
  opts?: { imageGenEnabled?: boolean; skillsEnabled?: boolean; extraTools?: typeof CHAT_TOOLS },
) {
  let tools = CHAT_TOOLS;
  if (enabled) {
    const set = new Set(enabled);
    tools = CHAT_TOOLS.filter((t) => set.has(t.function.name as ToolType) || t.function.name === 'todo');
  }
  if (!opts?.imageGenEnabled) {
    tools = tools.filter((t) => t.function.name !== 'generate_image');
  }
  if (opts?.skillsEnabled === false) {
    const skillNames = new Set(['list_skills', 'read_skill', 'suggest_skill', 'write_skill']);
    tools = tools.filter((t) => !skillNames.has(t.function.name));
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
    const rawName = canonicalizeToolName(tool.name || '');
    const name = isToolType(rawName) || rawName.startsWith('mcp__') ? rawName : rawName || 'shell';
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

/** Per-caller lane queues (chat vs each job id). Overlap across lanes is capped. */
const laneFlights = new Map<string, Promise<unknown>>();
let providerInFlight = 0;
const providerWaiters: Array<() => void> = [];

function providerConcurrencyCap(settings: ClientSettings, override?: number): number {
  if (override != null && override > 0) return Math.min(8, Math.floor(override));
  const jobs = settings.maxConcurrentJobs ?? 1;
  // Chat lane + up to maxConcurrentJobs Jobs may overlap; hard ceiling 4 to avoid Featherless stampede.
  return Math.max(1, Math.min(4, 1 + Math.max(1, jobs)));
}

function acquireProviderSlot(cap: number): Promise<void> {
  if (providerInFlight < cap) {
    providerInFlight += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    providerWaiters.push(() => {
      providerInFlight += 1;
      resolve();
    });
  });
}

function releaseProviderSlot(): void {
  providerInFlight = Math.max(0, providerInFlight - 1);
  const next = providerWaiters.shift();
  if (next) next();
}

export async function streamChatCompletion(args: StreamChatArgs): Promise<StreamChatResult> {
  const lane = (args.flightKey || 'chat').trim() || 'chat';
  const prev = laneFlights.get(lane) || Promise.resolve();
  const cap = providerConcurrencyCap(args.settings, args.concurrencyCap);
  const run = prev.then(async () => {
    await acquireProviderSlot(cap);
    try {
      return await streamChatCompletionInner(args);
    } finally {
      releaseProviderSlot();
    }
  });
  laneFlights.set(
    lane,
    run.then(
      () => undefined,
      () => undefined,
    ),
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

  const missingAuth = missingInferenceAuthError(active);
  if (missingAuth) {
    throw new Error(missingAuth);
  }

  const usingBuiltin = isBuiltinEndpoint(active);
  if (usingBuiltin) {
    assertBuiltinQuota(settings);
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
  };
  // X-Retention / X-Reasoning are Abliteration-only; Featherless ignores or can stall on them.
  if (active.provider !== 'featherless') {
    headers['X-Retention'] = 'none';
    if (settings.reasoning !== 'off') {
      headers['X-Reasoning'] = settings.reasoning;
    }
  }
  if (active.token.trim()) {
    headers.Authorization = `Bearer ${active.token.trim()}`;
  }
  if (active.provider === 'featherless') {
    headers['HTTP-Referer'] = 'http://localhost:5173';
    headers['X-Title'] = 'ablit';
  }

  const tools = filterChatTools(enabledTools, { imageGenEnabled: settings.imageGenEnabled === true, skillsEnabled: settings.skillsEnabled !== false, extraTools });
  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages,
  };
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = toolChoice || 'auto';
  }
  // contextLength is a UI/docs hint for model window — never send it as OpenAI max_tokens.
  const maxTokens =
    typeof (settings as ClientSettings & { maxTokens?: number }).maxTokens === 'number' &&
    (settings as ClientSettings & { maxTokens?: number }).maxTokens! > 0
      ? Math.floor((settings as ClientSettings & { maxTokens?: number }).maxTokens!)
      : 4096;
  body.max_tokens = maxTokens;
  if (usingBuiltin) {
    body.stream_options = { include_usage: true };
  }
  if (active.provider === 'featherless') {
    const kwargs = thinkingChatTemplateKwargs(model, settings.reasoning);
    if (kwargs) body.chat_template_kwargs = kwargs;
  }

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
    } else if (res.status === 429) {
      // One polite backoff retry to avoid Featherless stampedes from overlapping probes/jobs.
      await sleep(1500 + Math.floor(Math.random() * 1500), abortSignal);
      let retry429: Response;
      try {
        retry429 = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: abortSignal,
        });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Chat retry after 429 failed (${active.provider}): ${detail}`);
      }
      if (!retry429.ok) {
        const retryText = await retry429.text().catch(() => retry429.statusText);
        throw new Error(
          `HTTP ${retry429.status}: ${retryText.slice(0, 400)} Concurrency/rate limit; Stop chat; wait ~30s; avoid parallel chats/jobs; or switch model.`,
        );
      }
      if (!retry429.body) throw new Error('Empty response body');
      res = retry429;
    } else {
      const hint =
        res.status === 401 || res.status === 403
          ? rejectedInferenceAuthError(active, snippet)
          : res.status >= 500
            ? ' Provider server error.'
            : '';
      throw new Error(`HTTP ${res.status}: ${snippet}${hint}`);
    }
  }
  const consumeResponse = async (response: Response) => {
    if (!response.body) {
      throw new Error('Empty response body');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let rawAll = '';
    let sawSse = false;
    const toolAcc = new Map<number, ToolAcc>();
    let finishReason = 'stop';
    let sawDone = false;
    let usageTokens = 0;
    let completionChars = 0;
    let reasoningChars = 0;

    const handleData = (payload: string) => {
      const trimmed = payload.trim();
      if (!trimmed || trimmed === '[DONE]') {
        if (trimmed === '[DONE]') sawDone = true;
        return;
      }
      let json: unknown;
      try {
        json = JSON.parse(trimmed);
      } catch {
        return;
      }
      const applied = applyCompletionChunk(json, {
        onContent: (text) => onDelta(detokenizeArtifacts(text)),
        onReasoning: (text) => {
          const r = detokenizeArtifacts(text);
          if (onReasoningDelta) onReasoningDelta(r);
          else onDelta(r);
        },
        onToolCallDelta: (tc) => {
          const idx = tc.index ?? 0;
          const cur = toolAcc.get(idx) ?? { id: '', name: 'shell', arguments: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.name) cur.name = tc.name;
          if (tc.arguments) cur.arguments += tc.arguments;
          toolAcc.set(idx, cur);
        },
      });
      if (applied.finishReason) finishReason = applied.finishReason;
      if (applied.usageTokens > 0) usageTokens = applied.usageTokens;
      completionChars += applied.contentChars;
      reasoningChars += applied.reasoningChars;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        rawAll += chunk;
        buffer += chunk;
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const rawLine of parts) {
          const line = rawLine.replace(/\r$/, '');
          if (!line.startsWith('data:')) continue;
          sawSse = true;
          handleData(line.slice(5).trimStart());
          if (sawDone) break;
        }
        if (sawDone) break;
      }
      if (sawSse) {
        if (!sawDone && buffer.trim().startsWith('data:')) {
          handleData(buffer.trim().slice(5).trimStart());
        }
      } else {
        const text = rawAll.trim();
        if (text.startsWith('{')) handleData(text);
      }
      return {
        finishReason,
        toolCalls: materializeTools(toolAcc, onToolCallComplete),
        usageTokens,
        completionChars,
        reasoningChars,
      };
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  };

  let consumed = await consumeResponse(res);
  // Models without native tool-calling often return HTTP 200 with empty choices
  // when `tools` is set. One retry without tools recovers a text reply.
  const emptyReply =
    consumed.completionChars === 0 &&
    consumed.reasoningChars === 0 &&
    consumed.toolCalls.length === 0;
  if (emptyReply && Array.isArray(body.tools) && (body.tools as unknown[]).length) {
    delete body.tools;
    delete body.tool_choice;
    let retryEmpty: Response;
    try {
      retryEmpty = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abortSignal,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`Chat retry without tools failed (${active.provider}): ${detail}`);
    }
    if (retryEmpty.ok && retryEmpty.body) {
      consumed = await consumeResponse(retryEmpty);
    }
  }

  if (usingBuiltin) {
    let tokens = consumed.usageTokens;
    if (tokens <= 0) {
      const promptText = messages.map((m) => m.content || '').join('\n');
      tokens = estimateTokensFromText(promptText) + Math.max(0, Math.ceil(consumed.completionChars / 4));
    }
    recordBuiltinUsage(tokens);
  }
  return { finishReason: consumed.finishReason, toolCalls: consumed.toolCalls };
}
