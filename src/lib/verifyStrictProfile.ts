import type { ClientSettings } from '../types';

/** Settings preset: Build + skills + completeness + verify-before-done posture. */
export const VERIFY_STRICT_PROFILE_LABEL = 'Verify-strict quality loop';

export const VERIFY_STRICT_PROFILE_JOB_PROMPT =
  'Implement the requested change with the verify-strict quality loop: ' +
  'lock acceptance criteria, decompose, explore, implement, then run verify/tests until green. ' +
  'Do not declare done without verification evidence.';

/** Patch applied when the operator picks the verify-strict preset. */
export function applyVerifyStrictProfile(settings: ClientSettings): ClientSettings {
  return {
    ...settings,
    buildModeEnabled: true,
    skillsEnabled: true,
    deepenCompleteness: true,
    selfDeepenEnabled: true,
    planModeEnabled: false,
    // Prefer honest incomplete-on-cap; leave concurrency alone
  };
}

export function describeVerifyStrictProfile(): string {
  return (
    'Turns on Build mode, skills (verify-strict auto-inject on Build/large), ' +
    'and deepen-for-completeness. Use with Jobs or Chat for ship-quality loops.'
  );
}
