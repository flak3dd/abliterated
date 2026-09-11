export { looksLikeVerifyEvidence, buildVerifyBeforeDoneNudge, buildIncompleteCapNote } from './verifyDone';
export { auditTurnChanges, buildVerifySummaryNudge } from './changeAudit';
import { ALL_TOOL_TYPES, PLAN_MODE_TOOLS, ASK_MODE_TOOLS, DEBUG_MODE_TOOLS, type ToolType, type AgentMode } from '../types';
import { withCompletenessChecklist } from './deepenComplete';
import { looksLikeStubAnswer, looksLikeTokenCollapse } from './tokenCollapse';

/** Pure helpers for agent loop settings, telemetry, pins, and prefetch tokens. */

export const DEFAULT_MAX_AGENT_TURNS = 24;
export const MIN_AGENT_TURNS = 4;
export const MAX_AGENT_TURNS_HARD_CAP = 50;
export const AGENT_RUNS_KEEP = 50;

export const CORE_AGENT_TOOLS: readonly ToolType[] = [
  'read_file',
  'write_file',
  'shell',
  'grep',
  'glob',
  'list_dir',
  'todo',
];

export function sanitizeEnabledTools(tools: ToolType[] | undefined): ToolType[] {
  if (!tools || tools.length === 0) return [...ALL_TOOL_TYPES];
  const set = new Set(tools);
  for (const core of CORE_AGENT_TOOLS) {
    set.add(core);
  }
  return Array.from(set);
}

export type AgentStopReason = 'no_tools' | 'cap' | 'abort' | 'error' | 'pending_gate' | 'deepened' | 'loop_detected';

export type AgentRunRecord = {
  threadId: string;
  startedAt: number;
  endedAt: number;
  turns: number;
  stopReason: AgentStopReason;
  tools: string[];
  ms: number;
  /** Times the model emitted tool theater and we recovered or stopped. */
  theaterRetries?: number;
  /** Count of fake tool_calls parsed out of markdown/JSON this run. */
  fakeToolParsed?: number;
  deepenPasses?: number;
  verifyEvidence?: boolean;
  provenImprovement?: boolean;
  inspectBeforeWrite?: boolean;
};

export function clampMaxAgentTurns(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return DEFAULT_MAX_AGENT_TURNS;
  return Math.min(MAX_AGENT_TURNS_HARD_CAP, Math.max(MIN_AGENT_TURNS, Math.floor(v)));
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
  // Anywhere in the reply counts — models often mix prose + the stop token.
  return /\[ANSWER_COMPLETE\]/.test(content || '');
}

export function stripAnswerCompleteMarker(content: string): string {
  return content.replace(/\s*\[ANSWER_COMPLETE\]\s*/g, '').trim();
}

export type SelfDeepenNudgeOpts = {
  completeness?: boolean;
  /** Build/scaffold turn produced fragments — land complete files, do not essay. */
  landFiles?: boolean;
  toolsOff?: boolean;
  workspaceRoot?: string;
};

export function buildLandCompleteFilesNudge(opts: SelfDeepenNudgeOpts = {}): string {
  const dest = (opts.workspaceRoot || '').trim();
  const where = dest
    ? `the connected bridge filepath ${dest}`
    : 'the connected bridge workspace (ws://127.0.0.1:17322)';
  const how = opts.toolsOff
    ? 'Do NOT call `todo` or write_file. Put FULL working files in CONTENT as ```diff or // relative/path fences (first line // path).'
    : 'Call write_file, or put FULL working files in CONTENT as ```diff or // relative/path fences.';
  return (
    '↻ Self-review: previous turn was a fragment (ToDo, sketch, or stub) and did not land complete files. ' +
    `${how} The client writes them to ${where} this turn. ` +
    'Every file the product needs, full-length, no placeholders. Do not list gaps. Do not emit another ToDo-only reply. ' +
    '[ANSWER_COMPLETE] only after those files are in content as applyable fences (or write_file already ran).'
  );
}

export function buildSelfDeepenNudge(opts?: SelfDeepenNudgeOpts): string {
  if (opts?.landFiles) {
    const land = buildLandCompleteFilesNudge(opts);
    return opts.completeness ? withCompletenessChecklist(land) : land;
  }
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
  const t = (content || '').trim();
  if (!t) return true;
  if (looksLikeStubAnswer(t)) return true;
  return looksLikeTokenCollapse(t);
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
  if (lower === 'codebase_search' || lower === 'search_code' || lower === 'find_in_files') return 'semantic_search';
  if (lower === 'run_terminal_cmd' || lower === 'terminal' || lower === 'run_command' || lower === 'exec' || lower === 'execute_command') return 'shell';
  if (lower === 'edit_file' || lower === 'modify_file' || lower === 'patch_file') return 'write_file';
  if (lower === 'run_verify') return 'verify';
  if (
    lower === 'mempalace_search' ||
    lower === 'memorysearch' ||
    lower === 'recall' ||
    lower === 'palace_search'
  ) {
    return 'memory_search';
  }
  if (
    lower === 'mempalace_add_drawer' ||
    lower === 'mempalace_save' ||
    lower === 'memorysave' ||
    lower === 'add_drawer'
  ) {
    return 'memory_save';
  }
  if (lower === 'mempalace_status' || lower === 'memorystatus' || lower === 'palace_status') {
    return 'memory_status';
  }
  if (
    lower === 'mempalace_wake' ||
    lower === 'mempalace_wake_up' ||
    lower === 'mempalace_wakeup' ||
    lower === 'memorywake' ||
    lower === 'wake_up'
  ) {
    return 'memory_wake';
  }
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

const PLACEHOLDER_CODE_RE =
  /not implemented|implement (?:this|me|here|later)|coming soon|placeholder script|FIXME:\s*implement|TODO:\s*implement|throw new Error\(\s*['"]not implemented/i;

/** True when emitted "code" is a stub / placeholder rather than a working product. */
export function looksLikePlaceholderOutput(text: string): boolean {
  const t = text || '';
  if (!PLACEHOLDER_CODE_RE.test(t)) return false;
  return /```|^\/\/ [\w./+-]+\s*$|^diff --git /m.test(t);
}

/** Fake todo JSON / verify bash with no real files — not a build. */
export function looksLikeToolTheaterOutput(text: string): boolean {
  const t = text || '';
  const hasRealFile =
    /```(?:diff|patch|ts|tsx|js|jsx|mjs|cjs|py|go|rs)\b/i.test(t) ||
    /^diff --git |^--- (a\/|\/dev\/null)|\+\+\+ b\//m.test(t) ||
    (/^\/\/ [\w./+-]+\s*$/m.test(t) && t.length > 50);
  if (hasRealFile) return false;
  if (/"name"\s*:\s*"(todo|write_file|verify|shell)"/i.test(t)) return true;
  if (/```(?:json)\b[\s\S]{0,400}"items"\s*:/i.test(t)) return true;
  if (/```bash[\s\S]{0,200}\bverify\s+"/i.test(t)) return true;
  return false;
}

/** Tool names that count as successful build file writes. */
export const BUILD_FILE_WRITE_TOOLS = [
  'write_file',
  'apply_patch',
  'search_replace',
  'edit_file',
  'str_replace',
] as const;

export function hasBuildFileWrites(toolsUsed?: string[]): boolean {
  if (!toolsUsed || !toolsUsed.length) return false;
  const set = new Set(BUILD_FILE_WRITE_TOOLS.map((t) => t.toLowerCase()));
  return toolsUsed.some((t) => set.has(String(t || '').toLowerCase()));
}

/** True when content contains applyable build artifacts, or a write/edit tool already ran. */
export function looksLikeBuildOutput(text: string, toolsUsed?: string[]): boolean {
  if (hasBuildFileWrites(toolsUsed)) return true;
  const t = text || '';
  if (looksLikePlaceholderOutput(t)) return false;
  if (looksLikeToolTheaterOutput(t)) return false;
  if (/```(?:diff|patch|ts|tsx|js|jsx|mjs|cjs|py|go|rs|css|html|vue|svelte)\b/i.test(t)) return true;
  if (/^diff --git |^--- (a\/|\/dev\/null)|\+\+\+ b\//m.test(t)) return true;
  if (/^\/\/ [\w.\/+-]+\s*$/m.test(t) && t.length > 50) return true;
  return false;
}

/** User asked for copy/a prompt, not a codebase build. */
export function looksPromptOnlyRequest(userText: string): boolean {
  const t = (userText || '').trim().toLowerCase();
  if (!t) return false;
  if (/\b(implement|scaffold|codebase|pull request|typecheck)\b/.test(t)) return false;
  if (/\b(write|draft|craft|give|produce|create|make)\b.{0,80}\bprompt\b/.test(t)) return true;
  if (/\bprompt\b.{0,60}\b(that will|that can|to |for )\b/.test(t)) return true;
  return false;
}

/** Short single-area edit/fix — not a full scaffold/build. */
export function looksTrivialFileEdit(userText: string): boolean {
  const t = (userText || '').trim();
  if (!t || t.length >= 120) return false;
  const lower = t.toLowerCase();
  if (/\b(scaffold|bootstrap|multi[- ]?file|whole\s+app|entire\s+(app|project)|project\s+skeleton|file\s+structure|folder\s+structure)\b/.test(lower)) {
    return false;
  }
  if (/\b(build\s+(a|an|the|me)\s+(app|project|website|site|system)|create\s+(a|an|the)\s+(app|project))\b/.test(lower)) {
    return false;
  }
  return /\b(edit|fix|wire|change|update|patch|typo|rename)\b/.test(lower);
}

export function looksBuildIntent(userText: string): boolean {
  const t = (userText || '').trim().toLowerCase();
  if (!t) return false;
  if (looksPromptOnlyRequest(t)) return false;
  if (/\bfile structure\b|\bfolder structure\b|\bproject skeleton\b|\bscaffold\b/.test(t)) return true;
  // Explicit "build" as the leading imperative enters the build scope at any length
  // (bare "build", "build the app", "please build a crawler"). Prompt-only guarded above.
  if (/^\s*(?:please\s+|now\s+|can\s+you\s+|could\s+you\s+|pls\s+)?build\b/.test(t)) return true;
  // Clear build/implement asks (incl. short "build a web crawler") — not length-gated at 40.
  if (/\b(build|implement|bootstrap|wire\s+up|set\s+up|setup)\b/.test(t) && t.length >= 12) return true;
  return /\b(create|add|new)\b.{0,48}\b(file|folder|dir(?:ectory)?|module|app|feature|project|structure|layout|tree|skeleton)\b/.test(
    t,
  );
}

export function needsBuildProtocol(userText: string): boolean {
  const t = (userText || '').trim();
  if (!t) return false;
  return looksBuildIntent(t) || looksLargeJob(t) || looksMultiStep(t);
}

export type BuildNudgeOpts = { toolsOff?: boolean };

/** Short reminder; full Work rules live in SYSTEM_PROMPT. */
export const BUILD_PROCESS_SECTION =
  '## Build scope — LOCKED (staged implementation run)\n' +
  'A "build" request runs three ORDERED phases in this scope. Do not ship until all three are done. Reasoning is outline only (Goal / Inspect / step — why — success); CONTENT executes, reasoning never does.\n' +
  'PHASE 1 — SCAFFOLD (complete up front): map the full file/folder tree, then create EVERY file and directory the product needs as the initial skeleton — real paths via write_file or `// relative/path` fences. Land the whole structure before filling any file. Explore with list_dir/glob/grep/semantic_search/read_file first — do not invent listings. Call `todo` with 3–12 items covering scaffold + each file.\n' +
  'PHASE 2 — BUILD OUT (comprehensive): implement every scaffolded file with full working code via real ```diff or `// relative/path` fences in CONTENT (or write_file). Fill each file completely; `todo` merge=true to tick items as files finish. Never leave a scaffolded file empty or stubbed.\n' +
  'PHASE 3 — VERIFY (proven results): after the buildout, run one scoped verify — the `verify` tool or a ```bash fence with tsc/lint/tests — confirm it passes, then report the verified result.\n' +
  'A ToDo or essay with no scaffolded files + diffs is a FAILED build. Do not stop at the list. Do not spawn other coding CLIs.\n' +
  'HARD LOCK: never write placeholder/stub/"implement here" scripts. Full-length working code only. Write every file into the connected working directory. Do not stop until the structure is complete, every file is built out, and verification has run.';

/** Same lock when native function tools are not on the wire. */
export const BUILD_PROCESS_SECTION_NO_TOOLS =
  '## Build scope — LOCKED (staged implementation run, tools OFF)\n' +
  'Native function tools are OFF. Do not emit tool-call JSON, fake todo/write_file/list_dir calls, or ```json tool_calls fences. Ignore any instruction to "call `todo`".\n' +
  'A "build" request runs three ORDERED phases in CONTENT. Reasoning is outline only; CONTENT executes.\n' +
  'PHASE 1 — SCAFFOLD: put a markdown ToDo (3–12 items) in CONTENT, then create EVERY file and directory as `// relative/path` or ```diff fences. The client writes those fences to the connected bridge workspace (ws://127.0.0.1:17322). Relative paths only. Land the whole structure before filling any file. Do not invent listings you have not been given.\n' +
  'PHASE 2 — BUILD OUT: implement every scaffolded file with full working code via ```diff or `// relative/path` in CONTENT. Tick markdown ToDo items as files finish. Never leave a scaffolded file empty or stubbed.\n' +
  'PHASE 3 — VERIFY: emit a scoped ```bash fence (tsc/lint/tests). Do not call the verify tool.\n' +
  'A ToDo or essay with no scaffolded files + diffs is a FAILED build. Do not stop at the list. Do not spawn other coding CLIs.\n' +
  'HARD LOCK: never write placeholder/stub/"implement here" scripts. Full-length working code only. Write every file into the connected working directory.';

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

export function buildBuildModeAlwaysNudge(opts: BuildNudgeOpts = {}): string {
  if (opts.toolsOff) {
    return (
      '## Build mode — ON (tools OFF)\n' +
      'Prefer shipping the change over advice. Native function tools are unavailable: markdown ToDo in CONTENT → real ```diff / // path fences this turn. Do not call `todo` or write_file. Skip the full ToDo only for a trivial one-shot (typo, single read).'
    );
  }
  return (
    '## Build mode — ON\n' +
    'Prefer shipping the change over advice. If this request touches files, run the Build lock: todo → explore tools → real diffs in content this turn. Skip the full ToDo only for a trivial one-shot (typo, single read).'
  );
}

/**
 * Read-only / control prompts must never trip Build lock — even when Build mode is on
 * and the text is long. Covers git_status, summarize, list, status, "run app", short inspect.
 */
export function looksReadOnlyOrControlPrompt(userText: string): boolean {
  const t = (userText || '').trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  // Explicit build verbs win over inspect heuristics.
  if (
    /\b(build|implement|scaffold|refactor|migrate|rewrite|overhaul|bootstrap|wire\s+up|create\s+.+\s+app)\b/.test(
      lower,
    ) ||
    looksBuildIntent(t)
  ) {
    return false;
  }
  if (
    /\bgit[_\s-]?status\b/.test(lower) ||
    /\b(git\s+status|show\s+status|repo\s+status|working\s+tree\s+status)\b/.test(lower)
  ) {
    return true;
  }
  if (/\b(run|start|launch|open)\s+(the\s+)?(app|server|dev\s*server|project)\b/.test(lower)) {
    return true;
  }
  if (
    /\b(summarize|summary|summarise)\b/.test(lower) ||
    /\b(list|show|print|dump)\s+(the\s+)?(files?|dirs?|directories|tree|contents?|status)\b/.test(lower) ||
    /^(list|ls|status|pwd|whoami|help)\b/.test(lower)
  ) {
    return true;
  }
  // Short inspect / control — never treat as a build solely because Build mode is on.
  if (t.length < 40) {
    if (/\b(read|check|inspect|look|what|where|which|how|why|status|diff|log)\b/.test(lower)) {
      return true;
    }
    if (!/\b(build|create|add|fix|write|edit|delete|remove)\b/.test(lower)) {
      return true;
    }
  }
  if (looksWebInteractionDirective(t)) return true;
  if (looksFactualQuestion(t)) return true;
  return false;
}

/**
 * Prompts directing the agent to interact with the web, search online, fetch URLs,
 * or perform online research. These must NEVER trip Build lock or force writing code files.
 */
export function looksWebInteractionDirective(userText: string): boolean {
  const t = (userText || '').trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  // Explicit code building requests (e.g., "build a web scraper app", "code a crawler")
  if (
    /\b(?:build|scaffold|create|code|implement|write)\s+(?:an?\s+)?(?:web\s+)?(?:app|scraper|crawler|bot|server|backend|extension|api|cli)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  // Web search queries / online lookups / directives to interact with web
  if (
    /\b(?:web[_\s-]?search|search\s+(?:the\s+)?web|search\s+online|look\s*up\s+(?:on\s+)?(?:the\s+)?web|check\s+(?:the\s+)?web)\b/i.test(
      lower,
    ) ||
    /\b(?:google|bing|duckduckgo|searx|searxng)\b/i.test(lower) ||
    /\b(?:web\s+interaction|browse\s+(?:the\s+)?web|online\s+research|find\s+online|search\s+for\s+.+\s+online)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  // URL fetching or reading
  if (
    /\b(?:fetch|scrape|read|retrieve|visit|open|curl|inspect|browse)\s+(?:the\s+)?(?:url|webpage|page|website|site|link|article)\b/i.test(
      lower,
    ) ||
    /https?:\/\/[^\s]+/i.test(t)
  ) {
    return true;
  }
  return false;
}

/** Short Q&A / fact ask — not a codebase build. Length up to 160 so "What is 2+2?" class prompts skip Plan/Build. */
export function looksFactualQuestion(userText: string): boolean {
  const t = (userText || '').trim();
  if (!t || t.length > 160) return false;
  const lower = t.toLowerCase();
  if (looksBuildIntent(t) || looksPromptOnlyRequest(t)) return false;
  if (/\b(implement|scaffold|refactor|migrate|rewrite|create|build|edit|fix|write_file|patch)\b/.test(lower)) {
    return false;
  }
  if (/\b(src\/|workspace|pull request|typecheck|file tree)\b/.test(lower)) return false;
  if (/^\s*(what|who|when|where|why|how|is|are|can|does|do|explain)\b/i.test(t)) return true;
  if (/\?\s*$/.test(t) && !/\b(file|repo|directory|folder)\b/.test(lower)) return true;
  return false;
}

/** Unfinished markdown fence (odd ``` count) — often a truncated stream. */
export function hasUnfinishedCodeFence(content: string): boolean {
  const marks = (content || '').match(/```/g);
  return !!marks && marks.length % 2 === 1;
}

/**
 * Junk / failed turns must not self-deepen: empty, error status, very short,
 * network-ish errors, or truncated unfinished ```diff fences.
 */
export function shouldSkipSelfDeepen(
  content: string,
  opts: { status?: string } = {},
): boolean {
  if (opts.status === 'error') return true;
  const t = (content || '').trim();
  if (!t) return true;
  if (looksLikeTokenCollapse(t)) return true;
  if (t.length < 40) return true;
  if (hasUnfinishedCodeFence(t) && /```(?:diff|patch)\b/i.test(t)) return true;
  if (
    /\b(network\s+error|ECONNRESET|ETIMEDOUT|fetch failed|Chat request failed|socket hang up)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/** True for an actual build request (not every multi-step chat). Plan mode never builds. */
export function shouldApplyBuildProcess(
  userText: string,
  opts: { buildMode?: boolean; planMode?: boolean } = {},
): boolean {
  if (opts.planMode) return false;
  const t = (userText || '').trim();
  if (!t) return false;
  if (looksPromptOnlyRequest(t)) return false;
  if (looksReadOnlyOrControlPrompt(t) || looksWebInteractionDirective(t)) return false;
  if (looksBuildIntent(t) || looksLargeJob(t)) return true;
  if (!opts.buildMode) return false;
  // Build mode on: require multi-step / build signals — NEVER length alone.
  if (looksTrivialFileEdit(t)) return false;
  if (looksMultiStep(t)) return true;
  return false;
}

export function buildReasoningThenBuildNudge(opts: BuildNudgeOpts = {}): string {
  return opts.toolsOff ? BUILD_PROCESS_SECTION_NO_TOOLS : BUILD_PROCESS_SECTION;
}

export function buildBuildModeNudge(opts: BuildNudgeOpts = {}): string {
  return buildReasoningThenBuildNudge(opts);
}

export function buildBuildModeTodoNudge(opts: BuildNudgeOpts = {}): string {
  if (opts.toolsOff) {
    return (
      'Build scope Phase 1 (scaffold, tools OFF): do NOT call `todo` or write_file as function tools. ' +
      'Put a markdown ToDo (3–12 items) in CONTENT, then create the COMPLETE file/folder skeleton as ' +
      '`// relative/path` or ```diff fences. The client writes them to the connected bridge filepath. Relative paths only. ' +
      'Land the whole structure before filling any file. Do not only reason or only list tasks.'
    );
  }
  return (
    'Build scope Phase 1 (scaffold): call `todo` with 3–12 items, then create the COMPLETE file/folder skeleton first — ' +
    'every file and directory the product needs, as real paths (write_file or // relative/path fences). ' +
    'Land the whole structure before filling any file. Do not only reason or only list tasks.'
  );
}

export function buildBuildModeImplementNudge(opts: BuildNudgeOpts = {}): string {
  if (opts.toolsOff) {
    return (
      'Build scope Phase 2 (build out, tools OFF): you listed tasks but did not emit a real ```diff / // path fence. ' +
      'Do not call write_file or `todo`. Now: (1) if the file skeleton is not complete, finish scaffolding every needed file as `// relative/path` or ```diff; ' +
      '(2) comprehensively implement each scaffolded file with full working code in those fences; ' +
      '(3) tick markdown ToDo items in content as files finish. Do not reply with another list only. ' +
      'NEVER emit placeholder/stub/"implement here" code. Write the full working implementation, then a ```bash verify fence (Phase 3).'
    );
  }
  return (
    'Build scope Phase 2 (build out): you scaffolded or listed but did not emit a real ```diff / // path fence OR call write_file. ' +
    'That is not a build. Now: (1) if the file skeleton is not complete, finish scaffolding every needed file first; ' +
    '(2) comprehensively implement each scaffolded file with full working code via a real ```diff or // relative/path fence in content, OR call write_file; ' +
    '(3) call `todo` with merge=true to tick finished files. Do not reply with another list only. ' +
    'NEVER emit placeholder/stub/"implement here" code. Write the full working implementation, then verify it (Phase 3).'
  );
}

export function buildPlaceholderCodeNudge(): string {
  return (
    'HARD LOCK: the last turn emitted placeholder/stub/"not implemented" code. That is a failed build. ' +
    'Replace every stub with full-length, fully functional code now. Typecheck/test it. Do not stop until the product works.'
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

export function filterModeTools(enabled: readonly ToolType[], mode: AgentMode): ToolType[] {
  switch (mode) {
    case 'ask': {
      const allow = new Set<ToolType>(ASK_MODE_TOOLS);
      return enabled.filter((t) => allow.has(t));
    }
    case 'plan': {
      const allow = new Set<ToolType>(PLAN_MODE_TOOLS);
      return enabled.filter((t) => allow.has(t));
    }
    case 'debug': {
      const allow = new Set<ToolType>(DEBUG_MODE_TOOLS);
      return enabled.filter((t) => allow.has(t));
    }
    case 'agent':
    default: {
      return [...enabled];
    }
  }
}

export function buildModeNudge(mode: AgentMode): string {
  switch (mode) {
    case 'ask':
      return (
        '## Ask mode — READ ONLY. Writes and execution are blocked.\n' +
        'You may explore, search, and answer questions. No file modifications or destructive shell actions.'
      );
    case 'plan':
      return buildPlanModeNudge();
    case 'debug':
      return (
        '## Debug mode — SYSTEMATIC REPRODUCE & FIX.\n' +
        'Reproduce the issue, isolate the cause, formulate a targeted fix, verify with tests/checks, report findings.'
      );
    case 'agent':
    default:
      return '';
  }
}

export function filterPlanModeTools(enabled: readonly ToolType[]): ToolType[] {
  return filterModeTools(enabled, 'plan');
}

export function buildPlanModeNudge(): string {
  return (
    '## Plan mode — LOCKED (read-only). Overrides Build. Writes are blocked.\n' +
    'FORBIDDEN in content AND reasoning: unified diffs, ```diff, ```bash, // path files, write/shell/git_commit/create_pr/write_skill, applying patches.\n' +
    'ALLOWED tools: read_file, grep, glob, list_dir, file_outline, semantic_search, git_status, git_diff, web_fetch, web_search, todo, list_skills, read_skill, suggest_skill, memory_search, memory_status, memory_wake.\n' +
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

/** Skip workspace prefetch (semantic_search + extra reads) unless pins, path mentions, explore, or build. */
export function shouldPrefetchWorkspace(
  text: string,
  opts?: { explore?: boolean; build?: boolean },
): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (opts?.explore || opts?.build) return true;
  if (extractAtPins(t).length) return true;
  if (/(?:^|[\s`'"(])(?:src|lib|app|daemon|public|scripts?|components?|screens?)\/[\w./+-]+/.test(t)) {
    return true;
  }
  if (/\b[\w./+-]+\.(?:ts|tsx|js|jsx|mjs|py|rs|go|md|css)\b/.test(t)) return true;
  return false;
}

/** True when a bash/tool line looks like an accidental review-history git_commit. */
export function isSpuriousReviewCommit(commandOrText: string): boolean {
  if (!commandOrText) return false;
  return /git_commit\b/i.test(commandOrText) && /\b(review|recent|analy[sz]|inspect|history|log|view|diff|check)\b/i.test(commandOrText);
}
