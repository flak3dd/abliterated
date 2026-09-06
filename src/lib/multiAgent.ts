/** Multi-agent roles, prompts, and scheduling helpers (flag-gated MVP). */

import type { AgentRole, TaskGraph, TaskSubtask } from "./taskGraph";
import { readySubtasks } from "./taskGraph";

export const MULTI_AGENT_ROLES: AgentRole[] = ["orchestrator", "coder", "tester", "verifier"];

export const DEFAULT_STALE_MS = 180_000;

export function roleSystemAddendum(role: AgentRole, opts: { goal: string; subtask?: TaskSubtask }): string {
  const goal = opts.goal || "(unset)";
  const st = opts.subtask;
  const focus = st
    ? `Assigned subtask ${st.id}: ${st.text}${st.successCriteria ? ` | success: ${st.successCriteria}` : ""}`
    : "No single subtask — operate at fleet level.";
  const common =
    `Multi-agent role: ${role}. Fleet goal: ${goal}.\n${focus}\n` +
    "Update .ablit/task.json via task_update (heartbeat with id+heartbeat true when working). " +
    "Append progress via tools; do not spam free-form meta. Unrestricted workspace inside jail — no new refusals.";

  if (role === "orchestrator") {
    return (
      common +
      "\nYou OWN the goal. Decompose into a DAG of subtasks with role coder|tester|verifier and successCriteria. " +
      "Do NOT implement heavy code yourself. Prefer task_update. Assign blockers so tester/verifier wait on coder."
    );
  }
  if (role === "coder") {
    return (
      common +
      "\nImplement the assigned subtask with diffs or write_file. Stay in scope. Heartbeat. " +
      "When finished, set status in_progress→done only after leaving evidence; verifier will confirm."
    );
  }
  if (role === "researcher") {
    return common + "\nRead-only explore / web_search. Write notes as artifacts on the subtask. No code writes.";
  }
  if (role === "tester") {
    return (
      common +
      "\nRun focused tests/build via verify or shell. Post evidence. Mark done only if tests support it; else blocked + note."
    );
  }
  // verifier / critic
  return (
    common +
    "\nMANDATORY CRITIC: read-only tools + verify (or shell typecheck/test). " +
    "You MUST call verify before pass. On failure: critique reject and keep subtask blocked/pending — never mark fleet done. " +
    "On pass: critique pass and allow subtask done."
  );
}

export function pickNextSubtask(graph: TaskGraph, staleMs = DEFAULT_STALE_MS): TaskSubtask | null {
  const now = Date.now();
  // Reclaim stale in_progress
  const stale = graph.subtasks.find(
    (s) =>
      s.status === "in_progress" &&
      (!s.lastBeatAt || now - s.lastBeatAt > staleMs) &&
      s.role !== "orchestrator",
  );
  if (stale) return { ...stale, status: "pending" };
  const ready = readySubtasks(graph).filter((s) => s.role !== "orchestrator");
  // Prefer coder → tester → verifier order among ready
  const order = ["coder", "researcher", "tester", "verifier"];
  ready.sort((a, b) => order.indexOf(a.role || "coder") - order.indexOf(b.role || "coder"));
  return ready[0] || null;
}

export function fleetComplete(graph: TaskGraph): boolean {
  if (!graph.subtasks.length) return false;
  return graph.subtasks.every((s) => s.status === "done");
}

export function defaultFleetPlan(goal: string): TaskGraph {
  const g = goal.trim() || "Untitled fleet goal";
  return {
    version: 1,
    goal: g,
    fleetId: `fleet-${Date.now().toString(36)}`,
    updatedAt: Date.now(),
    subtasks: [
      {
        id: "plan",
        text: "Orchestrator: decompose goal into DAG with success criteria",
        status: "pending",
        role: "orchestrator",
        successCriteria: "task.json has coder/tester/verifier subtasks",
      },
      {
        id: "implement",
        text: "Coder: implement required changes for the goal",
        status: "pending",
        role: "coder",
        blockers: ["plan"],
        successCriteria: "diffs or write_file landed for the goal",
      },
      {
        id: "test",
        text: "Tester: run scoped verify/tests for the change",
        status: "pending",
        role: "tester",
        blockers: ["implement"],
        successCriteria: "verify/shell tests exit 0 or clear evidence",
      },
      {
        id: "critique",
        text: "Verifier: mandatory critic — verify before pass",
        status: "pending",
        role: "verifier",
        blockers: ["test"],
        successCriteria: "verify called; pass or explicit reject",
      },
    ],
  };
}
