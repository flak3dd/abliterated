/** Parse the agent Completion footer from a finished assistant message. */

export type ParsedCompletionFooter = {
  /** Message content with the footer removed. */
  body: string;
  /** Text after **Done:** (bullets or short paragraph). */
  summary: string;
  /** Exactly three continue prompts when parse succeeds. */
  options: [string, string, string];
};

/**
 * Detects a trailing Done/Continue footer.
 * Prefers the strict --- / **Done:** / **Continue:** form, then falls back to a
 * messy variant (missing ---, loose Done/Continue labels, extra blank lines) as
 * long as Done text + at least three numbered Continue lines are present.
 *
 * Returns null if the footer is missing or does not yield at least 3 options.
 */
export function parseCompletionFooter(content: string): ParsedCompletionFooter | null {
  const raw = content ?? '';
  if (!raw.trim()) return null;

  // Strict: --- + **Done:** + **Continue:** + exactly 3 numbered lines at end.
  const strict =
    /(?:^|\n)---\s*\n\*\*Done:\*\*[ \t]*([^\n]*(?:\n(?!\*\*Continue:\*\*)[^\n]*)*)\n\*\*Continue:\*\*\s*\n\s*1\.\s*(.+)\n\s*2\.\s*(.+)\n\s*3\.\s*(.+)\s*$/;

  const m = raw.match(strict);
  if (m) {
    const summary = (m[1] || '').trim();
    const o1 = (m[2] || '').trim();
    const o2 = (m[3] || '').trim();
    const o3 = (m[4] || '').trim();
    if (summary && o1 && o2 && o3) {
      const body = raw.slice(0, m.index).replace(/\s+$/, '');
      return { body, summary, options: [o1, o2, o3] };
    }
  }

  // Messy fallback: Done + Continue with 3+ numbered lines near the end.
  const loose =
    /(?:^|\n)(?:---+\s*\n)?(?:\*\*)?Done:?\*?\*?[ \t]*([^\n]*(?:\n(?!(?:\*\*)?Continue:?\*?\*?)[^\n]*)*)\n(?:\*\*)?Continue:?\*?\*?\s*\n((?:\s*\d+[.)]\s*.+\n?){3,})\s*$/i;

  const looseMatch = raw.match(loose);
  if (!looseMatch) return null;

  const summary = (looseMatch[1] || '').trim();
  const listBlock = looseMatch[2] || '';
  const opts: string[] = [];
  for (const line of listBlock.split(/\n/)) {
    const om = line.match(/^\s*\d+[.)]\s*(.+?)\s*$/);
    if (!om) continue;
    const item = (om[1] || '').trim();
    if (item) opts.push(item);
    if (opts.length >= 3) break;
  }
  if (!summary || opts.length < 3) return null;

  const body = raw.slice(0, looseMatch.index).replace(/\s+$/, '');
  return { body, summary, options: [opts[0], opts[1], opts[2]] };
}

/** True when content ends with a parseable Done/Continue footer (exactly 3 options). */
export function hasValidCompletionFooter(content: string): boolean {
  return parseCompletionFooter(content) != null;
}
