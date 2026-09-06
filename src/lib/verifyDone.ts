export function looksLikeVerifyEvidence(_text: string, toolsUsed?: string[]): boolean {
  if (toolsUsed && toolsUsed.indexOf('verify') >= 0) return true;
  return false;
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
