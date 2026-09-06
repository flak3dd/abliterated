/** Hard gate: agent turns must prove enhancement (file write, verify, or tool-backed finding). */

import { BUILD_WRITE_TOOL_NAMES, EXPLORE_TOOL_NAMES, summarizeRunProof, type RunProof } from './harnessGates';
import { looksLikeVerifyEvidence } from './verifyDone';

const BUILD_WRITE_TOOLS = BUILD_WRITE_TOOL_NAMES;
const EXPLORE_TOOLS = EXPLORE_TOOL_NAMES;

export type { RunProof };
export { summarizeRunProof };

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

export { looksReadOnlyOrControlPrompt } from './agentHelpers';

/** True when this turn already landed provable improvement evidence. */
export function looksLikeProvenImprovement(content: string, toolsUsed?: string[]): boolean {
  if (hasTool(toolsUsed, BUILD_WRITE_TOOLS)) return true;
  if (looksLikeContentArtifacts(content)) return true;
  if (looksLikeVerifyEvidence(content, toolsUsed)) return true;
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

export function buildRunProof(content: string, toolsUsed?: string[]): RunProof {
  const tools = (toolsUsed || []).map((t) => String(t || '').toLowerCase());
  return summarizeRunProof({
    write: hasTool(toolsUsed, BUILD_WRITE_TOOLS) || looksLikeContentArtifacts(content),
    verify: looksLikeVerifyEvidence(content, toolsUsed),
    explore: tools.some((t) => EXPLORE_TOOLS.has(t)),
    proven: looksLikeProvenImprovement(content, toolsUsed),
  });
}

export function buildProveImproveNudge(): string {
  return (
    'Prove improvement: this turn has no file write, diff/path fence, verify evidence, or concrete tool-backed finding. ' +
    'Before stopping: (1) call write_file or emit a real ```diff / // path fence, OR (2) run verify/shell with a measurable result, OR (3) use explore tools and report a concrete finding. ' +
    'Essay-only or ToDo-only replies are incomplete.'
  );
}
