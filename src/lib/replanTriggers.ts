/**
 * First-class replan triggers for hierarchical / multi-agent fleets.
 * See docs/HIERARCHICAL-ORCHESTRATOR.md — Re-plan triggers.
 */

export type ReplanReason =
  | 'verify_fail_twice'
  | 'budget_exceeded'
  | 'heartbeat_stall'
  | 'human_inject'
  | 'critic_inconsistency'
  | 'path_lock_conflict';

export type ReplanEvent = {
  at: number;
  reason: ReplanReason;
  nodeId?: string;
  detail?: string;
};

export const DEFAULT_HEARTBEAT_STALE_MS = 90_000;
export const DEFAULT_VERIFY_FAIL_REPLANS = 2;

export function shouldReplanOnVerifyFails(failCount: number, threshold = DEFAULT_VERIFY_FAIL_REPLANS): boolean {
  return failCount >= threshold;
}

export function shouldReplanOnBudget(exceeded: boolean): boolean {
  return exceeded === true;
}

export function shouldReplanOnHeartbeatStall(
  lastBeatAt: number | undefined,
  now = Date.now(),
  staleMs = DEFAULT_HEARTBEAT_STALE_MS,
): boolean {
  if (!lastBeatAt) return true; // in_progress with no beat → stall
  return now - lastBeatAt > staleMs;
}

export function makeReplanEvent(
  reason: ReplanReason,
  opts?: { nodeId?: string; detail?: string },
): ReplanEvent {
  return {
    at: Date.now(),
    reason,
    nodeId: opts?.nodeId,
    detail: opts?.detail,
  };
}

export function formatReplanPrompt(ev: ReplanEvent): string {
  return (
    `REPLAN TRIGGER (${ev.reason}` +
    (ev.nodeId ? ` @ ${ev.nodeId}` : '') +
    `): ${ev.detail || 're-decompose or reassign; keep verified siblings.'}\n` +
    'Update the task graph: split/reassign the failed node, preserve completed work, refresh successCriteria.'
  );
}
