/**
 * Hierarchical Orchestrator — Task Graph v1.
 * Single source of truth for multi-agent runs. Orchestrator is the only
 * structural writer. Runtime validation without a Zod dependency.
 */

export const TASK_GRAPH_VERSION = 1 as const;

export const GRAPH_STATUSES = [
  'pending',
  'running',
  'blocked',
  'completed',
  'failed',
  'cancelled',
  'paused',
] as const;

export const NODE_STATUSES = [
  'pending',
  'ready',
  'assigned',
  'in_progress',
  'verification_pending',
  'completed',
  'failed',
  'blocked',
  'cancelled',
  'skipped',
] as const;

export const ARTIFACT_TYPES = [
  'file',
  'diff',
  'test_report',
  'analysis',
  'log',
  'checkpoint',
  'other',
] as const;

export const VERIFICATION_STATUSES = ['pending', 'pass', 'fail', 'skipped'] as const;

export const VERIFICATION_METHODS = [
  'critic',
  'compile',
  'unit_test',
  'lint',
  'human',
  'orchestrator',
  'script',
] as const;

export const HISTORY_ACTIONS = [
  'create',
  'assign',
  'start',
  'status',
  'artifact',
  'verify',
  'replan',
  'escalate',
  'pause',
  'resume',
  'cancel',
  'complete',
  'fail',
] as const;

export type GraphStatus = (typeof GRAPH_STATUSES)[number];
export type NodeStatus = (typeof NODE_STATUSES)[number];
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];

export type AgentRole = 'orchestrator' | 'coder' | 'researcher' | 'critic' | 'integrator';

export type Artifact = {
  id: string;
  type: ArtifactType;
  path?: string;
  summary: string;
  produced_by: string;
  created_at: string;
};

export type Verification = {
  status: VerificationStatus;
  method: VerificationMethod;
  by: string;
  at: string;
  notes?: string;
};

export type Blocker = {
  reason: string;
  reported_by: string;
  reported_at: string;
  resolved: boolean;
};

export type Budget = {
  max_steps?: number;
  max_tokens?: number;
  max_wall_clock_seconds?: number;
  max_tool_calls?: number;
};

export type Consumed = {
  steps: number;
  tokens: number;
  wall_clock_seconds: number;
  tool_calls: number;
};

export type HistoryEntry = {
  at: string;
  action: HistoryAction;
  actor: string;
  node_id?: string;
  detail?: string;
};

export type TaskNode = {
  id: string;
  parent: string | null;
  description: string;
  detailed_instructions?: string;
  status: NodeStatus;
  assignee: string | null;
  role_hint?: AgentRole | string;
  depends_on: string[];
  children: string[];
  artifacts: Artifact[];
  budget?: Budget;
  consumed: Consumed;
  verification?: Verification;
  blockers: Blocker[];
  priority: number;
  tags: string[];
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  metadata?: Record<string, unknown>;
};

export type TaskGraph = {
  graph_id: string;
  created_at: string;
  updated_at?: string;
  version: number;
  original_goal: string;
  success_criteria: string[];
  status: GraphStatus;
  priority: number;
  metadata?: Record<string, unknown>;
  nodes: TaskNode[];
  history: HistoryEntry[];
  global_budgets?: {
    max_total_tokens?: number;
    max_wall_clock_seconds?: number;
    max_parallel_agents?: number;
  };
};

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export function isGraphId(id: string): boolean {
  return UUID_RE.test(id) || ID_RE.test(id);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newGraphId(): string {
  return `tg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function newNodeId(): string {
  return `tn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function inSet<T extends string>(v: unknown, set: readonly T[]): v is T {
  return typeof v === 'string' && (set as readonly string[]).includes(v);
}

function emptyConsumed(): Consumed {
  return { steps: 0, tokens: 0, wall_clock_seconds: 0, tool_calls: 0 };
}

function parseConsumed(raw: unknown): Consumed {
  if (!isObj(raw)) return emptyConsumed();
  return {
    steps: Math.max(0, Math.floor(asNum(raw.steps) ?? 0)),
    tokens: Math.max(0, Math.floor(asNum(raw.tokens) ?? 0)),
    wall_clock_seconds: Math.max(0, Math.floor(asNum(raw.wall_clock_seconds) ?? 0)),
    tool_calls: Math.max(0, Math.floor(asNum(raw.tool_calls) ?? 0)),
  };
}

function parseBudget(raw: unknown): Budget | undefined {
  if (!isObj(raw)) return undefined;
  const b: Budget = {};
  if (asNum(raw.max_steps) != null) b.max_steps = Math.floor(asNum(raw.max_steps)!);
  if (asNum(raw.max_tokens) != null) b.max_tokens = Math.floor(asNum(raw.max_tokens)!);
  if (asNum(raw.max_wall_clock_seconds) != null) {
    b.max_wall_clock_seconds = Math.floor(asNum(raw.max_wall_clock_seconds)!);
  }
  if (asNum(raw.max_tool_calls) != null) b.max_tool_calls = Math.floor(asNum(raw.max_tool_calls)!);
  return Object.keys(b).length ? b : undefined;
}

function parseArtifact(raw: unknown, i: number): Artifact {
  if (!isObj(raw)) throw new Error(`artifacts[${i}] not an object`);
  const id = asString(raw.id);
  const summary = asString(raw.summary);
  const produced_by = asString(raw.produced_by);
  const created_at = asString(raw.created_at);
  if (!id || !isGraphId(id)) throw new Error(`artifacts[${i}].id invalid`);
  if (!inSet(raw.type, ARTIFACT_TYPES)) throw new Error(`artifacts[${i}].type invalid`);
  if (!summary) throw new Error(`artifacts[${i}].summary required`);
  if (!produced_by) throw new Error(`artifacts[${i}].produced_by required`);
  if (!created_at || !ISO_RE.test(created_at)) throw new Error(`artifacts[${i}].created_at invalid`);
  const path = asString(raw.path);
  return { id, type: raw.type, summary, produced_by, created_at, ...(path ? { path } : {}) };
}

function parseVerification(raw: unknown): Verification | undefined {
  if (raw == null) return undefined;
  if (!isObj(raw)) throw new Error('verification not an object');
  if (!inSet(raw.status, VERIFICATION_STATUSES)) throw new Error('verification.status invalid');
  if (!inSet(raw.method, VERIFICATION_METHODS)) throw new Error('verification.method invalid');
  const by = asString(raw.by);
  const at = asString(raw.at);
  if (!by) throw new Error('verification.by required');
  if (!at || !ISO_RE.test(at)) throw new Error('verification.at invalid');
  const notes = asString(raw.notes);
  return { status: raw.status, method: raw.method, by, at, ...(notes ? { notes } : {}) };
}

function parseBlocker(raw: unknown, i: number): Blocker {
  if (!isObj(raw)) throw new Error(`blockers[${i}] not an object`);
  const reason = asString(raw.reason);
  const reported_by = asString(raw.reported_by);
  const reported_at = asString(raw.reported_at);
  if (!reason) throw new Error(`blockers[${i}].reason required`);
  if (!reported_by) throw new Error(`blockers[${i}].reported_by required`);
  if (!reported_at || !ISO_RE.test(reported_at)) throw new Error(`blockers[${i}].reported_at invalid`);
  return { reason, reported_by, reported_at, resolved: asBool(raw.resolved) === true };
}

function parseHistory(raw: unknown, i: number): HistoryEntry {
  if (!isObj(raw)) throw new Error(`history[${i}] not an object`);
  const at = asString(raw.at);
  const actor = asString(raw.actor);
  if (!at || !ISO_RE.test(at)) throw new Error(`history[${i}].at invalid`);
  if (!inSet(raw.action, HISTORY_ACTIONS)) throw new Error(`history[${i}].action invalid`);
  if (!actor) throw new Error(`history[${i}].actor required`);
  const node_id = asString(raw.node_id);
  const detail = asString(raw.detail);
  return {
    at,
    action: raw.action,
    actor,
    ...(node_id ? { node_id } : {}),
    ...(detail ? { detail } : {}),
  };
}

function parseNode(raw: unknown, i: number): TaskNode {
  if (!isObj(raw)) throw new Error(`nodes[${i}] not an object`);
  const id = asString(raw.id);
  const description = asString(raw.description);
  const created_at = asString(raw.created_at);
  if (!id || !isGraphId(id)) throw new Error(`nodes[${i}].id invalid`);
  if (!description?.trim()) throw new Error(`nodes[${i}].description required`);
  if (!inSet(raw.status, NODE_STATUSES)) throw new Error(`nodes[${i}].status invalid`);
  if (!created_at || !ISO_RE.test(created_at)) throw new Error(`nodes[${i}].created_at invalid`);
  let parent: string | null = null;
  if (raw.parent != null) {
    const p = asString(raw.parent);
    if (!p || !isGraphId(p)) throw new Error(`nodes[${i}].parent invalid`);
    parent = p;
  }
  const depends_on = Array.isArray(raw.depends_on)
    ? raw.depends_on.map((d, j) => {
        const s = asString(d);
        if (!s || !isGraphId(s)) throw new Error(`nodes[${i}].depends_on[${j}] invalid`);
        return s;
      })
    : [];
  const children = Array.isArray(raw.children)
    ? raw.children.map((d, j) => {
        const s = asString(d);
        if (!s || !isGraphId(s)) throw new Error(`nodes[${i}].children[${j}] invalid`);
        return s;
      })
    : [];
  const artifacts = Array.isArray(raw.artifacts)
    ? raw.artifacts.map((a, j) => parseArtifact(a, j))
    : [];
  const blockers = Array.isArray(raw.blockers) ? raw.blockers.map((b, j) => parseBlocker(b, j)) : [];
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map((t) => {
        const s = asString(t);
        if (!s) throw new Error(`nodes[${i}].tags must be strings`);
        return s;
      })
    : [];
  const priority = Math.min(100, Math.max(0, Math.floor(asNum(raw.priority) ?? 50)));
  const assignee = raw.assignee == null ? null : asString(raw.assignee) || null;
  const detailed_instructions = asString(raw.detailed_instructions);
  const role_hint = asString(raw.role_hint);
  const started_at = raw.started_at == null ? null : asString(raw.started_at);
  const completed_at = raw.completed_at == null ? null : asString(raw.completed_at);
  if (started_at && !ISO_RE.test(started_at)) throw new Error(`nodes[${i}].started_at invalid`);
  if (completed_at && !ISO_RE.test(completed_at)) throw new Error(`nodes[${i}].completed_at invalid`);
  const metadata = isObj(raw.metadata) ? raw.metadata : undefined;
  return {
    id,
    parent,
    description,
    status: raw.status,
    assignee,
    depends_on,
    children,
    artifacts,
    consumed: parseConsumed(raw.consumed),
    blockers,
    priority,
    tags,
    created_at,
    ...(detailed_instructions ? { detailed_instructions } : {}),
    ...(role_hint ? { role_hint } : {}),
    ...(parseBudget(raw.budget) ? { budget: parseBudget(raw.budget) } : {}),
    ...(parseVerification(raw.verification) ? { verification: parseVerification(raw.verification) } : {}),
    ...(started_at !== undefined ? { started_at } : {}),
    ...(completed_at !== undefined ? { completed_at } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

export function parseTaskGraph(data: unknown): TaskGraph {
  if (!isObj(data)) throw new Error('graph must be an object');
  const graph_id = asString(data.graph_id);
  const created_at = asString(data.created_at);
  const original_goal = asString(data.original_goal);
  if (!graph_id || !isGraphId(graph_id)) throw new Error('graph_id invalid');
  if (!created_at || !ISO_RE.test(created_at)) throw new Error('created_at invalid');
  if (!original_goal?.trim()) throw new Error('original_goal required');
  if (!inSet(data.status, GRAPH_STATUSES)) throw new Error('status invalid');
  const version = Math.floor(asNum(data.version) ?? 0);
  if (version < 1) throw new Error('version must be >= 1');
  const success_criteria = Array.isArray(data.success_criteria)
    ? data.success_criteria.map((c, i) => {
        const s = asString(c);
        if (!s?.trim()) throw new Error(`success_criteria[${i}] empty`);
        return s;
      })
    : [];
  if (!success_criteria.length) throw new Error('success_criteria min 1');
  const nodes = Array.isArray(data.nodes) ? data.nodes.map((n, i) => parseNode(n, i)) : [];
  const history = Array.isArray(data.history) ? data.history.map((h, i) => parseHistory(h, i)) : [];
  const ids = new Set(nodes.map((n) => n.id));
  if (ids.size !== nodes.length) throw new Error('duplicate node id');
  for (const n of nodes) {
    for (const d of n.depends_on) {
      if (!ids.has(d)) throw new Error(`node ${n.id} depends_on missing ${d}`);
    }
    for (const c of n.children) {
      if (!ids.has(c)) throw new Error(`node ${n.id} children missing ${c}`);
    }
    if (n.parent && !ids.has(n.parent)) throw new Error(`node ${n.id} parent missing`);
  }
  const cycle = detectCycle(nodes);
  if (cycle) throw new Error(`dependency cycle: ${cycle.join(' -> ')}`);
  const updated_at = asString(data.updated_at);
  if (updated_at && !ISO_RE.test(updated_at)) throw new Error('updated_at invalid');
  const priority = Math.min(100, Math.max(0, Math.floor(asNum(data.priority) ?? 50)));
  const metadata = isObj(data.metadata) ? data.metadata : undefined;
  let global_budgets: TaskGraph['global_budgets'];
  if (isObj(data.global_budgets)) {
    global_budgets = {};
    if (asNum(data.global_budgets.max_total_tokens) != null) {
      global_budgets.max_total_tokens = Math.floor(asNum(data.global_budgets.max_total_tokens)!);
    }
    if (asNum(data.global_budgets.max_wall_clock_seconds) != null) {
      global_budgets.max_wall_clock_seconds = Math.floor(
        asNum(data.global_budgets.max_wall_clock_seconds)!,
      );
    }
    if (asNum(data.global_budgets.max_parallel_agents) != null) {
      global_budgets.max_parallel_agents = Math.floor(asNum(data.global_budgets.max_parallel_agents)!);
    }
  }
  return {
    graph_id,
    created_at,
    version,
    original_goal,
    success_criteria,
    status: data.status,
    priority,
    nodes,
    history,
    ...(updated_at ? { updated_at } : {}),
    ...(metadata ? { metadata } : {}),
    ...(global_budgets && Object.keys(global_budgets).length ? { global_budgets } : {}),
  };
}

export function safeParseTaskGraph(data: unknown): ParseResult<TaskGraph> {
  try {
    return { ok: true, data: parseTaskGraph(data) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function detectCycle(nodes: TaskNode[]): string[] | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visiting = new Set<string>();
  const seen = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (seen.has(id)) return null;
    if (visiting.has(id)) return [...stack, id];
    visiting.add(id);
    stack.push(id);
    const n = byId.get(id);
    for (const d of n?.depends_on || []) {
      const hit = visit(d);
      if (hit) return hit;
    }
    stack.pop();
    visiting.delete(id);
    seen.add(id);
    return null;
  };
  for (const n of nodes) {
    const hit = visit(n.id);
    if (hit) return hit;
  }
  return null;
}

export function isVerifiedComplete(node: TaskNode): boolean {
  return node.status === 'completed' && node.verification?.status === 'pass';
}

export function nodeCanStart(graph: TaskGraph, nodeId: string): boolean {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const n = byId.get(nodeId);
  if (!n) return false;
  if (n.status === 'cancelled' || n.status === 'skipped' || n.status === 'completed') return false;
  return n.depends_on.every((id) => {
    const dep = byId.get(id);
    return dep ? isVerifiedComplete(dep) : false;
  });
}

export function readyNodes(graph: TaskGraph): TaskNode[] {
  return graph.nodes
    .filter((n) => ['pending', 'ready', 'blocked'].includes(n.status) && nodeCanStart(graph, n.id))
    .sort((a, b) => b.priority - a.priority);
}

function bump(graph: TaskGraph, entry: HistoryEntry): TaskGraph {
  return {
    ...graph,
    version: graph.version + 1,
    updated_at: entry.at,
    history: [...graph.history, entry],
  };
}

function mapNode(graph: TaskGraph, id: string, fn: (n: TaskNode) => TaskNode): TaskGraph {
  let found = false;
  const nodes = graph.nodes.map((n) => {
    if (n.id !== id) return n;
    found = true;
    return fn(n);
  });
  if (!found) throw new Error(`node ${id} not found`);
  return { ...graph, nodes };
}

export function createTaskGraph(opts: {
  goal: string;
  success_criteria: string[];
  priority?: number;
  global_budgets?: TaskGraph['global_budgets'];
}): TaskGraph {
  const at = nowIso();
  return parseTaskGraph({
    graph_id: newGraphId(),
    created_at: at,
    updated_at: at,
    version: TASK_GRAPH_VERSION,
    original_goal: opts.goal,
    success_criteria: opts.success_criteria,
    status: 'pending',
    priority: opts.priority ?? 50,
    nodes: [],
    history: [{ at, action: 'create', actor: 'orchestrator', detail: 'graph created' }],
    ...(opts.global_budgets ? { global_budgets: opts.global_budgets } : {}),
  });
}

export function addNode(
  graph: TaskGraph,
  input: {
    description: string;
    parent?: string | null;
    depends_on?: string[];
    role_hint?: string;
    budget?: Budget;
    priority?: number;
    detailed_instructions?: string;
    tags?: string[];
  },
): { graph: TaskGraph; node: TaskNode } {
  const at = nowIso();
  const id = newNodeId();
  const node: TaskNode = {
    id,
    parent: input.parent ?? null,
    description: input.description,
    status: 'pending',
    assignee: null,
    depends_on: input.depends_on || [],
    children: [],
    artifacts: [],
    consumed: emptyConsumed(),
    blockers: [],
    priority: input.priority ?? 50,
    tags: input.tags || [],
    created_at: at,
    ...(input.role_hint ? { role_hint: input.role_hint } : {}),
    ...(input.budget ? { budget: input.budget } : {}),
    ...(input.detailed_instructions ? { detailed_instructions: input.detailed_instructions } : {}),
  };
  let next: TaskGraph = { ...graph, nodes: [...graph.nodes, node] };
  if (node.parent) {
    next = mapNode(next, node.parent, (p) => ({ ...p, children: [...p.children, id] }));
  }
  next = bump(next, { at, action: 'create', actor: 'orchestrator', node_id: id, detail: node.description });
  next.status = next.status === 'pending' ? 'running' : next.status;
  parseTaskGraph(next);
  return { graph: next, node };
}

export function assignNode(graph: TaskGraph, nodeId: string, assignee: string): TaskGraph {
  if (!nodeCanStart(graph, nodeId)) throw new Error(`node ${nodeId} is not ready (unverified deps)`);
  const at = nowIso();
  let next = mapNode(graph, nodeId, (n) => ({
    ...n,
    assignee,
    status: 'assigned' as const,
    started_at: n.started_at || at,
  }));
  next = bump(next, { at, action: 'assign', actor: 'orchestrator', node_id: nodeId, detail: assignee });
  next.status = 'running';
  return parseTaskGraph(next);
}

export function startNode(graph: TaskGraph, nodeId: string): TaskGraph {
  const at = nowIso();
  let next = mapNode(graph, nodeId, (n) => ({
    ...n,
    status: 'in_progress' as const,
    started_at: n.started_at || at,
  }));
  next = bump(next, { at, action: 'start', actor: nActor(graph, nodeId), node_id: nodeId });
  return parseTaskGraph(next);
}

function nActor(graph: TaskGraph, nodeId: string): string {
  return graph.nodes.find((n) => n.id === nodeId)?.assignee || 'orchestrator';
}

export function addArtifact(graph: TaskGraph, nodeId: string, artifact: Omit<Artifact, 'id' | 'created_at'>): TaskGraph {
  const at = nowIso();
  const full: Artifact = { ...artifact, id: newNodeId(), created_at: at };
  let next = mapNode(graph, nodeId, (n) => ({ ...n, artifacts: [...n.artifacts, full] }));
  next = bump(next, {
    at,
    action: 'artifact',
    actor: artifact.produced_by,
    node_id: nodeId,
    detail: full.summary,
  });
  return parseTaskGraph(next);
}

/** Completing a node requires a passing verification. */
export function verifyNode(
  graph: TaskGraph,
  nodeId: string,
  verification: Omit<Verification, 'at'> & { at?: string },
): TaskGraph {
  const at = verification.at || nowIso();
  const v: Verification = { ...verification, at };
  let next = mapNode(graph, nodeId, (n) => ({
    ...n,
    verification: v,
    status: v.status === 'pass' ? ('completed' as const) : v.status === 'fail' ? ('failed' as const) : ('verification_pending' as const),
    completed_at: v.status === 'pass' || v.status === 'fail' ? at : n.completed_at,
  }));
  next = bump(next, {
    at,
    action: 'verify',
    actor: v.by,
    node_id: nodeId,
    detail: `${v.method}:${v.status}`,
  });
  if (v.status === 'pass') {
    next = bump(next, { at, action: 'complete', actor: 'orchestrator', node_id: nodeId });
  } else if (v.status === 'fail') {
    next = bump(next, { at, action: 'fail', actor: v.by, node_id: nodeId });
  }
  return parseTaskGraph(refreshGraphStatus(next));
}

export function refreshGraphStatus(graph: TaskGraph): TaskGraph {
  const live = graph.nodes.filter((n) => n.status !== 'cancelled' && n.status !== 'skipped');
  if (!live.length) return { ...graph, status: graph.status };
  if (live.every((n) => n.status === 'completed')) return { ...graph, status: 'completed' };
  if (live.some((n) => n.status === 'failed' && n.blockers.some((b) => !b.resolved))) {
    return { ...graph, status: 'blocked' };
  }
  if (live.some((n) => n.status === 'failed')) return { ...graph, status: graph.status === 'paused' ? 'paused' : 'running' };
  if (live.some((n) => n.status === 'blocked')) return { ...graph, status: 'blocked' };
  return { ...graph, status: graph.status === 'paused' ? 'paused' : 'running' };
}

export function consumeBudget(
  graph: TaskGraph,
  nodeId: string,
  delta: Partial<Consumed>,
): { graph: TaskGraph; exceeded: boolean } {
  let exceeded = false;
  const next = mapNode(graph, nodeId, (n) => {
    const consumed: Consumed = {
      steps: n.consumed.steps + Math.max(0, delta.steps || 0),
      tokens: n.consumed.tokens + Math.max(0, delta.tokens || 0),
      wall_clock_seconds: n.consumed.wall_clock_seconds + Math.max(0, delta.wall_clock_seconds || 0),
      tool_calls: n.consumed.tool_calls + Math.max(0, delta.tool_calls || 0),
    };
    const b = n.budget;
    if (b) {
      if (b.max_steps != null && consumed.steps > b.max_steps) exceeded = true;
      if (b.max_tokens != null && consumed.tokens > b.max_tokens) exceeded = true;
      if (b.max_wall_clock_seconds != null && consumed.wall_clock_seconds > b.max_wall_clock_seconds) {
        exceeded = true;
      }
      if (b.max_tool_calls != null && consumed.tool_calls > b.max_tool_calls) exceeded = true;
    }
    return { ...n, consumed };
  });
  return { graph: parseTaskGraph(next), exceeded };
}

/** Default per-role node budgets (steps). */
export function defaultNodeBudget(role?: AgentRole | string): Budget {
  const r = (role || 'coder') as string;
  if (r === 'critic' || r === 'verifier') return { max_steps: 8, max_tool_calls: 16 };
  if (r === 'researcher') return { max_steps: 12, max_tool_calls: 24 };
  if (r === 'orchestrator') return { max_steps: 10, max_tool_calls: 20 };
  if (r === 'integrator') return { max_steps: 12, max_tool_calls: 24 };
  return { max_steps: 16, max_tool_calls: 32 };
}

export const DEFAULT_NODE_HEARTBEAT_STALE_MS = 90_000;

/** Reset stale in_progress nodes to pending and append graph history replan entries. */
export function reclaimStaleNodes(
  graph: TaskGraph,
  staleMs = DEFAULT_NODE_HEARTBEAT_STALE_MS,
  now = Date.now(),
): { graph: TaskGraph; reclaimed: string[] } {
  const reclaimed: string[] = [];
  let next = graph;
  for (const n of graph.nodes) {
    if (n.status !== 'in_progress') continue;
    const beat =
      n.metadata && typeof (n.metadata as { lastBeatAt?: number }).lastBeatAt === 'number'
        ? (n.metadata as { lastBeatAt: number }).lastBeatAt
        : 0;
    const started = n.started_at ? Date.parse(n.started_at) : 0;
    const anchor = beat || started || 0;
    if (anchor && now - anchor <= staleMs) continue;
    reclaimed.push(n.id);
    next = mapNode(next, n.id, (node) => ({
      ...node,
      status: 'pending' as NodeStatus,
      assignee: null,
    }));
    const at = nowIso();
    next = bump(next, {
      at,
      action: 'replan',
      actor: 'heartbeat',
      node_id: n.id,
      detail: `stale > ${staleMs}ms — reclaim`,
    });
  }
  return { graph: reclaimed.length ? parseTaskGraph(next) : next, reclaimed };
}

/** Record a replan: clear assignee, set pending (unless failed/blocked), bump graph history. */
export function recordNodeReplan(
  graph: TaskGraph,
  nodeId: string,
  detail: string,
  actor = 'orchestrator',
): TaskGraph {
  let next = mapNode(graph, nodeId, (n) => ({
    ...n,
    status: (n.status === 'failed' || n.status === 'blocked' ? n.status : 'pending') as NodeStatus,
    assignee: null,
  }));
  next = bump(next, {
    at: nowIso(),
    action: 'replan',
    actor,
    node_id: nodeId,
    detail,
  });
  return parseTaskGraph(next);
}

/** Path-level write lock: exact artifact / metadata.lockPath claimed by in_progress nodes. */
export function claimedWritePaths(graph: TaskGraph): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.status !== 'in_progress') continue;
    for (const a of n.artifacts || []) {
      if (a.path) m.set(a.path.replace(/\\/g, '/').replace(/^\.\//, ''), n.id);
    }
    const lock =
      n.metadata && typeof (n.metadata as { lockPath?: string }).lockPath === 'string'
        ? (n.metadata as { lockPath: string }).lockPath
        : '';
    if (lock) m.set(lock.replace(/\\/g, '/').replace(/^\.\//, ''), n.id);
  }
  return m;
}

export function canClaimWritePath(graph: TaskGraph, path: string, selfId: string): boolean {
  const key = path.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!key) return false;
  const claimed = claimedWritePaths(graph);
  const owner = claimed.get(key);
  return !owner || owner === selfId;
}
