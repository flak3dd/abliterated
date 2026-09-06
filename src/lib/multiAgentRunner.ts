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
  detectReplanTriggers,
  fleetComplete,
  pickNextSubtask,
  roleSystemAddendum,
} from "./multiAgent";
import { prepareJobWorktree } from "./jobWorktree";
import { locksFromSubtasks } from "./writeLocks";
import { goalKeeperCheck } from "./goalKeeper";
import { coldVerifierRequiresVerify, buildColdVerifierSystemBlock } from "./verifyDone";
import { formatReplanPrompt } from "./replanTriggers";
import { buildModelAgentProfile } from "./modelAgentProfile";
import { peekFeatherlessModel } from "./featherlessLimits";
import type { ChatOpenAiMessage, ClientSettings, Job, ToolType } from "../types";
import { DEFAULT_ENABLED_TOOLS, PLAN_MODE_TOOLS } from "../types";
import { executeMcpToolCall } from "./mcpClient";
import { assignableNodeCount, multiAgentShouldRun } from "./harnessGates";

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

  let effectiveRoot = workspaceRoot;
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
      if (prep.shouldSetRoot && prep.absPath) {
        try {
          const root = await bridge.setRoot(prep.absPath);
          effectiveRoot = root || prep.absPath;
          job = appendLog(job, `workspace root set to worktree: ${effectiveRoot}`);
        } catch (e) {
          job = appendLog(
            job,
            `worktree setRoot failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    } catch (e) {
      job = appendLog(job, `worktree error: ${e instanceof Error ? e.message : String(e)}`);
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
  job = (await runRoleLoop({
    job,
    settings,
    role: "orchestrator",
    graph,
    persist,
    appendLog,
    abortSignal,
    workspaceRoot: effectiveRoot,
    activeModel: active.defaultModel,
    turnBudget: Math.min(4, turnCap),
    userKickoff:
      `Fleet goal:\n${job.prompt}\n\n` +
      `Current blackboard:\n${formatTaskGraphPrompt(graph)}\n\n` +
      "Update task.json into a concrete DAG (coder/tester/verifier) with successCriteria and lockPath on writers. Do not implement code.",
    planMode,
  })).job;
  graph = await readGraph();

  // Phase 2: worker loop with budgets / heartbeat reclaim / replan
  let rounds = 0;
  const maxRounds = 8;
  const originalGoal = job.prompt;
  while (rounds < maxRounds && !fleetComplete(graph)) {
    if (abortSignal.aborted) throw new DOMException("Aborted", "AbortError");
    rounds += 1;

    const replans = detectReplanTriggers(graph);
    if (replans.length) {
      const ev = replans[0];
      job = appendLog(job, `multi-agent replan: ${ev.reason} ${ev.nodeId || ""}`);
      job = (await runRoleLoop({
        job,
        settings,
        role: "orchestrator",
        graph,
        persist,
        appendLog,
        abortSignal,
        workspaceRoot: effectiveRoot,
        activeModel: active.defaultModel,
        turnBudget: Math.min(3, turnCap),
        userKickoff: formatReplanPrompt(ev) + `\n\nBlackboard:\n${formatTaskGraphPrompt(graph)}`,
        planMode,
      })).job;
      graph = await readGraph();
    }

    let next = pickNextSubtask(graph);
    if (!next) {
      job = appendLog(job, "multi-agent: no ready subtasks — stopping");
      break;
    }
    // If pickNext returned a stale reclaim, reset status via heartbeat
    if (next.status === "pending" || next.status === "in_progress") {
      graph = touchHeartbeat(graph, next.id);
      // budget: increment consumedSteps when starting
      graph = {
        ...graph,
        updatedAt: Date.now(),
        subtasks: graph.subtasks.map((s) =>
          s.id === next!.id
            ? { ...s, consumedSteps: (s.consumedSteps || 0) + 1, status: "in_progress" as const }
            : s,
        ),
      };
      await writeGraph(graph);
    }
    const role = (next.role || "coder") as AgentRole;
    const turnBudget = Math.min(
      turnCap,
      next.maxSteps && next.maxSteps > 0 ? next.maxSteps : turnCap,
    );
    job = persist({ ...job, role });
    job = appendLog(job, `multi-agent phase: ${role} → ${next.id} (budget ${turnBudget})`);
    await appendBus({
      ts: Date.now(),
      type: "assign",
      from: "orchestrator",
      to: role,
      taskId: next.id,
      fleetId: graph.fleetId,
      payload: { text: next.text, lockPath: next.lockPath },
    });

    const coldBlock =
      role === "verifier"
        ? buildColdVerifierSystemBlock({
            nodeId: next.id,
            description: next.text,
            successCriteria: next.successCriteria,
            artifacts: next.artifacts,
          })
        : "";

    const loopResult = await runRoleLoop({
      job,
      settings,
      role,
      graph,
      persist,
      appendLog,
      abortSignal,
      workspaceRoot: effectiveRoot,
      activeModel: active.defaultModel,
      turnBudget,
      userKickoff:
        `You are ${role} on subtask ${next.id}.\n` +
        `${next.text}\n` +
        (next.successCriteria ? `Success: ${next.successCriteria}\n` : "") +
        (next.lockPath ? `Write lock path: ${next.lockPath}\n` : "") +
        `\nBlackboard:\n${formatTaskGraphPrompt(graph)}\n` +
        (coldBlock ? `\n${coldBlock}\n` : "") +
        (role === "verifier"
          ? "CRITIC: you MUST call verify before pass. Reject if evidence missing."
          : "Heartbeat via task_update id+heartbeat. Stay in scope."),
      planMode: planMode && role !== "orchestrator" ? planMode : planMode,
      subtaskId: next.id,
      requireVerify: role === "verifier",
    });
    job = loopResult.job;

    graph = await readGraph();
    if (role === "verifier") {
      const gate = coldVerifierRequiresVerify(loopResult.toolsUsed);
      job = appendLog(job, `cold verifier: ${gate.reason}`);
      if (!gate.ok) {
        // bump verifyFails; do not allow done
        graph = {
          ...graph,
          updatedAt: Date.now(),
          subtasks: graph.subtasks.map((s) =>
            s.id === next!.id
              ? {
                  ...s,
                  status: "blocked" as const,
                  verifyFails: (s.verifyFails || 0) + 1,
                  critiques: [
                    ...(s.critiques || []),
                    {
                      at: Date.now(),
                      role: "verifier",
                      verdict: "reject" as const,
                      note: gate.reason,
                    },
                  ],
                }
              : s,
          ),
        };
        await writeGraph(graph);
      }
      await appendBus({
        ts: Date.now(),
        type: "critique",
        from: "verifier",
        taskId: next.id,
        fleetId: graph.fleetId,
        payload: { round: rounds, verifyOk: gate.ok },
      });
    }
  }

  graph = await readGraph();
  if (fleetComplete(graph)) {
    const evidence = graph.subtasks
      .map((s) => `${s.id} ${s.text} ${(s.artifacts || []).join(" ")} ${(s.critiques || []).map((c) => c.note).join(" ")}`)
      .join("\n");
    const gk = goalKeeperCheck({
      originalGoal,
      graphGoal: graph.goal || "",
      evidenceText: evidence,
    });
    job = appendLog(job, `goal keeper: ${gk.reason}`);
    if (!gk.ok) {
      job = persist({
        ...job,
        status: "incomplete",
        stopReason: "error",
        error: gk.reason,
        endedAt: Date.now(),
      });
      job = appendLog(job, "multi-agent: fleet blocked by goal keeper");
    } else {
      job = persist({
        ...job,
        status: "done",
        stopReason: "done",
        endedAt: Date.now(),
        role: job.role,
      });
      job = appendLog(job, "multi-agent: fleet complete");
    }
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
  requireVerify?: boolean;
}): Promise<{ job: Job; toolsUsed: string[] }> {
  let job = opts.job;
  const toolsUsed: string[] = [];
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
    roleSystemAddendum(opts.role, {
      goal: opts.graph.goal || opts.job.prompt,
      subtask: opts.graph.subtasks.find((s) => s.id === opts.subtaskId),
    }),
    formatTaskGraphPrompt(opts.graph),
    profile.systemAddendum,
    opts.workspaceRoot ? `Workspace root: ${opts.workspaceRoot}` : "",
    opts.requireVerify
      ? "Cold verifier: you MUST call the verify tool before declaring pass."
      : "",
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
      onDelta: (chunk) => {
        assistantText += chunk;
      },
    });

    history.push({
      role: "assistant",
      content: assistantText,
      tool_calls: result.toolCalls.length
        ? result.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
          }))
        : undefined,
    });

    if (!result.toolCalls.length) {
      if (opts.requireVerify && !toolsUsed.includes("verify")) {
        history.push({
          role: "user",
          content:
            "Cold verifier gate: call the verify tool now before finishing. Self-declared pass is not allowed.",
        });
        job = opts.appendLog(job, `${opts.role}: verify required — nudge`);
        continue;
      }
      job = opts.appendLog(job, `${opts.role}: no tools — phase done`);
      break;
    }

    for (const tc of result.toolCalls) {
      if (opts.abortSignal.aborted) throw new DOMException("Aborted", "AbortError");
      toolsUsed.push(tc.name);
      const exec = await executeAgentTool(tc, {
        enabledTools,
        autoAcceptEdits:
          opts.settings.autoAcceptEdits || tc.name === "task_update" || tc.name === "task_read",
        autoRunShell:
          opts.settings.autoRunShell || opts.role === "verifier" || opts.role === "tester",
        settings: opts.settings,
        workspaceRoot: opts.workspaceRoot,
        mode: "headless",
        checkpointNamespace: `ma ${job.id} ${opts.role}`,
        executeMcpTool: executeMcpToolCall,
        writeLocks: locksFromSubtasks(opts.graph.subtasks),
        writeLockOwner: opts.subtaskId || opts.role,
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
  return { job, toolsUsed };
}

/** Whether a Job should use the multi-agent runner. Graph with <2 assignable nodes stays single-agent. */
export function shouldRunMultiAgent(
  job: Job,
  settings: ClientSettings,
  graph?: TaskGraph | null,
): boolean {
  return multiAgentShouldRun({
    multiAgentEnabled: settings.multiAgentEnabled === true,
    jobMultiAgent: job.multiAgent === true,
    hasGraph: !!(graph && graph.subtasks.length),
    assignableNodes: assignableNodeCount(graph),
  });
}
