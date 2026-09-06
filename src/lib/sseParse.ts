/** Pure completion-chunk helpers (SSE/JSON, Featherless/vLLM field aliases). */

export type ReasoningLevelLite = 'off' | 'low' | 'high' | 'max';

export type CompletionHandlers = {
  onContent: (text: string) => void;
  onReasoning: (text: string) => void;
  onToolCallDelta: (tc: {
    index: number;
    id?: string;
    name?: string;
    arguments?: string;
  }) => void;
};

export type ChunkApplyResult = {
  finishReason: string | null;
  usageTokens: number;
  contentChars: number;
  reasoningChars: number;
  hadToolDelta: boolean;
};

const THINKING_MODEL_RE =
  /qwen3|qwq[-_]?|deepseek-r1|deepseek-reasoner|hunyuan-t1|glm-4\.5|glm-5|magistral/i;

export function isThinkingFamilyModel(model: string): boolean {
  return THINKING_MODEL_RE.test(model || '');
}

/** Featherless/vLLM chat_template_kwargs for Qwen3-class thinking models. */
export function thinkingChatTemplateKwargs(
  model: string,
  reasoning: ReasoningLevelLite,
): { enable_thinking: boolean } | undefined {
  if (!isThinkingFamilyModel(model)) return undefined;
  return { enable_thinking: reasoning !== 'off' };
}

export function extractTextPart(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (!Array.isArray(value)) return '';
  let out = '';
  for (const part of value) {
    if (typeof part === 'string') {
      out += part;
      continue;
    }
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    if (typeof p.text === 'string') out += p.text;
    else if (typeof p.content === 'string') out += p.content;
    else if (typeof p.output_text === 'string') out += p.output_text;
    else if (typeof p.reasoning === 'string') out += p.reasoning;
    else if (typeof p.thinking === 'string') out += p.thinking;
    else if (typeof p.reasoning_content === 'string') out += p.reasoning_content;
  }
  return out;
}

function reasoningFromRecord(rec: Record<string, unknown>): string {
  return (
    extractTextPart(rec.reasoning_content) ||
    extractTextPart(rec.reasoning) ||
    extractTextPart(rec.thinking) ||
    ''
  );
}

function contentAndReasoningFromValue(value: unknown): { content: string; reasoning: string } {
  if (typeof value === 'string') return { content: value, reasoning: '' };
  if (!Array.isArray(value)) return { content: extractTextPart(value), reasoning: '' };
  let content = '';
  let reasoning = '';
  for (const part of value) {
    if (typeof part === 'string') {
      content += part;
      continue;
    }
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    const type = typeof p.type === 'string' ? p.type.toLowerCase() : '';
    const text =
      typeof p.text === 'string'
        ? p.text
        : typeof p.content === 'string'
          ? p.content
          : typeof p.output_text === 'string'
            ? p.output_text
            : typeof p.reasoning === 'string'
              ? p.reasoning
              : typeof p.thinking === 'string'
                ? p.thinking
                : typeof p.reasoning_content === 'string'
                  ? p.reasoning_content
                  : '';
    if (type === 'reasoning' || type === 'thinking' || type === 'reasoning_content') reasoning += text;
    else content += text;
  }
  return { content, reasoning };
}

type ToolDeltaIn = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
  name?: string;
  arguments?: string;
};

function payloadFrom(obj: unknown): {
  content: string;
  reasoning: string;
  toolCalls: ToolDeltaIn[];
} {
  if (!obj || typeof obj !== 'object') return { content: '', reasoning: '', toolCalls: [] };
  const rec = obj as Record<string, unknown>;
  const split = contentAndReasoningFromValue(rec.content);
  const reasoning = reasoningFromRecord(rec) || split.reasoning;
  const toolCalls = Array.isArray(rec.tool_calls) ? (rec.tool_calls as ToolDeltaIn[]) : [];
  return { content: split.content, reasoning, toolCalls };
}

function emitPayload(
  payload: { content: string; reasoning: string; toolCalls: ToolDeltaIn[] },
  h: CompletionHandlers,
): { contentChars: number; reasoningChars: number; hadToolDelta: boolean } {
  let contentChars = 0;
  let reasoningChars = 0;
  if (payload.content) {
    h.onContent(payload.content);
    contentChars += payload.content.length;
  }
  if (payload.reasoning) {
    h.onReasoning(payload.reasoning);
    reasoningChars += payload.reasoning.length;
  }
  let hadToolDelta = false;
  for (const tc of payload.toolCalls) {
    hadToolDelta = true;
    h.onToolCallDelta({
      index: typeof tc.index === 'number' ? tc.index : 0,
      id: tc.id,
      name: tc.function?.name || tc.name,
      arguments: tc.function?.arguments || tc.arguments,
    });
  }
  return { contentChars, reasoningChars, hadToolDelta };
}

function usageTokensFrom(json: Record<string, unknown>): number {
  const usage = json.usage;
  if (!usage || typeof usage !== 'object') return 0;
  const u = usage as { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
  return (
    Number(u.total_tokens) ||
    (Number(u.prompt_tokens) || 0) + (Number(u.completion_tokens) || 0)
  );
}

/**
 * Apply one OpenAI-compatible chat chunk (SSE `data:` JSON or a full non-stream body).
 * Prefers `delta` when it carries tokens/tools; otherwise falls back to `message`
 * so JSON completions and final chunks with only `message` are not dropped.
 */
export function applyCompletionChunk(json: unknown, h: CompletionHandlers): ChunkApplyResult {
  const empty: ChunkApplyResult = {
    finishReason: null,
    usageTokens: 0,
    contentChars: 0,
    reasoningChars: 0,
    hadToolDelta: false,
  };
  if (!json || typeof json !== 'object') return empty;
  const rec = json as Record<string, unknown>;
  const choices = rec.choices;
  const choice = Array.isArray(choices) ? choices[0] : undefined;
  if (!choice || typeof choice !== 'object') {
    return { ...empty, usageTokens: usageTokensFrom(rec) };
  }
  const ch = choice as {
    delta?: unknown;
    message?: unknown;
    finish_reason?: string | null;
  };
  const deltaPayload = payloadFrom(ch.delta);
  const deltaHas =
    !!deltaPayload.content || !!deltaPayload.reasoning || deltaPayload.toolCalls.length > 0;
  const applied = emitPayload(deltaHas ? deltaPayload : payloadFrom(ch.message), h);
  return {
    finishReason: typeof ch.finish_reason === 'string' && ch.finish_reason ? ch.finish_reason : null,
    usageTokens: usageTokensFrom(rec),
    contentChars: applied.contentChars,
    reasoningChars: applied.reasoningChars,
    hadToolDelta: applied.hadToolDelta,
  };
}
