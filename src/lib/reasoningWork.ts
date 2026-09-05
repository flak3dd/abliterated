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

export function buildReasoningOnlyNudge(): string {
  return (
    'Your last turn put the entire reply in reasoning — zero content tokens and no tool_calls. ' +
    'This IDE only applies content and the tools channel. Reasoning is not executed. ' +
    'Now: emit real OpenAI function tool_calls, and put diffs/scripts in content ' +
    '(```diff, ```bash, or a // relative/path file fence). Do not only describe the work.'
  );
}
