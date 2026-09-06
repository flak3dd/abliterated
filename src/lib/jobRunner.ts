import { resolveActiveSettings } from "./activeEndpoint";
import { executeAgentTool } from "./agentTools";
import { formatSkillsCatalogPrompt, toCatalogEntries } from "./skills";
import { formatAutoLoadedSkillsPrompt, formatProjectMemoryPrompt } from "./projectMemory";
import { bridge } from "./bridgeClient";
import { applyGrokEdits, parseGrokEdits } from "./grokLayer";
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
  clampMaxAgentTurns,
  EMPTY_CONTENT_REPLY_NOTE,
  isMissingContentAnswer,
  looksLargeJob,
  looksLikeBuildOutput,
  liftTodoListToContent,
  parseTodoBullets,
  shouldApplyBuildProcess,
} from "./agentHelpers";
import { finalizeReasoningChannel } from "./agentPhase";
import { enforceThoughtNoCode } from "./reasoningWork";
import { executeMcpToolCall } from "./mcpClient";
import { streamChatCompletion } from "./sse";
import { buildModelAgentProfile } from "./modelAgentProfile";
import { peekFeatherlessModel } from "./featherlessLimits";
import { getJobs, getSettings, getWorkspace, setJobs, uid, upsertJob } from "./storage";
import { workspaceGate } from "./workspaceGuard";
import { TASK_GRAPH_PATH, formatTaskGraphPrompt, parseTaskGraph } from "./taskGraph";
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
    appendLog(job, "cancel requested");
  }
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
  if (settings.jobWorktreesEnabled === true && bridge.connected) {
    try {
      const prep = await prepareJobWorktree({
        enabled: true,
        jobId: job.id,
        workspaceRoot,
        run: async (command) => {
          let out = "";
          const code = await bridge.runCommand(command, (c) => { out += c; });
          return { out, code };
        },
      });
      job = appendLog(job, `worktree: ${prep.note} (${prep.path})`);
    } catch (e) {
      job = appendLog(job, `worktree stub error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const turnCap = clampMaxAgentTurns(settings.maxAgentTurns);
  const enabledTools: ToolType[] = [...DEFAULT_ENABLED_TOOLS];
  const active = resolveActiveSettings(settings);

  const large = looksLargeJob(job.prompt);
  const buildProcess = shouldApplyBuildProcess(job.prompt, {
    buildMode: settings.buildModeEnabled !== false,
    planMode: settings.planModeEnabled === true,
  });
  let skillsCatalogBlock = "";
  let workspaceSkillsBlock = "";
  let projectMemoryBlock = "";
  if (bridge.connected) {
    try {
      const files = await bridge.readProjectMemory();
      projectMemoryBlock = formatProjectMemoryPrompt(files);
    } catch {
      projectMemoryBlock = "";
    }
  }
  if (settings.skillsEnabled !== false && bridge.connected) {
    try {
      const skills = await bridge.listSkills();
      skillsCatalogBlock = formatSkillsCatalogPrompt(toCatalogEntries(skills));
      workspaceSkillsBlock = formatAutoLoadedSkillsPrompt(skills);
    } catch {
      skillsCatalogBlock = "";
      workspaceSkillsBlock = "";
    }
  }

  const deepenCompletenessBlock = buildJobCompletenessSystemBlock({
    deepenCompleteness: settings.deepenCompleteness !== false,
  });
  let taskGraphBlock = "";
  if (bridge.connected) {
    try {
      const raw = await bridge.readFile(TASK_GRAPH_PATH);
      taskGraphBlock = formatTaskGraphPrompt(parseTaskGraph(raw));
    } catch {
      taskGraphBlock = "";
    }
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
  });
  const systemParts = [
    settings.systemPrompt || "",
    projectMemoryBlock,
    !jobProfile.compactPrompt ? skillsCatalogBlock : "",
    !jobProfile.compactPrompt ? workspaceSkillsBlock : "",
    taskGraphBlock,

    workspaceRoot
      ? `Workspace root: ${workspaceRoot}. Prefer relative paths. You are running as a headless background job.`
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
        ? buildReasoningThenBuildNudge()
        : settings.buildModeEnabled !== false
          ? buildBuildModeAlwaysNudge()
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

  if (shouldRunMultiAgent(job, settings)) {
    try {
      job = await runMultiAgentFleet({
        job,
        settings,
        persist,
        appendLog,
        abortSignal: ac.signal,
        workspaceRoot,
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
  let buildVerifyNudgeUsed = false;
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
        flightKey: `job:${job.id}`,
        onDelta: (t) => {
          assistantText += t;
        },
        onReasoningDelta: (t) => {
          assistantReasoning += t;
        },
      });

      if (assistantText.trim()) {
        const clip = assistantText.trim().slice(0, 400);
        job = appendLog(job, `assistant: ${clip}${assistantText.length > 400 ? "…" : ""}`);
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

      if (settings.autoAcceptEdits && bridge.connected) {
        const source = assistantText || assistantReasoning;
        const edits = parseGrokEdits(source, workspaceRoot);
        if (edits.length) {
          const applied = await applyGrokEdits(edits, { autoAccept: true, root: workspaceRoot });
          const n = applied.filter((r) => r.status === 'ok').length;
          job = appendLog(job, `applied ${n}/${applied.length} edit(s)`);
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
          !looksLikeBuildOutput(assistantText)
        ) {
          buildImplementNudgeUsed = true;
          history.push({ role: "user", content: buildBuildModeImplementNudge() });
          job = appendLog(job, "build process: ToDo without diffs — implement nudge");
          continue;
        }
        if (
          (buildProcess || large) &&
          !buildVerifyNudgeUsed &&
          looksLikeBuildOutput(assistantText) &&
          !looksLikeVerifyEvidence(assistantText, toolsUsed)
        ) {
          buildVerifyNudgeUsed = true;
          history.push({ role: "user", content: buildVerifyBeforeDoneNudge() });
          job = appendLog(job, "verify-before-done: implement without verify — nudge");
          continue;
        }
        job = appendLog(job, "no tool calls — done");
        break;
      }

      for (const tc of toolCalls) {
        if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
        toolsUsed.push(tc.name);
        job = appendLog(job, `tool ${tc.name} ${JSON.stringify(tc.arguments).slice(0, 200)}`);
        const exec = await executeAgentTool(tc, {
          enabledTools,
          autoAcceptEdits: settings.autoAcceptEdits,
          autoRunShell: settings.autoRunShell,
          settings,
          workspaceRoot,
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
