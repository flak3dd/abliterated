/** Persistent task graph under .ablit/task.json — shared blackboard foundation. */

export const TASK_GRAPH_PATH = ".ablit/task.json";

export type TaskSubStatus = "pending" | "in_progress" | "done" | "blocked";
export type AgentRole = "orchestrator" | "coder" | "researcher" | "tester" | "verifier";

export type TaskCritique = {
  at: number;
  role: AgentRole | string;
  verdict: "pass" | "reject";
  note: string;
};

export type TaskSubtask = {
  id: string;
  text: string;
  status: TaskSubStatus;
  blockers?: string[];
  /** Worker role assignment (multi-agent). */
  role?: AgentRole;
  assignee?: string;
  successCriteria?: string;
  lastBeatAt?: number;
  artifacts?: string[];
  critiques?: TaskCritique[];
  /** Optional single-writer hint (relative path). */
  lockPath?: string;
};

export type TaskGraph = {
  version: 1;
  goal: string;
  subtasks: TaskSubtask[];
  updatedAt: number;
  /** Fleet / session id when multi-agent. */
  fleetId?: string;
};

const MAX_PROMPT_CHARS = 4_000;

export function emptyTaskGraph(goal = ""): TaskGraph {
  return { version: 1, goal: goal.trim(), subtasks: [], updatedAt: Date.now() };
}

function asRole(v: unknown): AgentRole | undefined {
  const s = String(v || "");
  if (s === "orchestrator" || s === "coder" || s === "researcher" || s === "tester" || s === "verifier") return s;
  return undefined;
}

export function parseTaskGraph(raw: string): TaskGraph | null {
  try {
    const data = JSON.parse(raw) as Partial<TaskGraph>;
    if (!data || typeof data !== "object") return null;
    const goal = typeof data.goal === "string" ? data.goal : "";
    const subtasks: TaskSubtask[] = [];
    if (Array.isArray(data.subtasks)) {
      for (const s of data.subtasks) {
        if (!s || typeof s !== "object") continue;
        const text = typeof (s as TaskSubtask).text === "string" ? (s as TaskSubtask).text.trim() : "";
        if (!text) continue;
        const id =
          typeof (s as TaskSubtask).id === "string" && (s as TaskSubtask).id.trim()
            ? (s as TaskSubtask).id.trim()
            : `t${subtasks.length + 1}`;
        const st = (s as TaskSubtask).status;
        const status: TaskSubStatus =
          st === "done" || st === "in_progress" || st === "blocked" || st === "pending" ? st : "pending";
        const blockers = Array.isArray((s as TaskSubtask).blockers)
          ? (s as TaskSubtask).blockers!.filter((x): x is string => typeof x === "string")
          : undefined;
        const critiques = Array.isArray((s as TaskSubtask).critiques)
          ? ((s as TaskSubtask).critiques || []).filter(Boolean)
          : undefined;
        const artifacts = Array.isArray((s as TaskSubtask).artifacts)
          ? (s as TaskSubtask).artifacts!.filter((x): x is string => typeof x === "string")
          : undefined;
        subtasks.push({
          id,
          text,
          status,
          blockers,
          role: asRole((s as TaskSubtask).role),
          assignee: typeof (s as TaskSubtask).assignee === "string" ? (s as TaskSubtask).assignee : undefined,
          successCriteria:
            typeof (s as TaskSubtask).successCriteria === "string"
              ? (s as TaskSubtask).successCriteria
              : undefined,
          lastBeatAt: typeof (s as TaskSubtask).lastBeatAt === "number" ? (s as TaskSubtask).lastBeatAt : undefined,
          artifacts,
          critiques,
          lockPath: typeof (s as TaskSubtask).lockPath === "string" ? (s as TaskSubtask).lockPath : undefined,
        });
      }
    }
    return {
      version: 1,
      goal,
      subtasks,
      updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
      fleetId: typeof data.fleetId === "string" ? data.fleetId : undefined,
    };
  } catch {
    return null;
  }
}

export function stringifyTaskGraph(graph: TaskGraph): string {
  return `${JSON.stringify({ ...graph, version: 1, updatedAt: Date.now() }, null, 2)}\n`;
}

function slugId(text: string, i: number): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return base || `t${i + 1}`;
}

/** Apply task_update tool args onto an existing graph. */
export function applyTaskUpdateArgs(graph: TaskGraph, args: Record<string, unknown>): TaskGraph {
  const next: TaskGraph = {
    version: 1,
    goal: graph.goal,
    subtasks: graph.subtasks.map((s) => ({
      ...s,
      blockers: s.blockers ? [...s.blockers] : undefined,
      artifacts: s.artifacts ? [...s.artifacts] : undefined,
      critiques: s.critiques ? [...s.critiques] : undefined,
    })),
    updatedAt: Date.now(),
    fleetId: graph.fleetId,
  };
  if (typeof args.goal === "string" && args.goal.trim()) next.goal = args.goal.trim();
  if (typeof args.fleetId === "string" && args.fleetId.trim()) next.fleetId = args.fleetId.trim();

  const merge = args.merge === true || args.merge === "true";
  const rawItems = args.subtasks ?? args.items ?? args.tasks;
  if (Array.isArray(rawItems)) {
    const incoming: TaskSubtask[] = [];
    rawItems.forEach((item, i) => {
      if (typeof item === "string") {
        const text = item.trim();
        if (text) incoming.push({ id: slugId(text, i), text, status: "pending", role: "coder" });
        return;
      }
      if (!item || typeof item !== "object") return;
      const o = item as Record<string, unknown>;
      const text = String(o.text ?? o.content ?? o.title ?? "").trim();
      if (!text) return;
      const id = String(o.id ?? slugId(text, i)).trim() || slugId(text, i);
      const st = String(o.status ?? "").toLowerCase();
      let status: TaskSubStatus = "pending";
      if (st === "done" || st === "completed" || o.done === true) status = "done";
      else if (st === "in_progress" || st === "active") status = "in_progress";
      else if (st === "blocked") status = "blocked";
      const blockers = Array.isArray(o.blockers)
        ? o.blockers.filter((x): x is string => typeof x === "string")
        : undefined;
      incoming.push({
        id,
        text,
        status,
        blockers,
        role: asRole(o.role) || "coder",
        assignee: typeof o.assignee === "string" ? o.assignee : undefined,
        successCriteria: typeof o.successCriteria === "string" ? o.successCriteria : undefined,
        lockPath: typeof o.lockPath === "string" ? o.lockPath : undefined,
        lastBeatAt: typeof o.lastBeatAt === "number" ? o.lastBeatAt : undefined,
      });
    });
    if (!merge) {
      next.subtasks = incoming;
    } else {
      const byId = new Map(next.subtasks.map((s) => [s.id, s]));
      const byText = new Map(next.subtasks.map((s) => [s.text.toLowerCase(), s]));
      for (const inc of incoming) {
        const hit = byId.get(inc.id) || byText.get(inc.text.toLowerCase());
        if (hit) {
          Object.assign(hit, { ...inc, blockers: inc.blockers ?? hit.blockers });
        } else {
          next.subtasks.push(inc);
          byId.set(inc.id, inc);
          byText.set(inc.text.toLowerCase(), inc);
        }
      }
    }
  }

  const markId = typeof args.id === "string" ? args.id.trim() : "";
  const markStatus = typeof args.status === "string" ? args.status.toLowerCase() : "";
  if (markId && markStatus) {
    const hit = next.subtasks.find((s) => s.id === markId);
    if (hit) {
      if (markStatus === "done" || markStatus === "completed") hit.status = "done";
      else if (markStatus === "in_progress" || markStatus === "active") hit.status = "in_progress";
      else if (markStatus === "blocked") hit.status = "blocked";
      else if (markStatus === "pending") hit.status = "pending";
    }
  }
  if (markId && typeof args.heartbeat === "boolean" && args.heartbeat) {
    const hit = next.subtasks.find((s) => s.id === markId);
    if (hit) hit.lastBeatAt = Date.now();
  }
  return next;
}

export function readySubtasks(graph: TaskGraph): TaskSubtask[] {
  const done = new Set(graph.subtasks.filter((s) => s.status === "done").map((s) => s.id));
  return graph.subtasks.filter((s) => {
    if (s.status === "done" || s.status === "in_progress") return false;
    if (s.status === "blocked") return false;
    const blockers = s.blockers || [];
    return blockers.every((b) => done.has(b));
  });
}

export function touchHeartbeat(graph: TaskGraph, subtaskId: string): TaskGraph {
  return {
    ...graph,
    updatedAt: Date.now(),
    subtasks: graph.subtasks.map((s) =>
      s.id === subtaskId ? { ...s, lastBeatAt: Date.now(), status: s.status === "pending" ? "in_progress" : s.status } : s,
    ),
  };
}

export function formatTaskGraphPrompt(graph: TaskGraph | null | undefined): string {
  if (!graph) return "";
  if (!graph.goal.trim() && graph.subtasks.length === 0) return "";
  const lines: string[] = [
    "## Persistent task graph (.ablit/task.json)",
    "Shared blackboard for long runs / multi-agent. Prefer task_update. todo = turn checklist; this graph keeps the goal.",
  ];
  if (graph.fleetId) lines.push(`Fleet: ${graph.fleetId}`);
  if (graph.goal.trim()) lines.push(`**Goal:** ${graph.goal.trim()}`);
  if (graph.subtasks.length) {
    lines.push("Subtasks:");
    for (const s of graph.subtasks.slice(0, 40)) {
      const mark =
        s.status === "done" ? "x" : s.status === "in_progress" ? "~" : s.status === "blocked" ? "!" : " ";
      const role = s.role ? ` @${s.role}` : "";
      const blockers = s.blockers?.length ? ` [blocked by: ${s.blockers.join(", ")}]` : "";
      const crit = s.successCriteria ? ` | success: ${s.successCriteria}` : "";
      lines.push(`- [${mark}] ${s.id}${role}: ${s.text}${blockers}${crit}`);
    }
  } else {
    lines.push("No subtasks yet — call task_update with goal + subtasks when the work is multi-step.");
  }
  let out = lines.join("\n");
  if (out.length > MAX_PROMPT_CHARS) out = `${out.slice(0, MAX_PROMPT_CHARS)}\n/* truncated */`;
  return out;
}
