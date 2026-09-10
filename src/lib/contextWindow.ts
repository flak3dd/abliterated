/** Conservative: code/JSON often tokenize denser than chars/4. */
const CHARS_PER_TOKEN = 3;
const MSG_OVERHEAD = 8;
const TEMPLATE_RESERVE = 1024;

export type WindowMessage = {
  role: string;
  content: string;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
};

export type FitChatPayloadResult<T extends WindowMessage = WindowMessage> = {
  messages: T[];
  tools: unknown[] | undefined;
  dropped: number;
  truncated: boolean;
  budget: number;
  estimatedTokens: number;
};

export function estimateTokens(text: string, charsPerToken = CHARS_PER_TOKEN): number {
  const n = (text || '').length;
  if (!n) return 0;
  return Math.ceil(n / Math.max(1.5, charsPerToken)) + 1;
}

export function estimateMessageTokens(m: WindowMessage, charsPerToken = CHARS_PER_TOKEN): number {
  let t = MSG_OVERHEAD + estimateTokens(m.content || '', charsPerToken);
  if (m.reasoning_content) t += estimateTokens(m.reasoning_content, charsPerToken);
  if (m.tool_calls?.length) t += estimateTokens(JSON.stringify(m.tool_calls), charsPerToken);
  if (m.tool_call_id) t += 4;
  return t;
}

export function estimateMessagesTokens(
  messages: WindowMessage[],
  charsPerToken = CHARS_PER_TOKEN,
): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m, charsPerToken), 0);
}

export function defaultContextWindow(provider: string, contextLength?: number): number {
  if (typeof contextLength === 'number' && Number.isFinite(contextLength) && contextLength >= 1024) {
    return Math.floor(contextLength);
  }
  if (provider === 'featherless') return 32768;
  return 131072;
}

export function promptTokenBudget(contextWindow: number, maxTokens: number): number {
  const window = Math.max(1024, Math.floor(contextWindow));
  const completion = Math.max(256, Math.floor(maxTokens) || 4096);
  return Math.max(1024, window - completion - TEMPLATE_RESERVE);
}

export function isInvalidRequestError(text: string): boolean {
  return /rejected as invalid|invalid request|unrecognized (?:field|parameter)|unknown (?:field|parameter)|extra fields|not a valid|unsupported (?:parameter|field)|schema/i.test(
    String(text || ''),
  );
}

export function parseContextLengthError(
  text: string,
): { limit: number; prompt: number } | null {
  const raw = String(text || '');
  const plan = raw.match(
    /allowed on your plan is\s+(\d+)\s+tokens[\s\S]*?prompt has\s+(\d+)\s+tokens/i,
  );
  if (plan) {
    return { limit: Number(plan[1]), prompt: Number(plan[2]) };
  }
  const generic = raw.match(
    /maximum context length[^\d]{0,40}(\d+)[\s\S]{0,120}?(\d+)\s+tokens/i,
  );
  if (generic) {
    return { limit: Number(generic[1]), prompt: Number(generic[2]) };
  }
  return null;
}

function clip(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 48))}\n/* truncated to fit context window */`;
}

function cloneMessage<T extends WindowMessage>(m: T): T {
  return { ...m };
}

/**
 * Drop orphan tool results, empty users, and extra reasoning fields some
 * OpenAI-compatible hosts (Featherless) 400 on.
 */
export function sanitizeOpenAiMessages<T extends WindowMessage>(
  messages: T[],
  opts?: { stripReasoning?: boolean },
): T[] {
  const knownCalls = new Set<string>();
  const out: T[] = [];
  for (const raw of messages) {
    const content = typeof raw.content === 'string' ? raw.content : String(raw.content ?? '');
    if (raw.role === 'tool') {
      const id = raw.tool_call_id || '';
      if (!id || !knownCalls.has(id)) continue;
      out.push({ ...raw, content });
      continue;
    }
    if (raw.role === 'assistant') {
      const next: T = { ...raw, content };
      if (opts?.stripReasoning) delete next.reasoning_content;
      if (next.tool_calls?.length) {
        for (const tc of next.tool_calls) {
          const id = tc && typeof tc === 'object' ? (tc as { id?: string }).id : undefined;
          if (id) knownCalls.add(id);
        }
      } else if (!content.trim()) {
        continue;
      }
      out.push(next);
      continue;
    }
    if (raw.role === 'user' && !content.trim()) continue;
    const next: T = { ...raw, content };
    if (opts?.stripReasoning) delete next.reasoning_content;
    out.push(next);
  }
  return out;
}

/**
 * Shrink messages (and tools if needed) so estimated prompt tokens fit in
 * contextWindow - max_tokens. Keeps system (head) + newest turns.
 */
export function fitChatPayload<T extends WindowMessage>(opts: {
  messages: T[];
  tools?: unknown[];
  contextWindow: number;
  maxTokens: number;
  charsPerToken?: number;
}): FitChatPayloadResult<T> {
  const cpt = opts.charsPerToken ?? CHARS_PER_TOKEN;
  const budget = promptTokenBudget(opts.contextWindow, opts.maxTokens);
  let tools = opts.tools;
  let toolsTokens = tools?.length ? estimateTokens(JSON.stringify(tools), cpt) : 0;
  let dropped = 0;
  let truncated = false;

  const msgs = opts.messages.map(cloneMessage);
  const maxSysChars = Math.min(24_000, Math.floor((budget * 0.35) * cpt));
  const maxMsgChars = Math.min(8_000, Math.floor((budget * 0.25) * cpt));

  for (let i = 0; i < msgs.length; i++) {
    const cap = msgs[i].role === 'system' && i === 0 ? maxSysChars : maxMsgChars;
    if ((msgs[i].content || '').length > cap) {
      msgs[i].content = clip(msgs[i].content || '', cap);
      truncated = true;
    }
    if ((msgs[i].reasoning_content || '').length > Math.min(4_000, cap)) {
      msgs[i].reasoning_content = clip(msgs[i].reasoning_content || '', Math.min(4_000, cap));
      truncated = true;
    }
  }

  dropped = 0;
  const msgBudget = () => Math.max(512, budget - toolsTokens);

  const pack = (list: T[]): T[] => {
    if (!list.length) return list;
    const sys = list[0]?.role === 'system' ? list[0] : null;
    const rest = sys ? list.slice(1) : list.slice();
    const pinIdx = rest.findIndex((m) => m.role === 'user');
    const pin = pinIdx >= 0 ? rest[pinIdx] : null;
    const movable = pinIdx >= 0 ? rest.filter((_, i) => i !== pinIdx) : rest.slice();
    const head = () => [...(sys ? [sys] : []), ...(pin ? [pin] : []), ...movable];
    while (movable.length > 1 && estimateMessagesTokens(head(), cpt) > msgBudget()) {
      movable.shift();
      dropped += 1;
      while (movable.length > 1 && movable[0]?.role === 'tool') {
        movable.shift();
        dropped += 1;
      }
    }
    let packed = head();
    if (!packed.length) return packed;

    let guard = 0;
    while (estimateMessagesTokens(packed, cpt) > msgBudget() && guard++ < 8) {
      const last = packed[packed.length - 1];
      const nextLen = Math.max(256, Math.floor((last.content || '').length * 0.5));
      if ((last.content || '').length > 256) {
        last.content = clip(last.content || '', nextLen);
        truncated = true;
      } else if (packed.length > 1) {
        packed = packed.slice(0, -1);
        dropped += 1;
      } else {
        break;
      }
    }
    if (dropped > 0 && packed[0]?.role === 'system') {
      const note = `[Context window] Omitted ${dropped} earlier message(s) to fit a ${opts.contextWindow}-token model.`;
      packed[0] = { ...packed[0], content: `${packed[0].content}\n\n${note}` };
    }
    return packed;
  };

  let packed = pack(msgs);
  if (tools?.length && estimateMessagesTokens(packed, cpt) + toolsTokens > budget) {
    tools = undefined;
    toolsTokens = 0;
    dropped = 0;
    packed = pack(msgs);
    truncated = true;
  }

  return {
    messages: packed,
    tools,
    dropped,
    truncated,
    budget,
    estimatedTokens: estimateMessagesTokens(packed, cpt) + toolsTokens,
  };
}
