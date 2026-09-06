/** Lift scripts/diffs trapped in the reasoning channel into applyable content. */

const FENCE_RE = /```[^\n]*\n[\s\S]*?```/g;

const TOOL_NAME_RE =
  /\b(list_dir|read_file|grep|glob|file_outline|semantic_search|git_status|git_diff|git_commit|create_pr|web_fetch|web_search|write_file|apply_patch|apply_diff|delete_file|shell|list_skills|read_skill|suggest_skill|write_skill)\b/;

/** Drop fenced code, unified diffs, and //path dumps so plan/reasoning stays prose. */
export function stripImplementationFromText(text: string): string {
  let t = String(text || '');
  if (!t.trim()) return '';
  t = t.replace(FENCE_RE, '');
  t = t.replace(/^diff --git .+\n/gm, '');
  t = t.replace(/^--- (?:a\/|\/dev\/null).*\n\+\+\+ b\/.*\n(?:@@.*\n(?:[-+ ].*\n)*)*/gm, '');
  t = t.replace(/^\/\/ [\w./+-]+\s*\n(?:(?:import |export |const |let |var |function |class |type |interface |from |def |fn |pub |#include ).*\n)+/gm, '');
  return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const PLAN_CODE_OMITTED_NOTE =
  'Plan mode is read-only. Checklist only — Approve to write code.';

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
