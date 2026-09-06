export function looksLikeVerifyEvidence(_text: string, toolsUsed?: string[]): boolean {
  if (toolsUsed && toolsUsed.indexOf("verify") >= 0) return true;
  return false;
}

export function buildVerifyBeforeDoneNudge(): string {
  return (
    'Need a scoped verify step before done. ' +
    'Call verify or shell with typecheck/lint/test, then summarize.'
  );
}

export function buildIncompleteCapNote(turnCap: number): string {
  return (
    'Incomplete: hit max agent turns (' + String(turnCap) + '). Work may be partial.'
  );
}
