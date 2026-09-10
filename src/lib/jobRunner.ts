import { resolveActiveSettings } from "./activeEndpoint";
import { executeAgentTool } from "./agentTools";
import { formatSkillsCatalogPrompt, formatVerifyStrictSkillPrompt, shouldAutoInjectVerifyStrict, toCatalogEntries } from "./skills";
import { formatAutoLoadedSkillsPrompt, formatProjectMemoryPrompt } from "./projectMemory";
import { filterPinnedProjectMemory } from "./projectRules";
import { formatSessionMemory, mempalaceOpts } from "./mempalace";
import { bridge } from "./bridgeClient";
import { applyGrokEdits, parseGrokEdits } from "./grokLayer";
import { enqueuePendingEdits } from "./applyInbox";
import { buildJobCompletenessSystemBlock } from "./deepenComplete";
import {
  buildLargeJobNudge,
  buildReasoningThenBuildNudge,
  buildBuildModeAlwaysNudge,
  buildThoughtModeNudge,
  buildPlanModeNudge,
  buildBuildModeImplementNudge,
  buildVerifyBeforeDoneNudge,
  looksLikeVerifyEvidence,
  looksTrivialFileEdit,
  clampMaxAgentTurns,
  EMPTY_CONTENT_REPLY_NOTE,
  isMissingContentAnswer,
  looksLargeJob,
  looksLikeBuildOutput,
  liftTodoListToContent,
  parseTodoBullets,
  shouldApplyBuildProcess,
  filterPlanModeTools,
} from "./agentHelpers";
import { buildProveImproveNudge, shouldProveImproveNudge } from './proveImprove';
import {
  needsInspectBeforeWrite,
  buildInspectBeforeWriteNudge,
  lockedGoalSystemBlock,
} from "./harnessGates";
import { finalizeReasoningChannel, splitThinkFromContent } from "./agentPhase";
import { looksLikeTokenCollapse, stripCollapsedText, TOKEN_COLLAPSE_REPLY_NOTE } from "./tokenCollapse";
import { enforceThoughtNoCode } from "./reasoningWork";
import { executeMcpToolCall, listConnectedMcpTools, mcpToolsToOpenAi } from "./mcpClient";
import {
  planCapabilities,
  needsMcpFollowNudge,
  needsSkillCreateNudge,
  needsSkillReadNudge,
  buildMcpFollowNudge,
  buildSkillCreateNudge,
  buildSkillReadNudge,
} from "./capabilityRouter";
import { streamChatCompletion } from "./sse";
import { buildModelAgentProfile } from "./modelAgentProfile";
import { peekFeatherlessModel } from "./featherlessLimits";
import { getJobs, getSettings, getWorkspace, setJobs, uid, upsertJob } from "./storage";
import { connectedBridgeWriteRoot, workspaceGate } from "./workspaceGuard";
import { TASK_GRAPH_PATH, formatTaskGraphPrompt, parseTaskGraph, shouldUseTaskGraph } from "./taskGraph";
import { prepareJobWorktree } from "./jobWorktree";
import { runMultiAgentFleet, shouldRunMultiAgent } from "./multiAgentRunner";
import type { ChatOpenAiMessage, ClientSettings, Job, ToolType } from "../types";
import { DEFAULT_ENABLED_TOOLS } from "../types";
import { clampJobsByLicense, getLicenseState } from './license';


type Listener = (jobs: Job[]) => void;

const listeners = new Set<Listener>();
const abortById = new Map<string, AbortController>();
const runningIds = new Set<string>();

function projectNameFromRoot(root: string): string {
  const cleaned = root.replace(/[/\\]+$/, "");
  const parts = cleaned.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || "workspace";
}

function notify() {
  const jobs = getJobs();
  listeners.forEach((cb) => cb(jobs));
}

function persist(job: Job): Job {
  upsertJob(job);
  notify();
  return job;
}

function appendLog(job: Job, line: string): Job {
  const stamp = new Date().toISOString();
  return persist({ ...job, logs: [...job.logs, `[${stamp}] ${line}`] });
}

export function subscribeJobs(cb: Listener): () => void {
  listeners.add(cb);
  cb(getJobs());
  return () => listeners.delete(cb);
}

export function enqueueJob(input: {
  prompt: string;
  title?: string;
  threadId?: string;
  projectName?: string;
  multiAgent?: boolean;
}): Job {
  const ws = getWorkspace();
  const root = bridge.validWorkspaceRoot || ws.rootPath || "";
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("prompt required");
  const gate = workspaceGate(root, bridge.currentAppRoot);
  if (!gate.ok) throw new Error(gate.message);

  const job: Job = {
    id: uid("job"),
    projectName: input.projectName || projectNameFromRoot(root),
    title: (input.title || "").trim() || prompt.slice(0, 72),
    prompt,
    threadId: input.threadId,
    status: "queued",
    logs: [`[${new Date().toISOString()}] queued`],
    createdAt: Date.now(),
    multiAgent: input.multiAgent === true || undefined,
  };
  persist(job);
  void pumpQueue();
  return job;
}

export function cancelJob(id: string): void {
  const job = getJobs().find((j) => j.id === id);
  if (!job) return;
  const ac = abortById.get(id);
  if (ac) {
    ac.abort();
    abortById.delete(id);
  }
  if (job.status === "queued") {
    persist({
      ...job,
      status: "error",
      error: "cancelled",
      endedAt: Date.now(),
      logs: [...job.logs, `[${new Date().toISOString()}] cancelled`],
    });
  } else if (job.status === "running") {
    persist({
      ...job,
      status: "error",
      error: "cancelled",
      stopReason: "abort",
      endedAt: Date.now(),
      logs: [...job.logs, `[${new Date().toISOString()}] cancelled`],
    });
  }
}

/** Re-queue a finished/failed job in place. */
export function retryJob(id: string): Job | null {
  const job = getJobs().find((j) => j.id === id);
  if (!job) return null;
  if (job.status === "queued" || job.status === "running") return job;
  persist({
    ...job,
    status: "queued",
    error: undefined,
    stopReason: undefined,
    endedAt: undefined,
    logs: [...job.logs, `[${new Date().toISOString()}] retry queued`],
  });
  void pumpQueue();
  return job;
}

/** Promote a chat prompt onto the Jobs queue. */
export function enqueueChatAsJob(opts: { prompt: string; threadId?: string; title?: string }): Job {
  return enqueueJob({
    prompt: opts.prompt,
    threadId: opts.threadId,
    title: opts.title || opts.prompt.slice(0, 72),
  });
}

export function deleteJob(id: string): void {
  cancelJob(id);
  setJobs(getJobs().filter((j) => j.id !== id));
  notify();
}

export function clearFinishedJobs(): void {
  setJobs(getJobs().filter((j) => j.status === "queued" || j.status === "running")); // clears done/error/incomplete
  notify();
}

async function pumpQueue() {
  const settingsNow = getSettings();
  const license = getLicenseState(settingsNow);
  const cap = clampJobsByLicense(settingsNow.maxConcurrentJobs, license);
  while (runningIds.size < cap) {
    const next = getJobs().find((j) => j.status === "queued" && !runningIds.has(j.id));
    if (!next) break;
    runningIds.add(next.id);
    void runJob(next, getSettings()).finally(() => {
      runningIds.delete(next.id);
      void pumpQueue();
    });
  }
}

async function runJob(initial: Job, settings: ClientSettings) {
  let job = persist({
    ...initial,
    status: "running",
    startedAt: Date.now(),
    error: undefined,
  });
  job = appendLog(job, "starting agent run");
  const peers = runningIds.size - 1;
  if (peers > 0) {
    job = appendLog(
      job,
      `parallel run: ${peers} other job(s) active — jobs share workspace root ${bridge.currentRoot || "(unset)"}; checkpoints are labelled with this job id`,
    );
  }

  const ac = new AbortController();
  abortById.set(job.id, ac);

  const ws = getWorkspace();
  const workspaceRoot = bridge.validWorkspaceRoot || ws.rootPath || "";
  const gate = workspaceGate(workspaceRoot, bridge.currentAppRoot);
  if (!gate.ok) {
    persist({
      ...job,
      status: "error",
      error: gate.message,
      endedAt: Date.now(),
      logs: [...job.logs, `[${new Date().toISOString()}] ${gate.message}`],
    });
    abortById.delete(job.id);
    return;
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
          const code = await bridge.runCommand(command, (c) => { out += c; }, { root: workspaceRoot });
          return { out, code };
        },
      });
      job = appendLog(job, `worktree: ${prep.note} (${prep.path})`);
      if (prep.shouldSetRoot && prep.absPath) {
        effectiveRoot = prep.absPath;
        job = appendLog(job, `workspace root set to worktree: ${effectiveRoot}`);
      }
    } catch (e) {
      job = appendLog(job, `worktree error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const turnCap = clampMaxAgentTurns(settings.maxAgentTurns);
  const enabledTools: ToolType[] =
    settings.planModeEnabled === true
      ? filterPlanModeTools(DEFAULT_ENABLED_TOOLS)
      : [...DEFAULT_ENABLED_TOOLS];
  const active = resolveActiveSettings(settings);

  const large = looksLargeJob(job.prompt);
  const buildProcess = shouldApplyBuildProcess(job.prompt, {
    buildMode: settings.buildModeEnabled !== false,
    planMode: settings.planModeEnabled === true,
  });
  let skillsCatalogBlock = "";
  let workspaceSkillsBlock = "";
  let verifyStrictBlock = "";
  let projectMemoryBlock = "";
  let mempalaceBlock = "";
  let listedSkills: Awaited<ReturnType<typeof bridge.listSkills>> = [];
  if (bridge.connected) {
    try {
      const files = await bridge.readProjectMemory();
      projectMemoryBlock = formatProjectMemoryPrompt(
        filterPinnedProjectMemory(files, settings.projectRulesPinned !== false),
      );
    } catch {
      projectMemoryBlock = "";
    }
    if (settings.mempalaceEnabled !== false && settings.mempalaceAutoRecall !== false) {
      try {
        mempalaceBlock = await bridge.mempalaceWake(mempalaceOpts(settings, workspaceRoot));
      } catch {
        mempalaceBlock = "";
      }
    }
  }
  if (settings.skillsEnabled !== false && bridge.connected) {
    try {
      listedSkills = await bridge.listSkills();
      skillsCatalogBlock = formatSkillsCatalogPrompt(toCatalogEntries(listedSkills));
      workspaceSkillsBlock = formatAutoLoadedSkillsPrompt(listedSkills);
    } catch {
      skillsCatalogBlock = "";
      workspaceSkillsBlock = "";
      listedSkills = [];
    }
  }

  const deepenCompletenessBlock = buildJobCompletenessSystemBlock({
    deepenCompleteness: settings.deepenCompleteness !== false,
  });

  if (
    shouldAutoInjectVerifyStrict({
      buildProcess,
      largeJob: large,
      verifyStrictProfile: settings.verifyStrictProfile === true,
    })
  ) {
    verifyStrictBlock = formatVerifyStrictSkillPrompt(listedSkills as never, { force: true });
    if (verifyStrictBlock) job = appendLog(job, "auto-injected verify-strict skill");
  }

  let taskGraphBlock = "";
  let existingGraph = null as ReturnType<typeof parseTaskGraph>;
  if (bridge.connected) {
    try {
      existingGraph = parseTaskGraph(await bridge.readFile(TASK_GRAPH_PATH));
    } catch {
      existingGraph = null;
    }
  }
  const useGraph = shouldUseTaskGraph({
    largeJob: large,
    buildProcess,
    multiAgent: shouldRunMultiAgent(job, settings, existingGraph),
    hasExistingGraph: !!(existingGraph && (existingGraph.goal.trim() || existingGraph.subtasks.length)),
  });
  if (useGraph && existingGraph) {
    taskGraphBlock = formatTaskGraphPrompt(existingGraph);
  } else if (!useGraph) {
    job = appendLog(job, "one-shot: skipping task graph inject");
  }
  const jobPeek = peekFeatherlessModel(active.defaultModel);
  const jobProfile = buildModelAgentProfile({
    model: active.defaultModel,
    provider: active.provider,
    reasoning: settings.reasoning,
    planMode: settings.planModeEnabled === true,
    buildMode: settings.buildModeEnabled !== false,
    toolUse: jobPeek?.toolUse,
    contextLength: jobPeek?.contextLength,
    enabledTools,
    workspaceRoot: effectiveRoot || workspaceRoot,
  });
  const capPlan = planCapabilities({
    queryText: job.prompt,
    skills: listedSkills as never,
    mcpTools: listConnectedMcpTools(),
    skillsEnabled: settings.skillsEnabled !== false,
    allowAllMcp: jobProfile.allowMcp && settings.planModeEnabled !== true,
    canWriteSkill:
      settings.planModeEnabled !== true &&
      settings.autoAcceptEdits === true &&
      jobProfile.toolTier === "full",
    excludeSkillIds: verifyStrictBlock ? ["verify-strict"] : [],
  });
  const extraMcpTools = capPlan.extraMcp.length
    ? mcpToolsToOpenAi(capPlan.extraMcp)
    : jobProfile.allowMcp
      ? mcpToolsToOpenAi(listConnectedMcpTools())
      : [];
  const systemParts = [
    settings.systemPrompt || "",
    projectMemoryBlock,
    mempalaceBlock,
    lockedGoalSystemBlock(job.prompt),
    !jobProfile.compactPrompt ? skillsCatalogBlock : "",
    !jobProfile.compactPrompt ? workspaceSkillsBlock : "",
    verifyStrictBlock,
    capPlan.systemBlock,
    taskGraphBlock,

    effectiveRoot
      ? `Workspace root: ${effectiveRoot}. Prefer relative paths. You are running as a headless background job.`
      : "No workspace root set. Connect the bridge Workspace before relying on file tools.",
    settings.autoAcceptEdits
      ? "Auto-accept edits is ON for this job."
      : "Auto-accept edits is OFF — gated write tools skip in headless mode.",
    settings.autoRunShell ? "Auto-run shell is ON." : "Auto-run shell is OFF — shell skips in headless mode.",
    deepenCompletenessBlock,
    jobProfile.systemAddendum,
    jobProfile.useThoughtLock ? buildThoughtModeNudge() : '',
    settings.planModeEnabled === true ? buildPlanModeNudge() : '',
    settings.planModeEnabled === true
      ? ''
      : buildProcess
        ? buildReasoningThenBuildNudge({ toolsOff: !jobProfile.sendTools })
        : settings.buildModeEnabled !== false
          ? buildBuildModeAlwaysNudge({ toolsOff: !jobProfile.sendTools })
          : large
            ? buildLargeJobNudge()
            : '',
  ].filter(Boolean);

  if (projectMemoryBlock) job = appendLog(job, "auto-loaded project AGENTS.md / convention files");
  if (workspaceSkillsBlock) job = appendLog(job, "auto-loaded workspace .ablit/skills");
  if (deepenCompletenessBlock) {
    job = appendLog(job, "deepen for completeness (Abliterated-only) checklist active");
  }
  if (buildProcess) {
    job = appendLog(job, "build process: reason → ToDo → explore → scaffold → implement → verify");
  } else if (large) {
    job = appendLog(job, "large job protocol: ToDo → explore codebase → implement");
  }
  if (capPlan.matchedSkills.length) {
    job = appendLog(
      job,
      `matched skills: ${capPlan.matchedSkills.map((s) => s.id).join(", ")}`,
    );
  }
  if (capPlan.extraMcp.length) {
    job = appendLog(job, `matched MCP: ${capPlan.extraMcp.slice(0, 6).map((t) => t.namespaced).join(", ")}`);
  }
  if (capPlan.suggestNewSkill) job = appendLog(job, "skill create: no matching recipe — will nudge");

  if (shouldRunMultiAgent(job, settings, existingGraph)) {
    try {
      job = await runMultiAgentFleet({
        job,
        settings,
        persist,
        appendLog,
        abortSignal: ac.signal,
        workspaceRoot: effectiveRoot,
      });
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      const msg = aborted ? "cancelled" : e instanceof Error ? e.message : String(e);
      job = persist({
        ...job,
        status: "error",
        stopReason: aborted ? "abort" : "error",
        error: msg,
        endedAt: Date.now(),
        logs: [...job.logs, `[${new Date().toISOString()}] multi-agent ${aborted ? "cancelled" : "error: " + msg}`],
      });
    } finally {
      abortById.delete(job.id);
    }
    return;
  }

  const history: ChatOpenAiMessage[] = [{ role: "user", content: job.prompt }];
  let turns = 0;
  let buildImplementNudgeUsed = false;
  let proveImproveNudgeUsed = false;
  let buildVerifyNudgeUsed = false;
  let inspectBeforeWriteUsed = false;
  let mcpFollowNudgeUsed = false;
  let skillCreateNudgeUsed = false;
  let skillReadNudgeUsed = false;
  let hitCap = false;
  const toolsUsed: string[] = [];

  try {
    for (let turn = 1; turn <= turnCap; turn++) {
      if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
      turns = turn;
      job = appendLog(job, `turn ${turn}/${turnCap}`);

      let assistantText = "";
      let assistantReasoning = "";
      const result = await streamChatCompletion({
        settings,
        model: active.defaultModel,
        messages: [{ role: "system", content: systemParts.join("\n\n") }, ...history],
        abortSignal: ac.signal,
        enabledTools,
        extraTools: extraMcpTools.length
          ? (extraMcpTools as Parameters<typeof streamChatCompletion>[0]['extraTools'])
          : undefined,
        toolChoice: turn === 1 && capPlan.forceTools ? "required" : "auto",
        flightKey: `job:${job.id}`,
        onDelta: (t) => {
          assistantText += t;
        },
        onReasoningDelta: (t) => {
          assistantReasoning += t;
        },
        onReset: () => {
          assistantText = "";
          assistantReasoning = "";
        },
      });

      if (assistantText.trim()) {
        const clip = assistantText.trim().slice(0, 400);
        job = appendLog(job, `assistant: ${clip}${assistantText.length > 400 ? "…" : ""}`);
      }

      const splitThink = splitThinkFromContent(assistantText);
      if (splitThink.thinking) {
        assistantReasoning = [assistantReasoning, splitThink.thinking].filter(Boolean).join('\n\n');
        assistantText = splitThink.content;
      }
      assistantText = stripCollapsedText(assistantText);
      assistantReasoning = stripCollapsedText(assistantReasoning);
      if (result.tokenCollapsed && isMissingContentAnswer(assistantText)) {
        assistantText = TOKEN_COLLAPSE_REPLY_NOTE;
        if (looksLikeTokenCollapse(assistantReasoning)) assistantReasoning = "";
      }

      // Finalize/coalesce BEFORE applyGrokEdits so diffs in reasoning are promoted first.
      const coalesceOn = settings.coalesceReasoningToContent !== false;
      const bubble = { content: assistantText, reasoning: assistantReasoning || undefined };
      enforceThoughtNoCode(bubble, { liftToContent: settings.planModeEnabled !== true });
      assistantText = bubble.content;
      assistantReasoning = bubble.reasoning || "";
      if (finalizeReasoningChannel(bubble, coalesceOn && settings.planModeEnabled !== true)) {
        assistantText = bubble.content;
        assistantReasoning = bubble.reasoning || "";
        job = appendLog(
          job,
          bubble.reasoning === undefined
            ? "coalesced/finalized reasoning → content (zero-cost)"
            : "coalesce promote failed — hard error content",
        );
      }
      assistantText = liftTodoListToContent(assistantText, assistantReasoning);
      if ((buildProcess || large) && (!job.todos || job.todos.length === 0)) {
        const todos = parseTodoBullets(assistantText);
        if (todos.length) {
          job = persist({ ...job, todos });
          job = appendLog(job, `todo (${todos.length}): ${todos.join(" · ")}`);
        }
      }

      if (bridge.connected && settings.planModeEnabled !== true) {
        const source = assistantText || assistantReasoning;
        // Fast path: skip heavy parsing if no code blocks or diffs exist
        if (!source.includes('```') && !source.includes('@@')) {
          // no edits to apply
        } else {
          const edits = parseGrokEdits(source, workspaceRoot);
        if (edits.length) {
          const applied = await applyGrokEdits(edits, {
            writeToWorkspace: true,
            autoAccept: settings.autoAcceptEdits === true,
            root: connectedBridgeWriteRoot({
              workspaceRoot: effectiveRoot,
              appRoot: bridge.currentAppRoot,
              bridgeRoot: bridge.validWorkspaceRoot || bridge.currentRoot,
            }) || effectiveRoot,
          });
          const pending = edits.filter((_, i) => applied[i]?.status === 'pending');
          if (pending.length) enqueuePendingEdits(pending, `job:${job.id}`);
          const n = applied.filter((r) => r.status === 'ok').length;
          const p = applied.filter((r) => r.status === 'pending').length;
          job = appendLog(
            job,
            p
              ? `wrote ${n}/${applied.length} file(s); ${p} pending in Apply inbox (auto-accept off)`
              : `wrote ${n}/${applied.length} file(s) to workspace`,
          );
        }
        }
      }

      const toolCalls = result.toolCalls;
      history.push({
        role: "assistant",
        content: assistantText,
        reasoning_content: assistantReasoning.trim() ? assistantReasoning : undefined,
        tool_calls: toolCalls.length
          ? toolCalls.map((t) => ({
              id: t.id,
              type: "function" as const,
              function: { name: t.name, arguments: JSON.stringify(t.arguments ?? {}) },
            }))
          : undefined,
      });

      if (!toolCalls.length) {
        if (result.tokenCollapsed || assistantText === TOKEN_COLLAPSE_REPLY_NOTE) {
          job = appendLog(job, "token collapse — stopping");
          break;
        }
        if (isMissingContentAnswer(assistantText)) {
          const hasReasoning = !!(assistantReasoning || "").trim();
          if (!hasReasoning) {
            assistantText = EMPTY_CONTENT_REPLY_NOTE;
            const last = history[history.length - 1];
            if (last && last.role === "assistant") {
              last.content = assistantText;
            }
            job = appendLog(job, "empty content and reasoning — stopping");
          } else if (!coalesceOn) {
            job = appendLog(job, "content empty; coalesce off — keeping reasoning only");
          }
        }
        if (
          buildProcess &&
          !buildImplementNudgeUsed &&
          parseTodoBullets(assistantText).length > 0 &&
          !looksLikeBuildOutput(assistantText, toolsUsed)
        ) {
          buildImplementNudgeUsed = true;
          history.push({
            role: "user",
            content: buildBuildModeImplementNudge({ toolsOff: !jobProfile.sendTools }),
          });
          job = appendLog(job, "build process: ToDo without diffs — implement nudge");
          continue;
        }
        const toolEvidence = history
          .filter((m) => m.role === "tool")
          .map((m) => m.content || "")
          .join("\n");
        if (
          (buildProcess || large) &&
          !buildVerifyNudgeUsed &&
          looksLikeBuildOutput(assistantText, toolsUsed) &&
          !looksLikeVerifyEvidence(`${assistantText}\n${toolEvidence}`, toolsUsed)
        ) {
          buildVerifyNudgeUsed = true;
          history.push({ role: "user", content: buildVerifyBeforeDoneNudge() });
          job = appendLog(job, "verify-before-done: implement without verify — nudge");
          continue;
        }
        if (
          !settings.planModeEnabled &&
          !proveImproveNudgeUsed &&
          shouldProveImproveNudge({
            userText: job.prompt,
            content: assistantText,
            toolsUsed,
          })
        ) {
          proveImproveNudgeUsed = true;
          history.push({ role: "user", content: buildProveImproveNudge() });
          job = appendLog(job, "prove-improve: no evidence — nudge");
          continue;
        }
        if (
          settings.planModeEnabled !== true &&
          !mcpFollowNudgeUsed &&
          needsMcpFollowNudge(capPlan, toolsUsed)
        ) {
          mcpFollowNudgeUsed = true;
          history.push({ role: "user", content: buildMcpFollowNudge(capPlan) });
          job = appendLog(job, "mcp-follow: matching MCP unused — nudge");
          continue;
        }
        if (
          settings.planModeEnabled !== true &&
          !skillReadNudgeUsed &&
          needsSkillReadNudge(capPlan, toolsUsed)
        ) {
          skillReadNudgeUsed = true;
          history.push({ role: "user", content: buildSkillReadNudge(capPlan) });
          job = appendLog(job, "skill-follow: matching skill unused — nudge");
          continue;
        }
        if (
          settings.planModeEnabled !== true &&
          !skillCreateNudgeUsed &&
          needsSkillCreateNudge(capPlan, toolsUsed)
        ) {
          skillCreateNudgeUsed = true;
          history.push({ role: "user", content: buildSkillCreateNudge(capPlan) });
          job = appendLog(job, "skill-create: reusable process missing — nudge");
          continue;
        }
        job = appendLog(job, "no tool calls — done");
        break;
      }

      if (
        settings.planModeEnabled !== true &&
        !inspectBeforeWriteUsed &&
        needsInspectBeforeWrite({
          userText: job.prompt,
          toolsUsed,
          pendingToolNames: toolCalls.map((t) => t.name),
          trivialEdit: looksTrivialFileEdit(job.prompt),
        })
      ) {
        inspectBeforeWriteUsed = true;
        const last = history[history.length - 1];
        if (last && last.role === "assistant") delete last.tool_calls;
        history.push({ role: "user", content: buildInspectBeforeWriteNudge() });
        job = appendLog(job, "inspect-before-write: first write without explore — nudge");
        continue;
      }

      // Split tools into safe parallel tools and gated sequential tools
      const gatedToolNames = new Set(['git_commit', 'create_pr', 'checkpoint_restore', 'shell', 'verify']);
      const parallelTools: typeof toolCalls = [];
      const sequentialTools: typeof toolCalls = [];

      for (const tc of toolCalls) {
        toolsUsed.push(tc.name);
        if (gatedToolNames.has(tc.name)) {
          sequentialTools.push(tc);
        } else {
          parallelTools.push(tc);
        }
      }

      // Execute safe tools in parallel first
      if (parallelTools.length > 0) {
        job = appendLog(job, `executing ${parallelTools.length} tools in parallel`);

        const results = await Promise.all(
          parallelTools.map(async (tc) => {
            if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
            job = appendLog(job, `tool ${tc.name} ${JSON.stringify(tc.arguments).slice(0, 200)}`);
            const exec = await executeAgentTool(tc, {
              enabledTools,
              autoAcceptEdits: settings.autoAcceptEdits,
              autoRunShell: settings.autoRunShell,
              settings,
              workspaceRoot: effectiveRoot,
              mode: "headless",
              checkpointNamespace: `job ${job.id}`,
              executeMcpTool: executeMcpToolCall,
              todoItems: (job.todos || []).map((text) => {
                const m = text.match(/^\[([xX ])\]\s*(.*)$/);
                if (m) return { text: (m[2] || '').trim() || text, done: m[1].toLowerCase() === 'x' };
                return { text, done: false };
              }),
              onTodos: (items) => {
                job = persist({
                  ...job,
                  todos: items.map((t) => (t.done ? `[x] ${t.text}` : t.text)),
                });
              },
            });
            return { tc, exec };
          })
        );

        // Process results
        for (const { tc, exec } of results) {
          const clip = exec.content.slice(0, 500);
          job = appendLog(job, `${tc.name} → ${exec.status}: ${clip}${exec.content.length > 500 ? "…" : ""}`);
          history.push({
            role: "tool",
            tool_call_id: tc.id,
            content: exec.content.slice(0, 48_000),
          });
        }
      }

      // Execute gated tools sequentially
      for (const tc of sequentialTools) {
        if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
        job = appendLog(job, `tool ${tc.name} ${JSON.stringify(tc.arguments).slice(0, 200)}`);
        const exec = await executeAgentTool(tc, {
          enabledTools,
          autoAcceptEdits: settings.autoAcceptEdits,
          autoRunShell: settings.autoRunShell,
          settings,
          workspaceRoot: effectiveRoot,
          mode: "headless",
          checkpointNamespace: `job ${job.id}`,
          executeMcpTool: executeMcpToolCall,
          todoItems: (job.todos || []).map((text) => {
            const m = text.match(/^\[([xX ])\]\s*(.*)$/);
            if (m) return { text: (m[2] || '').trim() || text, done: m[1].toLowerCase() === 'x' };
            return { text, done: false };
          }),
          onTodos: (items) => {
            job = persist({
              ...job,
              todos: items.map((t) => (t.done ? `[x] ${t.text}` : t.text)),
            });
          },
        });
        const clip = exec.content.slice(0, 500);
        job = appendLog(job, `${tc.name} → ${exec.status}: ${clip}${exec.content.length > 500 ? "…" : ""}`);
        history.push({
          role: "tool",
          tool_call_id: tc.id,
          content: exec.content.slice(0, 48_000),
        });
      }

      if (turn === turnCap) {
        hitCap = true;
        job = appendLog(job, "hit max agent turns");
      }
    }

    if (hitCap) {
      job = persist({
        ...job,
        status: "incomplete",
        stopReason: "cap",
        error: `hit max agent turns (${turnCap})`,
        endedAt: Date.now(),
        logs: [
          ...job.logs,
          `[${new Date().toISOString()}] incomplete: max agent turns (${turns}/${turnCap})`,
        ],
      });
    } else {
      job = persist({
        ...job,
        status: "done",
        stopReason: "done",
        endedAt: Date.now(),
        logs: [...job.logs, `[${new Date().toISOString()}] finished (${turns} turn(s))`],
      });
      if (settings.mempalaceEnabled !== false && settings.mempalaceAutoSave !== false && bridge.connected) {
        const lastAsst = [...history].reverse().find((m) => m.role === "assistant");
        const payload = formatSessionMemory(job.prompt || "", lastAsst?.content || "", {
          model: active.defaultModel,
          thread: `job ${job.id}`,
        });
        if (payload.trim()) {
          try {
            await bridge.mempalaceSave(payload, {
              ...mempalaceOpts(settings, workspaceRoot),
              room: "abliterated-jobs",
            });
            job = appendLog(job, "filed session into MemPalace");
          } catch (e) {
            job = appendLog(
              job,
              `MemPalace save skipped: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      }
    }
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    const msg = aborted ? "cancelled" : e instanceof Error ? e.message : String(e);
    const latest = getJobs().find((j) => j.id === job.id) || job;
    persist({
      ...latest,
      status: "error",
      stopReason: aborted ? "abort" : "error",
      error: msg,
      endedAt: Date.now(),
      logs: [...latest.logs, `[${new Date().toISOString()}] ${aborted ? "cancelled" : "error: " + msg}`],
    });
  } finally {
    abortById.delete(job.id);
  }
}

export function resumeJobQueue(): void {
  void pumpQueue();
}
