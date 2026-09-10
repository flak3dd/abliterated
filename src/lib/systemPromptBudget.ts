export type SystemBlock = {
  text: string;
  /** Steering directives that must survive any budget pressure. */
  essential?: boolean;
};

/** Char cap for the assembled system prompt on small-context (compactPrompt) models. */
export const COMPACT_SYSTEM_MAX_CHARS = 8_000;

/**
 * Join system blocks in caller-declared priority order, dropping optional ones
 * that do not fit `maxChars`.
 *
 * Order matters downstream: fitChatPayload clips an oversized system message
 * from the tail, so callers pass steering directives first and bulk context
 * (memory, skills catalog, task graph) last.
 */
export function assembleSystemPrompt(blocks: SystemBlock[], opts?: { maxChars?: number }): string {
  const kept: string[] = [];
  const max = opts?.maxChars;
  let used = 0;
  const SEP = 2;

  const present = blocks.filter((b) => b.text && b.text.trim());
  if (max == null) return present.map((b) => b.text.trim()).join('\n\n');

  const essentialChars = present
    .filter((b) => b.essential)
    .reduce((sum, b) => sum + b.text.trim().length + SEP, 0);
  used = essentialChars;

  for (const block of present) {
    const text = block.text.trim();
    if (block.essential) {
      kept.push(text);
      continue;
    }
    if (used + text.length + SEP > max) continue;
    used += text.length + SEP;
    kept.push(text);
  }
  return kept.join('\n\n');
}
