/** Persistent task graph under .ablit/task.json — flat blackboard + hierarchical Task Graph v1. */

import {
  parseTaskGraph as parseHierarchicalTaskGraph,
  safeParseTaskGraph as safeParseHierarchicalTaskGraph,
  createTaskGraph,
  addNode,
  assignNode,
  startNode,
  addArtifact,
  verifyNode,
  refreshGraphStatus,
  consumeBudget,
  readyNodes,
  nodeCanStart,
  detectCycle,
  isVerifiedComplete,
  isGraphId,
  nowIso,
  newGraphId,
  newNodeId,
  TASK_GRAPH_VERSION,
  GRAPH_STATUSES,
  NODE_STATUSES,
  ARTIFACT_TYPES,
  VERIFICATION_STATUSES,
  VERIFICATION_METHODS,
  HISTORY_ACTIONS,
} from "./hierarchicalTaskGraph";
import type {
  TaskGraph as HierarchicalTaskGraph,
  TaskNode as HierarchicalTaskNode,
  AgentRole as HierarchicalAgentRole,
  GraphStatus,
  NodeStatus,
  ArtifactType,
  VerificationStatus,
  VerificationMethod,
  HistoryAction,
  Artifact,
  Verification,
  Blocker,
  Budget,
  Consumed,
  HistoryEntry,
  TaskNode,
  ParseResult,
} from "./hierarchicalTaskGraph";

export {
  parseHierarchicalTaskGraph,
  safeParseHierarchicalTaskGraph,
  createTaskGraph,
  addNode,
  assignNode,
  startNode,
  addArtifact,
  verifyNode,
  refreshGraphStatus,
  consumeBudget,
  readyNodes,
  nodeCanStart,
  detectCycle,
  isVerifiedComplete,
  isGraphId,
  nowIso,
  newGraphId,
  newNodeId,
  TASK_GRAPH_VERSION,
  GRAPH_STATUSES,
  NODE_STATUSES,
  ARTIFACT_TYPES,
  VERIFICATION_STATUSES,
  VERIFICATION_METHODS,
  HISTORY_ACTIONS,
};
export type {
  HierarchicalTaskGraph,
  HierarchicalTaskNode,
  HierarchicalAgentRole,
  GraphStatus,
  NodeStatus,
  ArtifactType,
  VerificationStatus,
  VerificationMethod,
  HistoryAction,
  Artifact,
  Verification,
  Blocker,
  Budget,
  Consumed,
  HistoryEntry,
  TaskNode,
  ParseResult,
};

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
  /** Count of failed verify/critique attempts (replan at 2). */
  verifyFails?: number;
  /** Optional step budget for this subtask. */
  maxSteps?: number;
  consumedSteps?: number;
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


function mapHierarchicalRole(hint: unknown): AgentRole | undefined {
  const s = String(hint || "");
  if (s === "orchestrator" || s === "coder" || s === "researcher" || s === "tester" || s === "verifier") return s;
  if (s === "critic") return "verifier";
  if (s === "integrator") return "coder";
  return undefined;
}

function hierarchicalNodeToSubStatus(st: string): TaskSubStatus {
  if (st === "completed") return "done";
  if (st === "blocked" || st === "failed") return "blocked";
  if (
    st === "in_progress" ||
    st === "assigned" ||
    st === "ready" ||
    st === "verification_pending"
  ) {
    return "in_progress";
  }
  return "pending";
}

/** Project hierarchical Task Graph v1 onto the flat blackboard shape used by tools / multi-agent. */
export function hierarchicalToFlat(h: HierarchicalTaskGraph): TaskGraph {
  const subtasks: TaskSubtask[] = (h.nodes || []).map((n: HierarchicalTaskNode) => {
    const artifacts = (n.artifacts || [])
      .map((a) => (String(a.path || a.summary || "").trim()))
      .filter(Boolean);
    let lastBeatAt: number | undefined;
    if (n.started_at) {
      const t = Date.parse(n.started_at);
      if (Number.isFinite(t)) lastBeatAt = t;
    }
    const openBlockers = (n.blockers || []).filter((b) => !b.resolved);
    let status = hierarchicalNodeToSubStatus(n.status);
    if (openBlockers.length && status !== "done") status = "blocked";
    return {
      id: n.id,
      text: n.description,
      status,
      blockers: n.depends_on?.length ? [...n.depends_on] : undefined,
      role: mapHierarchicalRole(n.role_hint),
      assignee: n.assignee || undefined,
      lastBeatAt,
      artifacts: artifacts.length ? artifacts : undefined,
      lockPath: typeof n.metadata?.lockPath === "string" ? (n.metadata.lockPath as string) : undefined,
    };
  });
  const meta = h.metadata || {};
  const fleetId = typeof meta.fleetId === "string" ? meta.fleetId : undefined;
  const updatedAt =
    (h.updated_at && Date.parse(h.updated_at)) ||
    (h.created_at && Date.parse(h.created_at)) ||
    Date.now();
  return {
    version: 1,
    goal: h.original_goal || "",
    subtasks,
    updatedAt: Number.isFinite(updatedAt as number) ? (updatedAt as number) : Date.now(),
    fleetId,
  };
}

function parseHierarchicalTaskGraphRaw(data: Record<string, unknown>): HierarchicalTaskGraph | null {
  const result = safeParseHierarchicalTaskGraph(data);
  return result.ok ? result.data : null;
}

export function parseTaskGraph(raw: string): TaskGraph | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== "object") return null;

    // Hierarchical Task Graph v1 → flat blackboard projection for tools / fleets
    if (Array.isArray(data.nodes) && typeof data.original_goal === "string") {
      const parsed = parseHierarchicalTaskGraphRaw(data);
      if (parsed) return hierarchicalToFlat(parsed);
    }

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
  const locked = new Set(
    graph.subtasks
      .filter((s) => s.status === "in_progress" && s.lockPath)
      .map((s) => (s.lockPath || "").replace(/\\/g, "/").replace(/^\.\//, "")),
  );
  return graph.subtasks.filter((s) => {
    if (s.status === "done" || s.status === "in_progress") return false;
    if (s.status === "blocked") return false;
    const blockers = s.blockers || [];
    if (!blockers.every((b) => done.has(b))) return false;
    if (s.lockPath) {
      const key = s.lockPath.replace(/\\/g, "/").replace(/^\.\//, "");
      if (key && locked.has(key)) return false;
    }
    return true;
  });
}

/** Whether task-graph injection should run (skip trivial one-shots). */
export function shouldUseTaskGraph(opts: {
  largeJob?: boolean;
  buildProcess?: boolean;
  multiAgent?: boolean;
  hasExistingGraph?: boolean;
  verifyStrictProfile?: boolean;
}): boolean {
  if (opts.hasExistingGraph) return true;
  if (opts.multiAgent) return true;
  if (opts.largeJob || opts.buildProcess) return true;
  return false;
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
    "Shared blackboard for long runs / multi-agent. Prefer task_update. todo = turn checklist; this graph keeps the goal. Hierarchical graphs (nodes/original_goal) are projected here.",
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
export function stringifyHierarchicalTaskGraph(graph: HierarchicalTaskGraph): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

export function rawIsHierarchical(raw: string): boolean {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return !!data && typeof data === "object" && Array.isArray(data.nodes) && typeof data.original_goal === "string";
  } catch {
    return false;
  }
}

export function parseHierarchicalFile(raw: string): HierarchicalTaskGraph | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== "object") return null;
    if (!Array.isArray(data.nodes) || typeof data.original_goal !== "string") return null;
    return parseHierarchicalTaskGraphRaw(data);
  } catch {
    return null;
  }
}

export function flatToHierarchical(flat: TaskGraph): HierarchicalTaskGraph {
  const criteria = flat.subtasks
    .map((s) => s.successCriteria)
    .filter((x): x is string => !!x && !!x.trim());
  const success_criteria = criteria.length
    ? [...new Set(criteria)]
    : flat.goal.trim()
      ? [flat.goal.trim()]
      : ["Goal completed"];
  let h = createTaskGraph({
    goal: flat.goal.trim() || "Untitled goal",
    success_criteria,
  });
  if (flat.fleetId) {
    h = { ...h, metadata: { ...(h.metadata || {}), fleetId: flat.fleetId } };
  }
  const idMap = new Map<string, string>();
  for (const s of flat.subtasks) {
    const deps = (s.blockers || []).map((b) => idMap.get(b) || b).filter(Boolean);
    const added = addNode(h, {
      description: s.text,
      depends_on: deps,
      role_hint: s.role,
      detailed_instructions: s.successCriteria,
      tags: s.lockPath ? ["lock:" + s.lockPath] : [],
    });
    h = added.graph;
    const want = s.id.trim();
    if (want && want !== added.node.id && !h.nodes.some((n) => n.id === want)) {
      const oldId = added.node.id;
      h = {
        ...h,
        nodes: h.nodes.map((n) => {
          if (n.id === oldId) return { ...n, id: want };
          return {
            ...n,
            depends_on: n.depends_on.map((d) => (d === oldId ? want : d)),
            children: n.children.map((c) => (c === oldId ? want : c)),
            parent: n.parent === oldId ? want : n.parent,
          };
        }),
      };
      idMap.set(s.id, want);
    } else {
      idMap.set(s.id, added.node.id);
    }
  }
  for (const s of flat.subtasks) {
    const nid = idMap.get(s.id);
    if (!nid) continue;
    if (s.assignee) {
      h = {
        ...h,
        nodes: h.nodes.map((n) =>
          n.id === nid
            ? { ...n, assignee: s.assignee!, status: n.status === "pending" ? "assigned" : n.status }
            : n,
        ),
      };
    }
    if (s.status === "in_progress") {
      const at = nowIso();
      h = {
        ...h,
        nodes: h.nodes.map((n) =>
          n.id === nid ? { ...n, status: "in_progress", started_at: n.started_at || at } : n,
        ),
        status: "running",
      };
    } else if (s.status === "blocked") {
      h = {
        ...h,
        nodes: h.nodes.map((n) =>
          n.id === nid
            ? {
                ...n,
                status: "blocked",
                blockers: n.blockers.length
                  ? n.blockers
                  : [
                      {
                        reason: "marked blocked",
                        reported_by: s.assignee || "orchestrator",
                        reported_at: nowIso(),
                        resolved: false,
                      },
                    ],
              }
            : n,
        ),
      };
    } else if (s.status === "done") {
      try {
        h = verifyNode(h, nid, {
          status: "pass",
          method: "orchestrator",
          by: s.assignee || "orchestrator",
          notes: "migrated from flat done",
        });
      } catch {
        h = {
          ...h,
          nodes: h.nodes.map((n) =>
            n.id === nid
              ? {
                  ...n,
                  status: "completed",
                  completed_at: nowIso(),
                  verification: {
                    status: "pass",
                    method: "orchestrator",
                    by: s.assignee || "orchestrator",
                    at: nowIso(),
                    notes: "migrated from flat done",
                  },
                }
              : n,
          ),
        };
      }
    }
    if (s.artifacts?.length) {
      for (const a of s.artifacts) {
        try {
          h = addArtifact(h, nid, {
            type: "other",
            summary: a,
            path: a.includes("/") ? a : undefined,
            produced_by: s.assignee || "orchestrator",
          });
        } catch {
          /* ignore */
        }
      }
    }
  }
  const checked = safeParseHierarchicalTaskGraph(h);
  return checked.ok ? checked.data : h;
}

export function wantsHierarchicalWrite(args: Record<string, unknown>, existingRaw?: string | null): boolean {
  const fmt = String(args.format || args.schema || "").toLowerCase();
  if (fmt === "flat" || fmt === "blackboard") return false;
  if (fmt === "hierarchical" || fmt === "v1" || fmt === "nodes") return true;
  if (typeof args.action === "string" && args.action.trim()) return true;
  if (typeof args.original_goal === "string" && args.original_goal.trim()) return true;
  if (Array.isArray(args.success_criteria)) return true;
  if (Array.isArray(args.nodes)) return true;
  if (args.verification && typeof args.verification === "object") return true;
  if (args.artifact && typeof args.artifact === "object") return true;
  if (existingRaw && rawIsHierarchical(existingRaw)) return true;
  if (typeof args.goal === "string" && args.goal.trim()) return true;
  if (Array.isArray(args.subtasks) || Array.isArray(args.items) || Array.isArray(args.tasks)) return true;
  return false;
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean);
}

export function applyHierarchicalTaskUpdateArgs(
  graph: HierarchicalTaskGraph | null,
  args: Record<string, unknown>,
): HierarchicalTaskGraph {
  const action = String(args.action || "").toLowerCase().trim();
  const goal =
    (typeof args.original_goal === "string" && args.original_goal.trim()) ||
    (typeof args.goal === "string" && args.goal.trim()) ||
    "";
  const criteria = asStringList(args.success_criteria);
  let h: HierarchicalTaskGraph | null = graph;

  if (!h || action === "create" || action === "reset") {
    h = createTaskGraph({
      goal: goal || h?.original_goal || "Untitled goal",
      success_criteria: criteria.length
        ? criteria
        : h?.success_criteria?.length
          ? h.success_criteria
          : [goal || "Goal completed"],
      priority: typeof args.priority === "number" ? args.priority : undefined,
      global_budgets:
        args.global_budgets && typeof args.global_budgets === "object"
          ? (args.global_budgets as HierarchicalTaskGraph["global_budgets"])
          : undefined,
    });
  }

  if (goal && goal !== h.original_goal) {
    h = { ...h, original_goal: goal, updated_at: nowIso() };
  }
  if (criteria.length) {
    h = { ...h, success_criteria: criteria, updated_at: nowIso() };
  }
  if (typeof args.fleetId === "string" && args.fleetId.trim()) {
    h = { ...h, metadata: { ...(h.metadata || {}), fleetId: args.fleetId.trim() } };
  }

  const merge = args.merge === true || args.merge === "true";
  const ingestList: Record<string, unknown>[] = [];
  if (Array.isArray(args.nodes)) {
    for (const item of args.nodes) {
      if (item && typeof item === "object") ingestList.push(item as Record<string, unknown>);
    }
  }
  const rawItems = args.subtasks ?? args.items ?? args.tasks;
  if (Array.isArray(rawItems)) {
    for (const item of rawItems) {
      if (typeof item === "string") {
        const text = item.trim();
        if (text) ingestList.push({ description: text, text, role_hint: "coder" });
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      ingestList.push({
        ...o,
        description: o.description ?? o.text ?? o.content ?? o.title,
        depends_on: o.depends_on ?? o.blockers,
        role_hint: o.role_hint ?? o.role,
      });
    }
  }

  if (ingestList.length && (args.replace === true || args.replace === "true" || action === "replace_nodes")) {
    h = { ...h, nodes: [] };
  }

  for (const o of ingestList) {
    const description = String(o.description ?? o.text ?? "").trim();
    if (!description) continue;
    const wantId = typeof o.id === "string" ? o.id.trim() : "";
    const existing: HierarchicalTaskNode | undefined = wantId
      ? h.nodes.find((n: HierarchicalTaskNode): boolean => n.id === wantId)
      : h.nodes.find((n: HierarchicalTaskNode): boolean => n.description === description);
    if (existing && merge) {
      const depends_on = Array.isArray(o.depends_on)
        ? o.depends_on.filter((x): x is string => typeof x === "string")
        : existing.depends_on;
      const role_hint = typeof o.role_hint === "string" ? o.role_hint : existing.role_hint;
      h = {
        ...h,
        nodes: h.nodes.map((n: HierarchicalTaskNode): HierarchicalTaskNode =>
          n.id === existing.id
            ? {
                ...n,
                description,
                depends_on,
                ...(role_hint ? { role_hint } : {}),
                ...(typeof o.detailed_instructions === "string"
                  ? { detailed_instructions: o.detailed_instructions }
                  : typeof o.successCriteria === "string"
                    ? { detailed_instructions: o.successCriteria }
                    : {}),
              }
            : n,
        ),
        updated_at: nowIso(),
      };
      continue;
    }
    if (existing && !merge) continue;
    const depends_on = Array.isArray(o.depends_on)
      ? o.depends_on.filter((x): x is string => typeof x === "string")
      : Array.isArray(o.blockers)
        ? o.blockers.filter((x): x is string => typeof x === "string")
        : [];
    const added = addNode(h, {
      description,
      parent: typeof o.parent === "string" ? o.parent : null,
      depends_on,
      role_hint: typeof o.role_hint === "string" ? o.role_hint : typeof o.role === "string" ? o.role : undefined,
      detailed_instructions:
        typeof o.detailed_instructions === "string"
          ? o.detailed_instructions
          : typeof o.successCriteria === "string"
            ? o.successCriteria
            : undefined,
      priority: typeof o.priority === "number" ? o.priority : undefined,
      tags: Array.isArray(o.tags) ? o.tags.filter((x): x is string => typeof x === "string") : undefined,
      budget: o.budget && typeof o.budget === "object" ? (o.budget as never) : undefined,
    });
    h = added.graph;
    if (wantId && wantId !== added.node.id && !h.nodes.some((n) => n.id === wantId)) {
      const oldId = added.node.id;
      h = {
        ...h,
        nodes: h.nodes.map((n) => {
          if (n.id === oldId) return { ...n, id: wantId };
          return {
            ...n,
            depends_on: n.depends_on.map((d) => (d === oldId ? wantId : d)),
            children: n.children.map((c) => (c === oldId ? wantId : c)),
            parent: n.parent === oldId ? wantId : n.parent,
          };
        }),
      };
    }
  }

  if (action === "add_node") {
    const description = String(args.description ?? args.text ?? "").trim();
    if (!description) throw new Error("task_update add_node requires description/text");
    const added = addNode(h, {
      description,
      parent: typeof args.parent === "string" ? args.parent : null,
      depends_on: asStringList(args.depends_on ?? args.blockers),
      role_hint: typeof args.role_hint === "string" ? args.role_hint : typeof args.role === "string" ? args.role : undefined,
      detailed_instructions: typeof args.detailed_instructions === "string" ? args.detailed_instructions : undefined,
      priority: typeof args.priority === "number" ? args.priority : undefined,
    });
    h = added.graph;
  }

  const nodeId = (
    typeof args.node_id === "string" ? args.node_id : typeof args.id === "string" ? args.id : ""
  ).trim();

  if (action === "assign") {
    if (!nodeId) throw new Error("task_update assign requires id/node_id");
    const assignee = String(args.assignee || "").trim();
    if (!assignee) throw new Error("task_update assign requires assignee");
    try {
      h = assignNode(h, nodeId, assignee);
    } catch {
      h = {
        ...h,
        nodes: h.nodes.map((n) =>
          n.id === nodeId ? { ...n, assignee, status: "assigned", started_at: n.started_at || nowIso() } : n,
        ),
        status: "running",
        updated_at: nowIso(),
      };
    }
  }

  if (action === "start" && nodeId) {
    h = startNode(h, nodeId);
  }

  if (action === "verify" || (args.verification && typeof args.verification === "object")) {
    if (!nodeId) throw new Error("task_update verify requires id/node_id");
    const v = (
      args.verification && typeof args.verification === "object"
        ? (args.verification as Record<string, unknown>)
        : args
    ) as Record<string, unknown>;
    const status = String(v.status || args.verify_status || "pass").toLowerCase();
    const vs =
      status === "fail" || status === "failed"
        ? "fail"
        : status === "skipped"
          ? "skipped"
          : status === "pending"
            ? "pending"
            : "pass";
    h = verifyNode(h, nodeId, {
      status: vs as "pass" | "fail" | "skipped" | "pending",
      method: (String(v.method || args.method || "orchestrator") as "orchestrator") || "orchestrator",
      by: String(v.by || args.by || "orchestrator"),
      notes: typeof v.notes === "string" ? v.notes : typeof args.notes === "string" ? args.notes : undefined,
    });
  }

  if (action === "artifact" || (args.artifact && typeof args.artifact === "object")) {
    if (!nodeId) throw new Error("task_update artifact requires id/node_id");
    const a = (
      args.artifact && typeof args.artifact === "object" ? (args.artifact as Record<string, unknown>) : args
    ) as Record<string, unknown>;
    h = addArtifact(h, nodeId, {
      type: (String(a.type || "other") as "other") || "other",
      summary: String(a.summary || a.path || "artifact"),
      path: typeof a.path === "string" ? a.path : undefined,
      produced_by: String(a.produced_by || args.assignee || "orchestrator"),
    });
  }

  if (nodeId && !action) {
    const markStatus = typeof args.status === "string" ? args.status.toLowerCase() : "";
    if (markStatus === "done" || markStatus === "completed") {
      h = verifyNode(h, nodeId, {
        status: "pass",
        method: "orchestrator",
        by: String(args.by || args.assignee || "orchestrator"),
        notes: typeof args.notes === "string" ? args.notes : "marked done via task_update",
      });
    } else if (markStatus === "in_progress" || markStatus === "active") {
      const at = nowIso();
      h = {
        ...h,
        nodes: h.nodes.map((n) =>
          n.id === nodeId ? { ...n, status: "in_progress", started_at: n.started_at || at } : n,
        ),
        status: "running",
        updated_at: at,
      };
    } else if (markStatus === "blocked") {
      const at = nowIso();
      h = {
        ...h,
        nodes: h.nodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                status: "blocked",
                blockers: [
                  ...n.blockers,
                  {
                    reason: typeof args.notes === "string" ? args.notes : "blocked via task_update",
                    reported_by: String(args.by || args.assignee || "orchestrator"),
                    reported_at: at,
                    resolved: false,
                  },
                ],
              }
            : n,
        ),
        status: "blocked",
        updated_at: at,
      };
    } else if (markStatus === "pending") {
      h = {
        ...h,
        nodes: h.nodes.map((n) => (n.id === nodeId ? { ...n, status: "pending" } : n)),
        updated_at: nowIso(),
      };
    }
    if (args.heartbeat === true || args.heartbeat === "true") {
      const at = nowIso();
      h = {
        ...h,
        nodes: h.nodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                started_at: n.started_at || at,
                status: n.status === "pending" || n.status === "ready" ? "in_progress" : n.status,
              }
            : n,
        ),
        updated_at: at,
      };
    }
    if (typeof args.assignee === "string" && args.assignee.trim()) {
      const assignee = args.assignee.trim();
      h = {
        ...h,
        nodes: h.nodes.map((n) => (n.id === nodeId ? { ...n, assignee } : n)),
        updated_at: nowIso(),
      };
    }
  }

  h = refreshGraphStatus(h);
  const checked = safeParseHierarchicalTaskGraph(h);
  if (!checked.ok) throw new Error(checked.error);
  return checked.data;
}

export type TaskUpdateCommit = {
  text: string;
  flat: TaskGraph;
  hierarchical: HierarchicalTaskGraph | null;
  format: "hierarchical" | "flat";
};

export function commitTaskUpdate(existingRaw: string | null | undefined, args: Record<string, unknown>): TaskUpdateCommit {
  const raw = existingRaw || "";
  const hierarchical = wantsHierarchicalWrite(args, raw || null);
  if (!hierarchical) {
    const base = (raw && parseTaskGraph(raw)) || emptyTaskGraph();
    const next = applyTaskUpdateArgs(base, args);
    return { text: stringifyTaskGraph(next), flat: next, hierarchical: null, format: "flat" };
  }

  let h = raw ? parseHierarchicalFile(raw) : null;
  if (!h && raw) {
    const flat = parseTaskGraph(raw);
    if (flat && (flat.goal || flat.subtasks.length)) h = flatToHierarchical(flat);
  }
  h = applyHierarchicalTaskUpdateArgs(h, args);
  const flat = hierarchicalToFlat(h);
  return {
    text: stringifyHierarchicalTaskGraph(h),
    flat,
    hierarchical: h,
    format: "hierarchical",
  };
}

export function stringifyTaskGraphAsHierarchical(flat: TaskGraph): string {
  return stringifyHierarchicalTaskGraph(flatToHierarchical(flat));
}

export function formatHierarchicalTaskGraphPrompt(h: HierarchicalTaskGraph | null | undefined): string {
  if (!h) return "";
  return formatTaskGraphPrompt(hierarchicalToFlat(h));
}
