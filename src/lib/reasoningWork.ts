/** Lift scripts/diffs trapped in the reasoning channel into applyable content. */

const FENCE_RE = /```[^\n]*\n[\s\S]*?```/g;

const TOOL_NAME_RE =
  /\b(list_dir|read_file|grep|glob|file_outline|semantic_search|git_status|git_diff|git_commit|create_pr|web_fetch|web_search|write_file|apply_patch|apply_diff|delete_file|shell|list_skills|read_skill|suggest_skill|write_skill)\b/;

const CODE_LINE_RE =
  /^(?:import\s|export\s|from\s['"]|const\s|let\s|var\s|function\s|async\s+function|class\s|type\s|interface\s|enum\s|def\s|fn\s|pub\s|impl\s|struct\s|#include\s|using\s|package\s|return\s|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|<\/?[A-Z][A-Za-z0-9]+[\s/>]|[{}\[\];]\s*$|\/\/\s|\/\*|\*\s)/;

function isCodeLine(line: string): boolean {
  const s = line.trim();
  if (!s) return false;
  if (/^(goal|inspect|plan|delta|success|risks?)\s*:/i.test(s)) return false;
  if (/^\d+[.)]\s+/.test(s) && !/[;{}].*(?:=>|function |const |import )/.test(s)) return false;
  if (/^[-*]\s+/.test(s) && !CODE_LINE_RE.test(s.slice(2).trim())) return false;
  if (CODE_LINE_RE.test(s)) return true;
  if (/=>/.test(s) && /[)\]}]/.test(s)) return true;
  if (/[{};]\s*$/.test(s) && /[=(){}]/.test(s) && !/^\d+[.)]/.test(s)) return true;
  return false;
}

function stripCodeRuns(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let run: string[] = [];
  const flushRun = () => {
    if (run.length >= 2 || (run.length === 1 && /[;{}]|import |function |class |const |def /.test(run[0]))) {
      run = [];
      return;
    }
    out.push(...run);
    run = [];
  };
  for (const line of lines) {
    if (isCodeLine(line) || /^(?: {4}|\t)/.test(line) && line.trim()) {
      run.push(line);
    } else {
      flushRun();
      out.push(line);
    }
  }
  flushRun();
  return out.join('\n');
}

/** Drop fenced code, unified diffs, //path dumps, and code runs so thought stays prose. */
export function stripImplementationFromText(text: string): string {
  let t = String(text || '');
  if (!t.trim()) return '';
  t = t.replace(FENCE_RE, '');
  t = t.replace(/```[\s\S]*$/g, '');
  t = t.replace(/^diff --git .+\n/gm, '');
  t = t.replace(/^--- (?:a\/|\/dev\/null).*\n\+\+\+ b\/.*\n(?:@@.*\n(?:[-+ ].*\n)*)*/gm, '');
  t = t.replace(/^\/\/ [\w./+-]+\s*\n(?:(?:import |export |const |let |var |function |class |type |interface |from |def |fn |pub |#include ).*\n)+/gm, '');
  t = t.replace(/(?:^(?: {4}|\t).+\n){2,}/gm, '');
  t = stripCodeRuns(t);
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const THOUGHT_CODE_MOVED_NOTE =
  '(Code stripped from thought — write files with ```diff or // path in content only.)';

export const PLAN_CODE_OMITTED_NOTE =
  'Plan mode is read-only. Checklist only — Approve to write code.';

/**
 * Thought must stay prose. Code/diffs/fences are stripped from reasoning.
 * When liftToContent is on (not Plan), those fences are appended to content so they can be written to files.
 */
export function enforceThoughtNoCode(
  assistant: { content: string; reasoning?: string },
  opts?: { liftToContent?: boolean },
): boolean {
  const raw = assistant.reasoning || '';
  if (!raw.trim()) return false;
  const lifted = liftReasoningWork(raw);
  const prose = stripImplementationFromText(raw);
  let changed = false;
  if (prose) {
    if (prose !== raw.trim()) {
      assistant.reasoning = prose;
      changed = true;
    }
  } else if (lifted) {
    assistant.reasoning = THOUGHT_CODE_MOVED_NOTE;
    changed = true;
  } else if (raw.trim()) {
    assistant.reasoning = undefined;
    changed = true;
  }
  if (lifted && opts?.liftToContent !== false) {
    const c = assistant.content || '';
    const sig = lifted.slice(0, Math.min(80, lifted.length));
    if (!c.includes(sig)) {
      assistant.content = c.trim() ? `${c.trimEnd()}\n\n${lifted}` : lifted;
      changed = true;
    }
  }
  return changed;
}

/** Fenced blocks, unified diffs, or whole-file path dumps sitting in reasoning. */
export function liftReasoningWork(reasoning: string): string {
  const text = (reasoning || '').trim();
  if (!text) return '';
  const fences = text.match(FENCE_RE);
  if (fences?.length) return fences.join('\n\n').trim();
  if (/^(diff --git |--- (a\/|\/dev\/null)|\+\+\+ b\/|@@ -)/m.test(text)) return text;
  if (/^\/\/ [\w./+-]+\s*$/m.test(text) && text.length > 60) return text;
  return '';
}

/** Model described work (tools/scripts) in reasoning but emitted no content/tool_calls. */
export function reasoningLooksLikeStalledWork(reasoning: string): boolean {
  const t = reasoning || '';
  if (!t.trim()) return false;
  if (liftReasoningWork(t)) return true;
  if (/```/.test(t)) return true;
  if (TOOL_NAME_RE.test(t)) return true;
  return false;
}

export type ReasoningSection = { id: string; title: string; body: string };

function unwrapThink(text: string): string {
  return String(text || '')
    .replace(/^<think>\s*/i, '')
    .replace(/\s*<\/think>\s*$/i, '')
    .replace(/^\[thinking\]\s*/i, '')
    .replace(/\s*\[\/thinking\]\s*$/i, '')
    .replace(/^Thinking:\s*/i, '')
    .trim();
}

function titleCaseLabel(s: string): string {
  const t = s.trim();
  if (!t) return 'Thought';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Split a reasoning trace into titled chunks for nested dropdowns
 * (Goal / Inspect / Step N / markdown headings).
 */
export function splitReasoningSections(text: string): ReasoningSection[] {
  const raw = unwrapThink(text);
  if (!raw) return [];

  const headingRe = /^(#{1,3})\s+(.+)$/;
  const labelRe =
    /^(goal|inspect|steps?|plan|delta|success|risks?|after(?:\s+each)?\s+tool)\s*[:.—–-]\s*(.*)$/i;
  const namedStepRe = /^steps?\s+(\d+)\s*[:.—–-]\s*(.*)$/i;
  const stepRe = /^(\d+)[.)]\s+(.+)$/;

  const lines = raw.split(/\n/);
  const chunks: { title: string; body: string[] }[] = [];
  let cur: { title: string; body: string[] } = { title: 'Thought', body: [] };

  const push = () => {
    const body = cur.body.join('\n').trim();
    if (body) chunks.push({ title: cur.title, body: cur.body.slice() });
  };

  for (const line of lines) {
    const h = headingRe.exec(line.trim());
    if (h) {
      push();
      cur = { title: h[2].trim() || 'Thought', body: [] };
      continue;
    }
    const named = namedStepRe.exec(line.trim());
    if (named) {
      if (cur.body.length || cur.title !== 'Thought') push();
      cur = { title: `Step ${named[1]}`, body: named[2] ? [named[2]] : [] };
      continue;
    }
    const lab = labelRe.exec(line.trim());
    if (lab) {
      push();
      const rest = (lab[2] || '').trim();
      cur = { title: titleCaseLabel(lab[1]), body: rest ? [rest] : [] };
      continue;
    }
    const st = stepRe.exec(line.trim());
    if (st) {
      if (cur.body.length || cur.title !== 'Thought') push();
      cur = { title: `Step ${st[1]}`, body: [st[2]] };
      continue;
    }
    cur.body.push(line);
  }
  push();

  const sections = chunks.map((c, i) => ({
    id: `r${i}`,
    title: c.title,
    body: c.body.join('\n').trim(),
  })).filter((s) => s.body);

  if (!sections.length) return [{ id: 'r0', title: 'Thought', body: raw }];
  return sections;
}

export function buildReasoningOnlyNudge(): string {
  return (
    'Your last turn put the entire reply in reasoning — zero content tokens and no tool_calls. ' +
    'This IDE only applies content and the tools channel. Reasoning is not executed. ' +
    'Now: emit real OpenAI function tool_calls, and put diffs/scripts in content ' +
    '(```diff, ```bash, or a // relative/path file fence). Do not only describe the work.'
  );
}

/** File-producing action verbs — a step that should yield a file change in content. */
const FILE_ACTION_VERB_RE =
  /\b(creat(?:e|es|ing)|add(?:s|ing)?|writ(?:e|es|ing)|edit(?:s|ing)?|patch(?:es|ing)?|implement(?:s|ing)?|modif(?:y|ies|ying)|updat(?:e|es|ing)|refactor(?:s|ing)?|renam(?:e|es|ing)|delet(?:e|es|ing)|scaffold(?:s|ing)?|generat(?:e|es|ing))\b/i;

// Non-global clones so .test() is not stateful — FENCE_RE is /g and advances lastIndex.
const CONTENT_FENCE_TEST = /```[^\n]*\n[\s\S]*?```/;
const CONTENT_DIFF_TEST = /^(?:diff --git |--- (?:a\/|\/dev\/null)|\+\+\+ b\/|@@ -)/m;
const CONTENT_PATH_FENCE_TEST = /^\/\/ [\w./+-]+\s*$/m;

/** True when content already carries applyable execution: a fence, unified diff, or // path file. */
export function contentHasExecution(content: string): boolean {
  const c = content || '';
  if (CONTENT_FENCE_TEST.test(c)) return true;
  if (CONTENT_DIFF_TEST.test(c)) return true;
  if (CONTENT_PATH_FENCE_TEST.test(c) && c.length > 50) return true;
  return false;
}

/**
 * Count ENUMERATED step lines (Step N:, "1.", "1)", "- ", "* ") that name a
 * file-producing action. Prose Goal/Inspect lines are NOT steps and don't count,
 * so a single-ask plan stays under the >= 2 floor.
 */
export function reasoningActionStepCount(reasoning: string): number {
  const raw = reasoning || '';
  if (!raw.trim()) return 0;
  let n = 0;
  for (const line of raw.split('\n')) {
    const s = line.trim();
    if (!/^(?:step\s+\d+\b|\d+[.)]\s|[-*]\s)/i.test(s)) continue;
    if (FILE_ACTION_VERB_RE.test(s)) n++;
  }
  return n;
}

/**
 * The model mapped >= 2 concrete file steps in reasoning but the content carries
 * no execution (no fences/diffs/// path files). Pure over (reasoning, content):
 * run-level execution credit (grok-applied edits, write tools) and user-intent
 * guards belong at the call site. The >= 2 action-step floor + file-verb filter
 * keeps this from firing on ordinary Q&A / single-ask prose.
 */
export function reasoningStepsNotExecuted(reasoning: string, content: string): boolean {
  const r = reasoning || '';
  if (!r.trim()) return false;
  if (reasoningActionStepCount(r) < 2) return false;
  return !contentHasExecution(content);
}

export function buildReasoningExecuteNudge(): string {
  return (
    'Your reasoning mapped concrete file steps (e.g. "Step 1: create X", "Step 2: edit Y") but content only summarized them — it did not carry them out. ' +
    'This IDE applies ONLY the content and tool channels; reasoning is never executed. ' +
    'Now, in CONTENT, actually perform EVERY step you listed: emit the real ```diff or // relative/path file fences (or call write_file) that create/edit each file, and run/verify as your steps require. ' +
    'Do not restate the plan and do not write another "Done" summary. If a specific step genuinely cannot be done, name it and say why.'
  );
}
