/** Multi-agent roles, prompts, and scheduling helpers (flag-gated MVP). */

import type { AgentRole, TaskGraph, TaskSubtask } from "./taskGraph";
import { readySubtasks } from "./taskGraph";
import { pathClaimedByOther } from "./writeLocks";
import {
  DEFAULT_HEARTBEAT_STALE_MS,
  makeReplanEvent,
  shouldReplanOnBudget,
  shouldReplanOnHeartbeatStall,
  shouldReplanOnVerifyFails,
  type ReplanEvent,
} from "./replanTriggers";

export const MULTI_AGENT_ROLES: AgentRole[] = ["orchestrator", "coder", "tester", "verifier"];

export const DEFAULT_STALE_MS = DEFAULT_HEARTBEAT_STALE_MS;

export function roleSystemAddendum(role: AgentRole, opts: { goal: string; subtask?: TaskSubtask }): string {
  const goal = opts.goal || "(unset)";
  const st = opts.subtask;
  const focus = st
    ? `Assigned subtask ${st.id}: ${st.text}${st.successCriteria ? ` | success: ${st.successCriteria}` : ""}${st.lockPath ? ` | lock: ${st.lockPath}` : ""}`
    : "No single subtask — operate at fleet level.";
  const common =
    `Multi-agent role: ${role}. Fleet goal: ${goal}.\n${focus}\n` +
    "Update .ablit/task.json via task_update (heartbeat with id+heartbeat true when working). " +
    "Append progress via tools; do not spam free-form meta. Unrestricted workspace inside jail — no new refusals.";

  if (role === "orchestrator") {
    return (
      common +
      "\nYou OWN the goal. Decompose into a DAG of subtasks with role coder|tester|verifier and successCriteria. " +
      "Set lockPath on writer subtasks (exact relative paths). Do NOT implement heavy code yourself. Prefer task_update."
    );
  }
  if (role === "coder") {
    return (
      common +
      "\nImplement the assigned subtask with diffs or write_file. Stay in scope and respect lockPath. Heartbeat. " +
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
  // verifier / critic — cold context + mandatory verify tool
  return (
    common +
    "\nMANDATORY COLD-CONTEXT CRITIC: read-only tools + verify. " +
    "You MUST call the verify tool before pass. On failure: critique reject and keep subtask blocked/pending — never mark fleet done. " +
    "On pass: critique pass and allow subtask done. No shared coder thought stream."
  );
}

export function pickNextSubtask(graph: TaskGraph, staleMs = DEFAULT_STALE_MS): TaskSubtask | null {
  const now = Date.now();
  // Reclaim stale in_progress (heartbeat)
  const stale = graph.subtasks.find(
    (s) =>
      s.status === "in_progress" &&
      shouldReplanOnHeartbeatStall(s.lastBeatAt, now, staleMs) &&
      s.role !== "orchestrator",
  );
  if (stale) return { ...stale, status: "pending" };

  const ready = readySubtasks(graph).filter((s) => {
    if (s.role === "orchestrator") return false;
    if (s.lockPath && pathClaimedByOther(graph.subtasks, s.lockPath, s.id)) return false;
    return true;
  });
  const order = ["coder", "researcher", "tester", "verifier"];
  ready.sort((a, b) => order.indexOf(a.role || "coder") - order.indexOf(b.role || "coder"));
  return ready[0] || null;
}

export function fleetComplete(graph: TaskGraph): boolean {
  if (!graph.subtasks.length) return false;
  return graph.subtasks.every((s) => s.status === "done");
}

/** Detect replan triggers for a subtask / fleet. */
export function detectReplanTriggers(
  graph: TaskGraph,
  opts?: { staleMs?: number; now?: number },
): ReplanEvent[] {
  const now = opts?.now ?? Date.now();
  const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS;
  const events: ReplanEvent[] = [];
  for (const s of graph.subtasks) {
    if (s.status === "in_progress" && shouldReplanOnHeartbeatStall(s.lastBeatAt, now, staleMs)) {
      events.push(makeReplanEvent("heartbeat_stall", { nodeId: s.id, detail: "no heartbeat" }));
    }
    if (shouldReplanOnVerifyFails(s.verifyFails || 0)) {
      events.push(
        makeReplanEvent("verify_fail_twice", {
          nodeId: s.id,
          detail: `verifyFails=${s.verifyFails}`,
        }),
      );
    }
    const max = s.maxSteps;
    const used = s.consumedSteps || 0;
    if (max != null && shouldReplanOnBudget(used > max)) {
      events.push(
        makeReplanEvent("budget_exceeded", { nodeId: s.id, detail: `steps ${used}/${max}` }),
      );
    }
    if (s.lockPath && s.status === "pending" && pathClaimedByOther(graph.subtasks, s.lockPath, s.id)) {
      events.push(
        makeReplanEvent("path_lock_conflict", {
          nodeId: s.id,
          detail: `lockPath ${s.lockPath} held`,
        }),
      );
    }
  }
  return events;
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
        maxSteps: 10,
      },
      {
        id: "implement",
        text: "Coder: implement required changes for the goal",
        status: "pending",
        role: "coder",
        blockers: ["plan"],
        successCriteria: "diffs or write_file landed for the goal",
        maxSteps: 16,
      },
      {
        id: "test",
        text: "Tester: run scoped verify/tests for the change",
        status: "pending",
        role: "tester",
        blockers: ["implement"],
        successCriteria: "verify/shell tests exit 0 or clear evidence",
        maxSteps: 8,
      },
      {
        id: "critique",
        text: "Verifier: cold-context critic — must call verify before pass",
        status: "pending",
        role: "verifier",
        blockers: ["test"],
        successCriteria: "verify tool called; pass or explicit reject",
        maxSteps: 8,
      },
    ],
  };
}
