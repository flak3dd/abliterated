/** Orchestrator-only goal keeper: block fleet complete when evidence drifts from original goal. */

export type GoalKeeperResult = { ok: boolean; reason: string };

/**
 * Token-overlap check between the locked original goal and graph/evidence text.
 * Workers cannot edit original_goal; this gate runs before fleet complete.
 */
export function goalKeeperCheck(o: {
  originalGoal: string;
  graphGoal: string;
  evidenceText: string;
}): GoalKeeperResult {
  const goal = (o.originalGoal || o.graphGoal || '').trim();
  if (!goal) return { ok: false, reason: 'empty original_goal' };

  const evidence = `${o.graphGoal}\n${o.evidenceText}`.toLowerCase();
  const tokens = goal
    .toLowerCase()
    .split(/[^a-z0-9_+.-]+/)
    .filter((t) => t.length >= 4)
    .slice(0, 12);

  if (!tokens.length) return { ok: true, reason: 'goal too short' };

  const hit = tokens.filter((t) => evidence.includes(t));
  const ratio = hit.length / tokens.length;
  if (ratio < 0.25) {
    return { ok: false, reason: `goal keeper fail: ${hit.length}/${tokens.length} tokens grounded` };
  }
  return { ok: true, reason: `goal keeper pass (${hit.length}/${tokens.length})` };
}
