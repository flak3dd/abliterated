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
 * Detects a trailing:
 * ---
 * **Done:** ...
 * **Continue:**
 * 1. ...
 * 2. ...
 * 3. ...
 *
 * Returns null if the footer is missing or does not yield exactly 3 options.
 */
export function parseCompletionFooter(content: string): ParsedCompletionFooter | null {
  const raw = content ?? '';
  if (!raw.trim()) return null;

  // Anchor on the last **Continue:** block with three numbered lines (footer lives at end).
  const re =
    /(?:^|\n)---\s*\n\*\*Done:\*\*[ \t]*([^\n]*(?:\n(?!\*\*Continue:\*\*)[^\n]*)*)\n\*\*Continue:\*\*\s*\n\s*1\.\s*(.+)\n\s*2\.\s*(.+)\n\s*3\.\s*(.+)\s*$/;

  const m = raw.match(re);
  if (!m) return null;

  const summary = (m[1] || '').trim();
  const o1 = (m[2] || '').trim();
  const o2 = (m[3] || '').trim();
  const o3 = (m[4] || '').trim();
  if (!summary || !o1 || !o2 || !o3) return null;

  const body = raw.slice(0, m.index).replace(/\s+$/, '');
  return { body, summary, options: [o1, o2, o3] };
}

/** True when content ends with a parseable Done/Continue footer (exactly 3 options). */
export function hasValidCompletionFooter(content: string): boolean {
  return parseCompletionFooter(content) != null;
}
