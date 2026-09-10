/** Parse the agent Completion footer from a finished assistant message. */

export type ParsedCompletionFooter = {
  /** Message content with the footer removed. */
  body: string;
  /** Text after **Done:** or **Changes:** (bullets or short paragraph). */
  summary: string;
  /** Itemized list of changes/edits made in this turn. */
  changes?: string[];
  /** Self-verification checklist items confirming completed work. */
  verifications?: string[];
  /** Exactly three continue prompts when parse succeeds. */
  options: [string, string, string];
};

function extractItemsFromBlock(text: string): string[] {
  const items: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Match bullets like "- [x] ...", "- ...", "* ..."
    const bulletMatch = trimmed.match(/^[-*]\s*(?:\[[xX ]\]\s*)?(.+)$/);
    if (bulletMatch && bulletMatch[1].trim()) {
      items.push(bulletMatch[1].trim());
    }
  }
  return items;
}

function extractVerifications(text: string): string[] {
  const verifications: string[] = [];
  // 1. Explicit **Verified:** or ### Verified section
  const verifiedSectionMatch = text.match(
    /(?:^|\n)(?:\*\*(?:Verified|Verification):\*\*|###?\s*(?:Verified|Verification|Self-Verification)[^\n]*)\s*([\s\S]*?)(?=(?:\n\*\*(?:Continue|Done|Changes):\*\*|\n###|$))/i,
  );
  if (verifiedSectionMatch && verifiedSectionMatch[1].trim()) {
    const items = extractItemsFromBlock(verifiedSectionMatch[1]);
    if (items.length) verifications.push(...items);
  }

  // 2. Check for checked items in the whole text if not already extracted
  if (!verifications.length) {
    for (const line of text.split('\n')) {
      const checkMatch = line.trim().match(/^[-*]\s*\[[xX]\]\s*(.+)$/);
      if (checkMatch && checkMatch[1].trim()) {
        verifications.push(checkMatch[1].trim());
      }
    }
  }
  return verifications;
}

function extractChanges(text: string): string[] {
  // Check for **Changes:** or ### Summary of Changes section
  const changesSectionMatch = text.match(
    /(?:^|\n)(?:\*\*(?:Changes|Summary of Changes):\*\*|###?\s*(?:Summary of Changes|Changes|Edits)[^\n]*)\s*([\s\S]*?)(?=(?:\n\*\*(?:Continue|Done|Verified|Verification):\*\*|\n###|$))/i,
  );
  if (changesSectionMatch && changesSectionMatch[1].trim()) {
    const items = extractItemsFromBlock(changesSectionMatch[1]);
    if (items.length) return items;
  }
  return extractItemsFromBlock(text);
}

/**
 * Detects a trailing Done/Continue footer.
 * Prefers the strict --- / **Done:** / **Continue:** form, then falls back to a
 * messy variant (missing ---, loose Done/Continue labels, extra blank lines) as
 * long as Done text + at least three numbered Continue lines are present.
 *
 * Supports enhanced Change Summaries and Self-Verification checklists (**Verified:**).
 * Returns null if the footer is missing or does not yield at least 3 options.
 */
export function parseCompletionFooter(content: string): ParsedCompletionFooter | null {
  const raw = content ?? '';
  if (!raw.trim()) return null;

  // Strict: --- + (**Done:** or **Changes:**) + [optional **Verified:**] + **Continue:** + 3 options
  const strictWithVerified =
    /(?:^|\n)---\s*\n(?:\*\*(?:Done|Changes|Summary of Changes):\*\*)[ \t]*([^\n]*(?:\n(?!\*\*(?:Continue|Verified|Verification):\*\*)[^\n]*)*)(?:\n\*\*(?:Verified|Verification):\*\*[ \t]*([^\n]*(?:\n(?!\*\*Continue:\*\*)[^\n]*)*))?\n\*\*Continue:\*\*\s*\n\s*1\.\s*(.+)\n\s*2\.\s*(.+)\n\s*3\.\s*(.+)\s*$/i;

  const sm = raw.match(strictWithVerified);
  if (sm) {
    const doneBlock = (sm[1] || '').trim(); // Done line, possibly with an inlined **Changes:** block
    const verifiedBlock = (sm[2] || '').trim();
    const o1 = (sm[3] || '').trim();
    const o2 = (sm[4] || '').trim();
    const o3 = (sm[5] || '').trim();
    // summary is the Done text only; a **Changes:** block may sit between Done and Verified/Continue.
    const summary = doneBlock.split(/\n\*\*(?:Changes|Summary of Changes):\*\*/i)[0].trim();
    if (summary && o1 && o2 && o3) {
      const body = raw.slice(0, sm.index).replace(/\s+$/, '');
      const verifications = verifiedBlock ? extractItemsFromBlock(verifiedBlock) : extractVerifications(doneBlock);
      const changes = extractChanges(doneBlock);
      return {
        body,
        summary,
        changes: changes.length ? changes : undefined,
        verifications: verifications.length ? verifications : undefined,
        options: [o1, o2, o3],
      };
    }
  }

  // Strict original: --- + **Done:** + **Continue:** + exactly 3 numbered lines at end.
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
      const verifications = extractVerifications(summary);
      const changes = extractChanges(summary);
      return {
        body,
        summary,
        changes: changes.length ? changes : undefined,
        verifications: verifications.length ? verifications : undefined,
        options: [o1, o2, o3],
      };
    }
  }

  // Messy fallback: Done/Changes + Continue with 3+ numbered lines near the end.
  const loose =
    /(?:^|\n)(?:---+\s*\n)?(?:\*\*)?(?:Done|Changes|Summary of Changes):?\*?\*?[ \t]*([^\n]*(?:\n(?!(?:\*\*)?Continue:?\*?\*?)[^\n]*)*)\n(?:\*\*)?Continue:?\*?\*?\s*\n((?:\s*\d+[.)]\s*.+\n?){3,})\s*$/i;

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
  const verifications = extractVerifications(summary);
  const changes = extractChanges(summary);
  return {
    body,
    summary,
    changes: changes.length ? changes : undefined,
    verifications: verifications.length ? verifications : undefined,
    options: [opts[0], opts[1], opts[2]],
  };
}

/** True when content ends with a parseable Done/Continue footer (exactly 3 options). */
export function hasValidCompletionFooter(content: string): boolean {
  return parseCompletionFooter(content) != null;
}
