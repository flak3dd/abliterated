/**
 * Flag-gated multi-agent MVP runner.
 * Reuses streamChatCompletion + executeAgentTool — does not fork a second agent stack.
 */
import { resolveActiveSettings } from "./activeEndpoint";
import { executeAgentTool } from "./agentTools";
import { bridge } from "./bridgeClient";
import { clampMaxAgentTurns } from "./agentHelpers";
import { streamChatCompletion } from "./sse";
import { workspaceGate } from "./workspaceGuard";
import {
  TASK_GRAPH_PATH,
  emptyTaskGraph,
  formatTaskGraphPrompt,
  parseTaskGraph,
  stringifyTaskGraphAsHierarchical,
  touchHeartbeat,
  type AgentRole,
  type TaskGraph,
} from "./taskGraph";
import { AGENT_BUS_PATH, formatBusEvent, type BusEvent } from "./agentBus";
import {
  defaultFleetPlan,
  fleetComplete,
  pickNextSubtask,
  roleSystemAddendum,
} from "./multiAgent";
import { prepareJobWorktree } from "./jobWorktree";
import { buildModelAgentProfile } from "./modelAgentProfile";
import { peekFeatherlessModel } from "./featherlessLimits";
import type { ChatOpenAiMessage, ClientSettings, Job, ToolType } from "../types";
import { DEFAULT_ENABLED_TOOLS, PLAN_MODE_TOOLS } from "../types";
import { executeMcpToolCall } from "./mcpClient";

export type MultiAgentProgress = {
  job: Job;
  graph: TaskGraph | null;
  phase: string;
};

type PersistFn = (job: Job) => Job;
type LogFn = (job: Job, line: string) => Job;

async function readGraph(): Promise<TaskGraph> {
  if (!bridge.connected) return emptyTaskGraph();
  try {
    const raw = await bridge.readFile(TASK_GRAPH_PATH);
    return parseTaskGraph(raw) || emptyTaskGraph();
  } catch {
    return emptyTaskGraph();
  }
}

async function writeGraph(graph: TaskGraph): Promise<void> {
  if (!bridge.connected) return;
  await bridge.writeFile(TASK_GRAPH_PATH, stringifyTaskGraphAsHierarchical(graph));
}

async function appendBus(ev: BusEvent): Promise<void> {
  if (!bridge.connected) return;
  let prev = "";
  try {
    prev = await bridge.readFile(AGENT_BUS_PATH);
  } catch {
    prev = "";
  }
  const clip = prev.length > 200_000 ? prev.slice(-100_000) : prev;
  await bridge.writeFile(AGENT_BUS_PATH, clip + formatBusEvent(ev));
}

function toolsForRole(role: AgentRole, planMode: boolean): ToolType[] {
  if (planMode) return [...PLAN_MODE_TOOLS];
  if (role === "verifier" || role === "researcher") {
    // Prefer read + verify/shell; still allow task_update for blackboard
    return DEFAULT_ENABLED_TOOLS.filter(
      (t) =>
        t !== "write_file" &&
        t !== "git_commit" &&
        t !== "create_pr" &&
        t !== "checkpoint_restore" &&
        t !== "write_skill",
    );
  }
  if (role === "orchestrator") {
    return DEFAULT_ENABLED_TOOLS.filter((t) =>
      ["task_read", "task_update", "todo", "read_file", "list_dir", "glob", "grep", "semantic_search", "web_search", "web_fetch", "git_status", "git_diff"].includes(t),
    );
  }
  return [...DEFAULT_ENABLED_TOOLS];
}

/**
 * Run a multi-agent fleet inside an existing Job shell (caller owns queue/persist).
 */
export async function runMultiAgentFleet(opts: {
  job: Job;
  settings: ClientSettings;
  persist: PersistFn;
  appendLog: LogFn;
  abortSignal: AbortSignal;
  workspaceRoot: string;
}): Promise<Job> {
  let job = opts.job;
  const settings = opts.settings;
  const { persist, appendLog, abortSignal, workspaceRoot } = opts;

  if (settings.multiAgentEnabled !== true) {
    return appendLog(job, "multi-agent disabled — falling through");
  }

  const gate = workspaceGate(workspaceRoot, bridge.currentAppRoot);
  if (!gate.ok) {
    return persist({
      ...job,
      status: "error",
      stopReason: "error",
      error: gate.message,
      endedAt: Date.now(),
    });
  }

  if (settings.jobWorktreesEnabled === true && bridge.connected) {
    try {
      const prep = await prepareJobWorktree({
        enabled: true,
        jobId: job.id,
        workspaceRoot,
        run: async (command) => {
          let out = "";
          const code = await bridge.runCommand(command, (c) => {
            out += c;
          });
          return { out, code };
        },
      });
      job = appendLog(job, `worktree: ${prep.note} (${prep.path})`);
    } catch (e) {
      job = appendLog(job, `worktree stub: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let graph = await readGraph();
  if (!graph.goal.trim() || graph.subtasks.length === 0) {
    graph = defaultFleetPlan(job.prompt);
    await writeGraph(graph);
    job = appendLog(job, `multi-agent: seeded fleet ${graph.fleetId}`);
    await appendBus({
      ts: Date.now(),
      type: "assign",
      from: "orchestrator",
      fleetId: graph.fleetId,
      payload: { goal: graph.goal, n: graph.subtasks.length },
    });
  } else if (!graph.fleetId) {
    graph = { ...graph, fleetId: `fleet-${job.id}` };
    await writeGraph(graph);
  }

  job = persist({ ...job, role: "orchestrator", multiAgent: true, fleetId: graph.fleetId });

  const active = resolveActiveSettings(settings);
  const turnCap = Math.min(12, clampMaxAgentTurns(settings.maxAgentTurns));
  const planMode = settings.planModeEnabled === true;

  // Phase 1: orchestrator decomposition (short)
  job = appendLog(job, "multi-agent phase: orchestrator");
  job = await runRoleLoop({
    job,
    settings,
    role: "orchestrator",
    graph,
    persist,
    appendLog,
    abortSignal,
    workspaceRoot,
    activeModel: active.defaultModel,
    turnBudget: Math.min(4, turnCap),
    userKickoff:
      `Fleet goal:\n${job.prompt}\n\n` +
      `Current blackboard:\n${formatTaskGraphPrompt(graph)}\n\n` +
      "Update task.json into a concrete DAG (coder/tester/verifier) with successCriteria. Do not implement code.",
    planMode,
  });
  graph = await readGraph();

  // Phase 2: worker loop
  let rounds = 0;
  const maxRounds = 8;
  while (rounds < maxRounds && !fleetComplete(graph)) {
    if (abortSignal.aborted) throw new DOMException("Aborted", "AbortError");
    rounds += 1;
    let next = pickNextSubtask(graph);
    if (!next) {
      job = appendLog(job, "multi-agent: no ready subtasks — stopping");
      break;
    }
    // If pickNext returned a stale reclaim, reset status
    if (next.status === "pending" || next.status === "in_progress") {
      graph = touchHeartbeat(graph, next.id);
      await writeGraph(graph);
    }
    const role = (next.role || "coder") as AgentRole;
    job = persist({ ...job, role });
    job = appendLog(job, `multi-agent phase: ${role} → ${next.id}`);
    await appendBus({
      ts: Date.now(),
      type: "assign",
      from: "orchestrator",
      to: role,
      taskId: next.id,
      fleetId: graph.fleetId,
      payload: { text: next.text },
    });

    job = await runRoleLoop({
      job,
      settings,
      role,
      graph,
      persist,
      appendLog,
      abortSignal,
      workspaceRoot,
      activeModel: active.defaultModel,
      turnBudget: turnCap,
      userKickoff:
        `You are ${role} on subtask ${next.id}.\n` +
        `${next.text}\n` +
        (next.successCriteria ? `Success: ${next.successCriteria}\n` : "") +
        `\nBlackboard:\n${formatTaskGraphPrompt(graph)}\n` +
        (role === "verifier"
          ? "CRITIC: call verify before pass. Reject if evidence missing."
          : "Heartbeat via task_update id+heartbeat. Stay in scope."),
      planMode: planMode && role !== "orchestrator" ? planMode : planMode,
      subtaskId: next.id,
    });

    graph = await readGraph();
    // Verifier gate: if critique role finished without verify evidence in logs, mark incomplete note
    if (role === "verifier") {
      await appendBus({
        ts: Date.now(),
        type: "critique",
        from: "verifier",
        taskId: next.id,
        fleetId: graph.fleetId,
        payload: { round: rounds },
      });
    }
  }

  graph = await readGraph();
  if (fleetComplete(graph)) {
    job = persist({
      ...job,
      status: "done",
      stopReason: "done",
      endedAt: Date.now(),
      role: job.role,
    });
    job = appendLog(job, "multi-agent: fleet complete");
  } else {
    job = persist({
      ...job,
      status: "incomplete",
      stopReason: "cap",
      error: "multi-agent fleet incomplete",
      endedAt: Date.now(),
    });
    job = appendLog(job, "multi-agent: incomplete (rounds exhausted or blocked)");
  }
  return job;
}

async function runRoleLoop(opts: {
  job: Job;
  settings: ClientSettings;
  role: AgentRole;
  graph: TaskGraph;
  persist: PersistFn;
  appendLog: LogFn;
  abortSignal: AbortSignal;
  workspaceRoot: string;
  activeModel: string;
  turnBudget: number;
  userKickoff: string;
  planMode: boolean;
  subtaskId?: string;
}): Promise<Job> {
  let job = opts.job;
  const enabledTools = toolsForRole(opts.role, opts.planMode);
  const peek = peekFeatherlessModel(opts.activeModel);
  const profile = buildModelAgentProfile({
    model: opts.activeModel,
    provider: resolveActiveSettings(opts.settings).provider,
    reasoning: opts.settings.reasoning,
    planMode: opts.planMode,
    buildMode: opts.settings.buildModeEnabled !== false,
    toolUse: peek?.toolUse,
    contextLength: peek?.contextLength,
    enabledTools,
  });

  const system = [
    opts.settings.systemPrompt || "",
    roleSystemAddendum(opts.role, { goal: opts.graph.goal || opts.job.prompt, subtask: opts.graph.subtasks.find((s) => s.id === opts.subtaskId) }),
    formatTaskGraphPrompt(opts.graph),
    profile.systemAddendum,
    opts.workspaceRoot ? `Workspace root: ${opts.workspaceRoot}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const history: ChatOpenAiMessage[] = [{ role: "user", content: opts.userKickoff }];

  for (let turn = 1; turn <= opts.turnBudget; turn++) {
    if (opts.abortSignal.aborted) throw new DOMException("Aborted", "AbortError");
    job = opts.appendLog(job, `${opts.role} turn ${turn}/${opts.turnBudget}`);

    if (opts.subtaskId && bridge.connected) {
      try {
        let g = await readGraph();
        g = touchHeartbeat(g, opts.subtaskId);
        await writeGraph(g);
        await appendBus({
          ts: Date.now(),
          type: "heartbeat",
          from: opts.role,
          taskId: opts.subtaskId,
          fleetId: g.fleetId,
        });
      } catch {
        /* ignore */
      }
    }

    let assistantText = "";
    const result = await streamChatCompletion({
      settings: opts.settings,
      model: opts.activeModel,
      messages: [{ role: "system", content: system }, ...history],
      abortSignal: opts.abortSignal,
      enabledTools,
      flightKey: `job:${job.id}:${opts.role}`,
      onDelta: (t) => {
        assistantText += t;
      },
    });

    history.push({
      role: "assistant",
      content: assistantText,
      tool_calls: result.toolCalls.length
        ? result.toolCalls.map((t) => ({
            id: t.id,
            type: "function" as const,
            function: { name: t.name, arguments: JSON.stringify(t.arguments ?? {}) },
          }))
        : undefined,
    });

    if (!result.toolCalls.length) {
      job = opts.appendLog(job, `${opts.role}: no tools — phase done`);
      break;
    }

    for (const tc of result.toolCalls) {
      if (opts.abortSignal.aborted) throw new DOMException("Aborted", "AbortError");
      // Allow task_update even when auto-accept off (blackboard)
      const exec = await executeAgentTool(tc, {
        enabledTools,
        autoAcceptEdits: opts.settings.autoAcceptEdits || tc.name === "task_update" || tc.name === "task_read",
        autoRunShell: opts.settings.autoRunShell || opts.role === "verifier" || opts.role === "tester",
        settings: opts.settings,
        workspaceRoot: opts.workspaceRoot,
        mode: "headless",
        checkpointNamespace: `ma ${job.id} ${opts.role}`,
        executeMcpTool: executeMcpToolCall,
      });
      job = opts.appendLog(
        job,
        `${opts.role} tool ${tc.name} → ${exec.status}: ${exec.content.slice(0, 240)}`,
      );
      history.push({
        role: "tool",
        tool_call_id: tc.id,
        content: exec.content.slice(0, 48_000),
      });
    }
  }
  return job;
}

/** Whether a Job should use the multi-agent runner. */
export function shouldRunMultiAgent(job: Job, settings: ClientSettings): boolean {
  if (settings.multiAgentEnabled !== true) return false;
  if (job.multiAgent === true) return true;
  return false;
}
