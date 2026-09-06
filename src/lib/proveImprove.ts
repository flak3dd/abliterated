/** Hard gate: agent turns must prove enhancement (file write, verify, or tool-backed finding). */

const BUILD_WRITE_TOOLS = new Set([
  'write_file',
  'apply_patch',
  'search_replace',
  'edit_file',
  'str_replace',
]);

const EXPLORE_TOOLS = new Set([
  'read_file',
  'grep',
  'list_dir',
  'glob',
  'semantic_search',
  'file_outline',
]);

function hasTool(toolsUsed: string[] | undefined, names: Set<string>): boolean {
  if (!toolsUsed || !toolsUsed.length) return false;
  return toolsUsed.some((t) => names.has(String(t || '').toLowerCase()));
}

/** Fence / path-headed build artifacts (kept local to avoid import cycles). */
function looksLikeContentArtifacts(text: string): boolean {
  const t = text || '';
  if (/```(?:diff|patch|bash|ts|tsx|js|jsx|mjs|cjs|py|go|rs|json|css|html|vue|svelte)/i.test(t)) return true;
  if (/^diff --git |^--- (a\/|\/dev\/null)|\+\+\+ b\//m.test(t)) return true;
  if (/^\/\/ [\w./+-]+\s*$/m.test(t) && t.length > 50) return true;
  return false;
}

/** True for Q&A / explain / inspect / control prompts that need no file change. */
export function looksReadOnlyOrControlPrompt(userText: string): boolean {
  const t = (userText || '').trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  if (/\\b(implement|scaffold|bootstrap|refactor|migrate|rewrite|create\\s+(a|an|the)\\s+(app|project|feature))\\b/.test(lower)) return false;
  if (/\\b(fix|edit|change|update|patch|wire|add)\\b/.test(lower) && t.length >= 24) return false;
  if (/\\b(what|why|how|where|when|who|which|explain|describe|summarize|status|show|list|read|find|search|look)\\b/.test(lower)) return true;
  if (/\\b(plan\\s+only|just\\s+plan|don't\\s+(code|edit|change)|do\\s+not\\s+(code|edit|change))\\b/.test(lower)) return true;
  if (t.length < 40 && !/\\b(fix|edit|build|implement|add|create)\\b/.test(lower)) return true;
  return false;
}

/** True when this turn already landed provable improvement evidence. */
export function looksLikeProvenImprovement(content: string, toolsUsed?: string[]): boolean {
  if (hasTool(toolsUsed, BUILD_WRITE_TOOLS)) return true;
  if (looksLikeContentArtifacts(content)) return true;
  if (toolsUsed && toolsUsed.some((t) => String(t || '').toLowerCase() === 'verify')) return true;
  if (toolsUsed && toolsUsed.some((t) => String(t || '').toLowerCase() === 'shell')) {
    const c = (content || '').toLowerCase();
    if (/\b(pass(ed)?|ok|success|green|typecheck|lint|tests?\s+(pass|ok))\b/.test(c)) return true;
  }
  if (hasTool(toolsUsed, EXPLORE_TOOLS)) {
    const c = (content || '').trim();
    if (c.length > 80 && !/\b(i('ll| will)\s+look|let me (check|look|search)|going to (read|check))\b/i.test(c)) return true;
  }
  return false;
}

export function buildProveImproveNudge(): string {
  return (
    'Prove improvement: this turn has no file write, diff/path fence, verify evidence, or concrete tool-backed finding. ' +
    'Before stopping: (1) call write_file or emit a real ```diff / // path fence, OR (2) run verify/shell with a measurable result, OR (3) use explore tools and report a concrete finding. ' +
    'Essay-only or ToDo-only replies are incomplete.'
  );
}
