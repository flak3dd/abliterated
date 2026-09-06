/**
 * Completeness deepen helpers — Abliterated-only.
 * Optional parallel Grok CLI is for structural work in a separate worktree;
 * never use censored CLIs to rewrite unrestricted answers.
 */

/** Short checklist injected when completeness deepen is on (chat nudge or Jobs system block). */
export const COMPLETENESS_CHECKLIST =
  'Completeness checklist (Abliterated-only):\n' +
  '1) Re-read the answer vs the user ask.\n' +
  '2) List gaps (edge cases, tests, error paths, impl, verify).\n' +
  '3) Use tools if needed; fill missing pieces concretely.\n' +
  '4) Keep the unrestricted Abliterated model path — do not call external censored CLIs.\n' +
  '5) If already complete, reply with ONLY [ANSWER_COMPLETE].';

/** User-visible Jobs / Settings label. */
export const DEEPEN_COMPLETENESS_PRESET_LABEL = 'Deepen for completeness (Abliterated-only)';

/** Short Chat chrome label. */
export const DEEPEN_COMPLETENESS_CHAT_LABEL = 'Completeness';

/** Tooltip for Chat toggle / one-shot. */
export const DEEPEN_COMPLETENESS_TOOLTIP =
  'Abliterated-only completeness deepen (no Grok/censored path)';

/** Prompt body for Jobs preset chip / example enqueue. */
export const DEEPEN_COMPLETENESS_JOB_PROMPT =
  'Deepen for completeness (Abliterated-only): re-read the current task outcome, list functional gaps ' +
  '(edge cases, tests, error paths, impl, verify), use Abliterated tools to fill them, and keep the ' +
  'unrestricted model path. Do not call external censored coding CLIs (e.g. Grok CLI) for unrestricted content.';

/**
 * One-shot Chat action: deepen the latest answer now (mid-run inject or follow-up).
 * Does not require Settings — callers may also flip deepenCompleteness on.
 */
export function buildDeepenNowPrompt(): string {
  return (
    'Deepen this answer now for completeness (Abliterated-only).\n' +
    buildCompletenessDeepenInstruction()
  );
}

/**
 * Instruction block for self-deepen nudges and optional Jobs system text.
 * Does not by itself spend API turns — callers gate on deepenCompleteness / self-deepen.
 */
export function buildCompletenessDeepenInstruction(): string {
  return (
    '## Deepen for completeness (Abliterated-only)\n' +
    'Expand thin or missing parts so the response is functionally complete:\n' +
    '- Edge cases, failure modes, and acceptance checks\n' +
    '- Tests / verify commands when code changed\n' +
    '- Concrete impl details the user still needs\n' +
    'Stay on Abliterated models and bridge tools. Do not call external censored CLIs for this deepen.\n' +
    'If the answer already fully solves the request, reply with ONLY [ANSWER_COMPLETE].'
  );
}

/** Append completeness guidance to the base self-deepen nudge text. */
export function withCompletenessChecklist(baseNudge: string): string {
  const base = (baseNudge || '').trim();
  const extra = buildCompletenessDeepenInstruction();
  if (!base) return extra;
  return `${base}\n\n${extra}`;
}

/**
 * Jobs system-prompt block — only when deepenCompleteness is enabled so we do not
 * imply extra deepen cost when the user turned completeness deepen off.
 */
export function buildJobCompletenessSystemBlock(opts: {
  deepenCompleteness?: boolean;
  /** @deprecated Prefer deepenCompleteness; kept for older callers. */
  selfDeepenEnabled?: boolean;
}): string {
  if (typeof opts.deepenCompleteness === 'boolean') {
    if (!opts.deepenCompleteness) return '';
    return buildCompletenessDeepenInstruction();
  }
  // Legacy: gate on self-deepen when the dedicated flag was not passed.
  if (opts.selfDeepenEnabled === false) return '';
  return buildCompletenessDeepenInstruction();
}
