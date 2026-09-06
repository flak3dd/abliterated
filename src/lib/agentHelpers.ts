export { looksLikeVerifyEvidence, buildVerifyBeforeDoneNudge, buildIncompleteCapNote } from './verifyDone';
import type { ToolType } from '../types';
import { PLAN_MODE_TOOLS } from '../types';
import { withCompletenessChecklist } from './deepenComplete';

/** Pure helpers for agent loop settings, telemetry, pins, and prefetch tokens. */

export const DEFAULT_MAX_AGENT_TURNS = 24;
export const MAX_AGENT_TURNS_HARD_CAP = 50;
export const AGENT_RUNS_KEEP = 50;

export type AgentStopReason = 'no_tools' | 'cap' | 'abort' | 'error' | 'pending_gate' | 'deepened';

export type AgentRunRecord = {
  threadId: string;
  startedAt: number;
  endedAt: number;
  turns: number;
  stopReason: AgentStopReason;
  tools: string[];
  ms: number;
};

export function clampMaxAgentTurns(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_MAX_AGENT_TURNS;
  return Math.min(MAX_AGENT_TURNS_HARD_CAP, Math.max(1, Math.floor(v)));
}

export const DEFAULT_MAX_CONCURRENT_JOBS = 1;
export const MAX_CONCURRENT_JOBS_HARD_CAP = 4;

export function clampMaxConcurrentJobs(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_MAX_CONCURRENT_JOBS;
  return Math.min(MAX_CONCURRENT_JOBS_HARD_CAP, Math.max(1, Math.floor(v)));
}


export const DEFAULT_SELF_DEEPEN_PASSES = 2;
export const MAX_SELF_DEEPEN_PASSES = 5;
export const SELF_DEEPEN_DONE = '[ANSWER_COMPLETE]';

export function clampSelfDeepenPasses(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_SELF_DEEPEN_PASSES;
  return Math.min(MAX_SELF_DEEPEN_PASSES, Math.max(0, Math.floor(v)));
}

export function isAnswerCompleteMarker(content: string): boolean {
  return /^\s*\[ANSWER_COMPLETE\]\s*$/.test(content);
}

export function stripAnswerCompleteMarker(content: string): string {
  return content.replace(/\s*\[ANSWER_COMPLETE\]\s*/g, '').trim();
}

export function buildSelfDeepenNudge(opts?: { completeness?: boolean }): string {
  const base =
    '↻ Self-review: Re-read your last answer. Expand thin/missing parts with concrete detail ' +
    '(and tools if needed). If the answer already fully solves the user request, reply with ONLY ' +
    'the token [ANSWER_COMPLETE].';
  // Completeness checklist is opt-in via deepenCompleteness (Chat/Settings/Jobs).
  if (opts?.completeness) return withCompletenessChecklist(base);
  return base;
}

/** True when the assistant left the user-visible content channel empty (whitespace counts as empty). */
export function isMissingContentAnswer(content: string, _reasoning?: string): boolean {
  return !(content || '').trim();
}

export const EMPTY_CONTENT_REPLY_NOTE =
  '(No content or reasoning tokens — model returned an empty reply. Please try again.)';

/**
 * @deprecated Prefer zero-cost coalesceEmptyContentFromReasoning (agentPhase) over an API nudge retry.
 * Nudge when the model finished with empty content (often reasoning-only).
 * Forces a re-answer in the content channel.
 */
export function buildContentChannelNudge(hasReasoning: boolean): string {
  if (hasReasoning) {
    return (
      '↻ Content channel empty: You put the reply only in reasoning / left content empty. ' +
      'Re-answer now with the COMPLETE user-facing answer in the content channel only. ' +
      'Do not use tools unless required. Do not reply with only [ANSWER_COMPLETE].'
    );
  }
  return (
    '↻ Content channel empty: Reply with the answer in the content channel now. ' +
    'Do not use tools unless required. Do not reply with only [ANSWER_COMPLETE].'
  );
}

/** Light heuristic: non-trivial / multi-step user asks (prompt still owns the behavior). */
export function looksMultiStep(userText: string): boolean {
  const t = (userText || '').trim();
  if (t.length < 40) return false;
  const lower = t.toLowerCase();
  if (/\b(step[- ]?by[- ]?step|multi[- ]?step|implement|refactor|migrate|rewrite|build|create|add|fix|and then|then|first|next|finally)\b/.test(lower)) {
    return true;
  }
  if ((t.match(/\n/g) || []).length >= 2) return true;
  if (/,.*,.*,/.test(t)) return true; // several comma-separated asks
  return t.length >= 160;
}

/** Larger than multi-step: feature/refactor/job-sized work that needs explore-then-implement. */
export function looksLargeJob(userText: string): boolean {
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

/** Extract bullet / numbered ToDo lines from agent content (first matching block). */
export function parseTodoBullets(text: string): string[] {
  const raw = text || '';
  const lines = raw.split(/\n/);
  const items: string[] = [];
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
      // blank after bullets ends the block once we have some
      if (items.length >= 2) break;
      continue;
    }
    if (inBlock && items.length >= 2 && !m) break;
  }
  // de-dupe, cap
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const key = it.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= 16) break;
  }
  return out.length >= 2 ? out : [];
}

export function buildLargeJobNudge(): string {
  return BUILD_PROCESS_SECTION;
}

export type TodoItem = { text: string; done: boolean };

export function parseTodoItems(text: string): TodoItem[] {
  return parseTodoBullets(text)
    .map((raw) => {
      const m = raw.match(/^\[([xX ])\]\s*(.*)$/);
      if (m) return { text: (m[2] || '').trim() || raw, done: m[1].toLowerCase() === 'x' };
      return { text: raw, done: false };
    })
    .filter((t) => t.text.length >= 3);
}

export function formatTodoBlock(items: TodoItem[]): string {
  return `ToDo:\n${items.map((t) => `- [${t.done ? 'x' : ' '}] ${t.text}`).join('\n')}`;
}

/** Models (Grok CLI process, Cursor, etc.) call ToDo / todo_write — canonicalize to `todo`. */
const TODO_TOOL_ALIASES = new Set([
  'todo',
  'todos',
  'todo_write',
  'todowrite',
  'todo_update',
  'update_todo',
  'create_todo',
]);

const WEB_SEARCH_ALIASES = new Set(['web_search', 'websearch', 'web_search_tool', 'search_web']);

export function canonicalizeToolName(name: string): string {
  const raw = (name || '').trim();
  if (!raw) return raw;
  const lower = raw.toLowerCase();
  if (TODO_TOOL_ALIASES.has(lower)) return 'todo';
  if (WEB_SEARCH_ALIASES.has(lower)) return 'web_search';
  if (lower === 'writefile' || lower === 'write-file' || lower === 'create_file') return 'write_file';
  if (lower === 'taskread' || lower === 'read_task') return 'task_read';
  if (lower === 'taskupdate' || lower === 'update_task') return 'task_update';
  if (lower === 'run_verify') return 'verify';
  return raw;
}

function todoItemFromUnknown(v: unknown): TodoItem | null {
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.length < 3) return null;
    const m = t.match(/^\[([xX ])\]\s*(.*)$/);
    if (m) return { text: (m[2] || '').trim() || t, done: m[1].toLowerCase() === 'x' };
    return { text: t, done: false };
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const text = [o.text, o.content, o.item, o.task, o.title]
    .find((x): x is string => typeof x === 'string' && x.trim().length >= 3);
  if (!text) return null;
  const status = typeof o.status === 'string' ? o.status.toLowerCase() : '';
  const done =
    o.done === true ||
    o.completed === true ||
    status === 'completed' ||
    status === 'done' ||
    status === 'complete' ||
    status === 'x';
  return { text: text.trim(), done };
}

/** Merge or replace the in-session checklist from a `todo` tool call. */
export function applyTodoToolArgs(prev: TodoItem[], args: Record<string, unknown>): TodoItem[] {
  const merge = args.merge === true || args.merge === 'true';
  const raw = args.items ?? args.todos ?? args.tasks ?? args.list ?? args.todo;
  let incoming: TodoItem[] = [];
  if (Array.isArray(raw)) {
    incoming = raw.map(todoItemFromUnknown).filter((x): x is TodoItem => x != null);
  } else if (typeof raw === 'string') {
    incoming = parseTodoItems(raw);
  } else {
    const one = todoItemFromUnknown(args.text ?? args.content ?? args.item ?? args);
    if (one) incoming = [one];
  }
  if (!incoming.length) return prev;
  if (!merge && incoming.length) return incoming.slice(0, 16);
  const map = new Map<string, TodoItem>();
  for (const it of prev) map.set(it.text.toLowerCase(), it);
  for (const it of incoming) map.set(it.text.toLowerCase(), it);
  return [...map.values()].slice(0, 16);
}

export function liftTodoListToContent(content: string, reasoning: string): string {
  if (parseTodoItems(content).length) return content;
  const fromR = parseTodoItems(reasoning);
  if (!fromR.length) return content;
  const block = formatTodoBlock(fromR);
  const body = (content || '').trim();
  return body ? `${block}\n\n${body}` : block;
}

/** True when content contains applyable build artifacts (diffs, path fences, code fences). */
export function looksLikeBuildOutput(text: string): boolean {
  const t = text || '';
  if (/```(?:diff|patch|bash|ts|tsx|js|jsx|mjs|cjs|py|go|rs|json|css|html|vue|svelte)/i.test(t)) return true;
  if (/^diff --git |^--- (a\/|\/dev\/null)|\+\+\+ b\//m.test(t)) return true;
  if (/^\/\/ [\w./+-]+\s*$/m.test(t) && t.length > 50) return true;
  return false;
}

export function looksBuildIntent(userText: string): boolean {
  const t = (userText || '').trim().toLowerCase();
  if (!t) return false;
  if (/\bfile structure\b|\bfolder structure\b|\bproject skeleton\b|\bscaffold\b/.test(t)) return true;
  if (/\b(build|implement|bootstrap|wire up|set up|setup)\b/.test(t) && t.length >= 24) return true;
  return /\b(create|add|new)\b.{0,48}\b(file|folder|dir(?:ectory)?|module|app|feature|project|structure|layout|tree|skeleton)\b/.test(
    t,
  );
}

export function needsBuildProtocol(userText: string): boolean {
  const t = (userText || '').trim();
  if (!t) return false;
  return looksBuildIntent(t) || looksLargeJob(t) || looksMultiStep(t);
}

/** Short reminder; full Work rules live in SYSTEM_PROMPT. */
export const BUILD_PROCESS_SECTION =
  '## Build mode — LOCKED (implementation run)\n' +
  'This turn MUST follow this order in CONTENT (reasoning never executes):\n' +
  '1. If Thought is on: Goal / Inspect / step # — why — success in the reasoning channel. No code there.\n' +
  '2. Call `todo` with 3–12 items (scaffold first if new files/folders).\n' +
  '3. Explore with list_dir/glob/grep/semantic_search/read_file — do not invent listings.\n' +
  '4. Emit real ```diff or // relative/path fences in CONTENT and `todo` merge=true to tick items.\n' +
  '5. After a meaningful change, one scoped verify ```bash fence.\n' +
  'A ToDo or essay with no diffs is a FAILED build. Do not stop at the list. Do not spawn other coding CLIs.';

export function buildThoughtModeNudge(): string {
  return (
    '## Thought mode — LOCKED\n' +
    'Fill the reasoning channel FIRST this turn, before tools and before content, exactly:\n' +
    'Goal: <one line>\n' +
    'Inspect: <tools/paths you will call — never invent their results>\n' +
    '1. <step> — why: <...> — success: <...>\n' +
    'After every tool result: one line on what changed.\n' +
    'CODE IN THOUGHT IS DISCARDED. Never write source, diffs, bash fences, JSON blobs, or // path files in reasoning. All code goes to files via CONTENT (```diff or // relative/path) only.\n' +
    'Then put the user-facing answer in content (Plan: checklist only; Build: diffs in content). Reasoning-only is incomplete unless Plan mode forbids implementation.'
  );
}

export function buildBuildModeAlwaysNudge(): string {
  return (
    '## Build mode — ON\n' +
    'Prefer shipping the change over advice. If this request touches files, run the Build lock: todo → explore tools → real diffs in content this turn. Skip the full ToDo only for a trivial one-shot (typo, single read).'
  );
}

/** True for an actual build request (not every multi-step chat). Plan mode never builds. */
export function shouldApplyBuildProcess(
  userText: string,
  opts: { buildMode?: boolean; planMode?: boolean } = {},
): boolean {
  if (opts.planMode) return false;
  const t = (userText || '').trim();
  if (!t) return false;
  if (looksBuildIntent(t) || looksLargeJob(t)) return true;
  if (!opts.buildMode) return false;
  if (looksMultiStep(t)) return true;
  return t.length >= 40;
}

export function buildReasoningThenBuildNudge(): string {
  return BUILD_PROCESS_SECTION;
}

export function buildBuildModeNudge(): string {
  return buildReasoningThenBuildNudge();
}

export function buildBuildModeTodoNudge(): string {
  return (
    'Build process: call `todo` with 3–12 items, then scaffold (if needed) and implement with ```diff or // path fences. Do not only reason or only list tasks.'
  );
}

export function buildBuildModeImplementNudge(): string {
  return (
    'Build process: you wrote a ToDo list but did not emit any file diffs or path-headed fences. ' +
    'That is not a build. Now: (1) if new structure is required, create the skeleton first; ' +
    '(2) implement the next unchecked ToDo with a real ```diff or // relative/path file in content; ' +
    '(3) call `todo` with merge=true to tick finished items. Do not reply with another list only.'
  );
}

export function appendAgentRun(list: AgentRunRecord[], run: AgentRunRecord, keep = AGENT_RUNS_KEEP): AgentRunRecord[] {
  const next = [...list, run];
  if (next.length <= keep) return next;
  return next.slice(next.length - keep);
}

export function lastStopReasonForThread(runs: AgentRunRecord[], threadId: string): AgentStopReason | null {
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i].threadId === threadId) return runs[i].stopReason;
  }
  return null;
}

/** Parse @path tokens (files or dirs relative to workspace). */
export function extractAtPins(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /(?:^|[\s])@([A-Za-z0-9_./+-][A-Za-z0-9_./+-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let raw = (m[1] || '').replace(/[.,;:!?)]+$/, '');
    if (!raw || raw === '.' || raw === '..') continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'your', 'have', 'has',
  'are', 'was', 'were', 'will', 'would', 'could', 'should', 'about', 'into', 'over',
  'under', 'then', 'than', 'when', 'what', 'where', 'which', 'who', 'how', 'why',
  'please', 'just', 'like', 'want', 'need', 'make', 'file', 'files', 'code', 'read',
  'write', 'edit', 'fix', 'add', 'use', 'using', 'via', 'also', 'not', 'any', 'all',
  'can', 'you', 'me', 'my', 'our', 'their', 'them', 'they', 'its', 'it', 'a', 'an',
  'to', 'of', 'in', 'on', 'at', 'by', 'or', 'as', 'is', 'be', 'do', 'does', 'did',
]);

/** Distinctive tokens from user text for smart prefetch (len>3, not stopwords). */
export function extractSearchTokens(text: string, max = 4): string[] {
  const cleaned = text
    .replace(/@[A-Za-z0-9_./+-]+/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ');
  const words = cleaned.match(/[A-Za-z][A-Za-z0-9_-]{3,}/g) || [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const lower = w.toLowerCase();
    if (STOPWORDS.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

export function formatIdleSubtitle(stopReason: AgentStopReason | null | undefined, base = 'idle'): string {
  if (!stopReason) return base;
  if (stopReason === 'cap') return `${base} · incomplete (turn cap)`;
  return `${base} · stopped: ${stopReason}`;
}

/** Whether a tool message is still a gate blocker (allowed/pending, not done). */
export function isGatedToolStatus(status: string | undefined): boolean {
  return status === 'allowed' || status === 'pending';
}

/**
 * True when messageId is a tool result belonging to the latest assistant toolCalls
 * turn, and every tool from that turn is now executed or error (ready to resume).
 */
export function canResumeAfterTool(
  messages: Array<{
    id: string;
    role: string;
    toolCallId?: string;
    toolCall?: { id: string; status: string };
    toolCalls?: Array<{ id: string }>;
  }>,
  messageId: string,
): boolean {
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

/** Prefix on user messages persisted while the agent is busy (mid-run barge-in). */
export const MID_RUN_PREFIX = '⟦mid-run⟧ ';

export function isMidRunMessageContent(content: string): boolean {
  return (content || '').startsWith(MID_RUN_PREFIX);
}

export function stripMidRunPrefix(content: string): string {
  return isMidRunMessageContent(content) ? content.slice(MID_RUN_PREFIX.length) : content;
}

/** Synthetic user nudge injected at a turn boundary after draining the mid-run queue. */
export function buildMidRunIntegrateNudge(texts: string[]): string {
  const cleaned = texts
    .map((t) => stripMidRunPrefix((t || '').trim()))
    .filter(Boolean);
  const listed = cleaned.map((t, i) => `(${i + 1}) ${t}`).join('\n');
  return (
    'Mid-run update(s) from the operator arrived. Finish integrating them into the CURRENT task: ' +
    '(1) briefly reason how each changes the plan/answer, (2) revise the numbered plan if needed, ' +
    '(3) continue from the next unfinished step with tools/diffs. Do not restart from scratch unless the update invalidates prior work.' +
    (listed ? `\n\n${listed}` : '')
  );
}

export function filterPlanModeTools(enabled: readonly ToolType[]): ToolType[] {
  const allow = new Set<ToolType>(PLAN_MODE_TOOLS);
  return enabled.filter((t) => allow.has(t));
}

export function buildPlanModeNudge(): string {
  return (
    '## Plan mode — LOCKED (read-only). Overrides Build. Writes are blocked.\n' +
    'FORBIDDEN in content AND reasoning: unified diffs, ```diff, ```bash, // path files, write/shell/git_commit/create_pr/write_skill, applying patches.\n' +
    'ALLOWED tools: read_file, grep, glob, list_dir, file_outline, semantic_search, git_status, git_diff, web_fetch, web_search, todo, list_skills, read_skill, suggest_skill.\n' +
    'REQUIRED every reply:\n' +
    '1. Reasoning (if Thought is on): Goal / Inspect / numbered steps (why + success). No code.\n' +
    '2. Content MUST start with a checklist (call `todo` or markdown):\n' +
    'Plan:\n- [ ] …\n- [ ] …\n' +
    'Then 2–8 short rationale bullets. STOP. No implementation. No completion footer until the operator Approves the plan.'
  );
}

/** Explore / analyse-directory intent — used for prefetch + tool_choice. */
export function looksExploreIntent(userText: string): boolean {
  const t = (userText || '').trim().toLowerCase();
  if (!t) return false;
  return /\b(analys[ee]|analyze)\s+(dir|directory|folder)\b|\blist\s+files\b|what'?s\s+in\s+the\s+workspace|\bshow\s+(me\s+)?(the\s+)?tree\b/i.test(
    t,
  );
}

/** True when a bash/tool line looks like an accidental review-history git_commit. */
export function isSpuriousReviewCommit(commandOrText: string): boolean {
  if (!commandOrText) return false;
  return /git_commit\b/i.test(commandOrText) && /\b(review|recent|analy[sz]|inspect|history|log|view|diff|check)\b/i.test(commandOrText);
}
