/** Pure harness gates — no React, no bridge. Safe to compile in fixture evals. */

export const BUILD_WRITE_TOOL_NAMES = new Set([
  'write_file',
  'apply_patch',
  'search_replace',
  'edit_file',
  'str_replace',
]);

export const EXPLORE_TOOL_NAMES = new Set([
  'read_file',
  'grep',
  'list_dir',
  'glob',
  'semantic_search',
  'file_outline',
]);

export type RunProof = {
  write: boolean;
  verify: boolean;
  explore: boolean;
  proven: boolean;
};

export function looksLikeHarnessNudge(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return true;
  if (t.startsWith('⟦mid-run⟧')) return true;
  return /^(↻|Build process:|Tool recovery:|Deepen this answer|Need a scoped verify|Plan approved\.|Prove improvement:|Inspect before write:|LOCKED GOAL|Incomplete:|Call the matching MCP|Propose a skill:|Use the matching skill:)/.test(
    t,
  );
}

/** First real operator request in the thread (locked goal). */
export function extractLockedGoal(messages: { role?: string; content?: string }[]): string {
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const c = (m.content || '').trim();
    if (!c || looksLikeHarnessNudge(c)) continue;
    return c.slice(0, 800);
  }
  return '';
}

/** Latest real operator prompt (skip harness nudges / mid-run). */
export function lastOperatorPrompt(messages: { role?: string; content?: string }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const c = (m.content || '').trim();
    if (!c || looksLikeHarnessNudge(c)) continue;
    return c;
  }
  return '';
}

export function lockedGoalSystemBlock(goal: string): string {
  const g = (goal || '').trim();
  if (!g) return '';
  return `LOCKED GOAL (operator request — do not replace):\n${g}\nStay on this goal unless a mid-run operator note explicitly changes it.`;
}

export function hasOpenTodos(items?: { done?: boolean }[]): boolean {
  return !!(items && items.some((t) => !t.done));
}

/**
 * Generic self-deepen only for open todos. Never on junk, length, or a Done footer.
 * Verify-before-done and prove-improve have their own one-shot nudges.
 */
export function shouldEvidenceDeepen(opts: {
  content: string;
  deepenOn?: boolean;
  junkTurn?: boolean;
  footerDone?: boolean;
  answerComplete?: boolean;
  openTodos?: boolean;
}): boolean {
  if (!opts.deepenOn) return false;
  if (opts.junkTurn || opts.footerDone || opts.answerComplete) return false;
  if (!(opts.content || '').trim()) return false;
  return !!opts.openTodos;
}

export function needsInspectBeforeWrite(opts: {
  userText: string;
  toolsUsed: string[];
  pendingToolNames: string[];
  trivialEdit?: boolean;
}): boolean {
  if (opts.trivialEdit) return false;
  const pending = (opts.pendingToolNames || []).map((n) => String(n || '').toLowerCase());
  const used = (opts.toolsUsed || []).map((n) => String(n || '').toLowerCase());
  const pendingWrite = pending.some((n) => BUILD_WRITE_TOOL_NAMES.has(n));
  if (!pendingWrite) return false;
  const inspected =
    used.some((n) => EXPLORE_TOOL_NAMES.has(n)) || pending.some((n) => EXPLORE_TOOL_NAMES.has(n));
  return !inspected;
}

export function buildInspectBeforeWriteNudge(): string {
  return (
    'Inspect before write: call read_file, grep, or list_dir on the target path this turn before the first write_file or diff. ' +
    'Trivial one-line edits may skip. Do not write blind.'
  );
}

export function assignableNodeCount(graph?: { subtasks?: { status?: string }[] } | null): number {
  const subs = graph?.subtasks;
  if (!subs || !subs.length) return 0;
  return subs.filter((s) => s.status === 'pending' || s.status === 'in_progress').length;
}

/**
 * Multi-agent fleet: settings + job flag, then graph must have ≥2 assignable nodes.
 * Empty/missing graph still starts so the orchestrator can decompose.
 */
export function multiAgentShouldRun(opts: {
  multiAgentEnabled?: boolean;
  jobMultiAgent?: boolean;
  hasGraph?: boolean;
  assignableNodes?: number;
}): boolean {
  if (opts.multiAgentEnabled !== true) return false;
  if (opts.jobMultiAgent !== true) return false;
  if (!opts.hasGraph) return true;
  return (opts.assignableNodes ?? 0) >= 2;
}

export function summarizeRunProof(opts: {
  write: boolean;
  verify: boolean;
  explore: boolean;
  proven: boolean;
}): RunProof {
  return {
    write: !!opts.write,
    verify: !!opts.verify,
    explore: !!opts.explore,
    proven: !!opts.proven,
  };
}
