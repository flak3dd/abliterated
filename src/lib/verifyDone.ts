const VERIFY_CMD =
  /\b(tsc|typecheck|type-check|eslint|lint|vitest|jest|pytest|npm test|npm run test|npm run lint|npx tsc)\b/i;
const EXIT_OK = /\b(exit(?:\s+code)?\s*[:=]?\s*0|passed|\bok\b|\bsuccess\b|tests?\s+pass)/i;
const EXIT_FAIL = /\b(exit(?:\s+code)?\s*[:=]?\s*[1-9]\d*|ELIFECYCLE|error TS\d+)/i;

/** True when verify ran, or shell ran a typecheck/lint/test that exited 0. */
export function looksLikeVerifyEvidence(text: string, toolsUsed?: string[]): boolean {
  const tools = (toolsUsed || []).map((t) => String(t || '').toLowerCase());
  if (tools.includes('verify')) return true;
  if (!tools.includes('shell')) return false;
  const t = text || '';
  if (!VERIFY_CMD.test(t)) return false;
  if (EXIT_FAIL.test(t) && !/\bexit(?:\s+code)?\s*[:=]?\s*0\b/i.test(t)) return false;
  return EXIT_OK.test(t);
}

export function buildVerifyBeforeDoneNudge(): string {
  return (
    'Need a scoped verify step before done. ' +
    'Call verify or shell with typecheck/lint/test, then summarize.'
  );
}

export function buildIncompleteCapNote(turnCap: number): string {
  return 'Incomplete: hit max agent turns (' + String(turnCap) + '). Work may be partial.';
}

/**
 * Cold-context verifier gate: critic/verifier must have called the `verify` tool.
 * Self-declared pass without verify is rejected.
 */
export function coldVerifierRequiresVerify(toolsUsed: string[]): {
  ok: boolean;
  reason: string;
} {
  if (toolsUsed.includes('verify')) {
    return { ok: true, reason: 'verify tool called' };
  }
  return {
    ok: false,
    reason: 'cold verifier must call verify tool before pass — no self-declared complete',
  };
}

export function buildColdVerifierSystemBlock(packet: {
  nodeId?: string;
  description?: string;
  successCriteria?: string;
  artifacts?: string[];
}): string {
  const arts = (packet.artifacts || []).slice(0, 12).join(', ') || '(none)';
  return [
    '## Cold-context verifier (mandatory)',
    'You do NOT share the coder\'s thought stream. Judge only the packet below.',
    packet.nodeId ? `Node: ${packet.nodeId}` : '',
    packet.description ? `Work: ${packet.description}` : '',
    packet.successCriteria ? `Success criteria: ${packet.successCriteria}` : '',
    `Artifacts: ${arts}`,
    'You MUST call the `verify` tool (or shell typecheck/test via verify) before pass.',
    'On failure: reject and keep the node blocked/pending. Never mark fleet done.',
  ]
    .filter(Boolean)
    .join('\n');
}
