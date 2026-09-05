import type { ToolType } from '../types';
import { PLAN_MODE_TOOLS } from '../types';

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

export function buildSelfDeepenNudge(): string {
  return (
    '↻ Self-review: Re-read your last answer. Expand thin/missing parts with concrete detail ' +
    '(and tools if needed). If the answer already fully solves the user request, reply with ONLY ' +
    'the token [ANSWER_COMPLETE].'
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
  return (
    '## Large job protocol (required for this request)\n' +
    '1. First message content: a **ToDo** list as plain bullet points (- item) covering the work (3–12 items). No prose wall before the list.\n' +
    '2. Then explore the codebase with tools (grep / glob / semantic_search / list_dir / read_file / file_outline) before writing patches — revise the ToDo if discovery changes the plan.\n' +
    '3. Implement step by step: mark progress in content (- [x] / - [ ] or status lines), keep exploring when unsure, do not invent file contents.\n' +
    '4. Do not stop after only the ToDo — explore and start implementation in the same run.'
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
    '## Plan mode (ACTIVE — read-only)\n' +
    'Tools unlocked now: read_file, grep, glob, list_dir, file_outline, semantic_search, git_status, git_diff, web_fetch. ' +
    'Do not call shell/write/git_commit/create_pr/checkpoint_restore/generate_image or apply diffs.\n' +
    '1. Explore with those tools as needed (list_dir/glob/semantic_search/file_outline/git_diff/web_fetch — never fake ls/tree in markdown bash fences).\n' +
    '2. Emit a **Plan** checklist as numbered steps (1. … 2. …) or bullets (- …) — concrete, implementable.\n' +
    '3. Stop after the checklist. Do not implement edits until the operator approves Plan mode exit.\n' +
    'Skip the Completion footer while Plan mode is active.'
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
