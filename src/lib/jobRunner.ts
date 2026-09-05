import { resolveActiveSettings } from "./activeEndpoint";
import { executeAgentTool } from "./agentTools";
import { bridge } from "./bridgeClient";
import { applyGrokEdits, parseGrokEdits } from "./grokLayer";
import {
  buildLargeJobNudge,
  buildReasoningThenBuildNudge,
  buildBuildModeImplementNudge,
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
import { executeMcpToolCall } from "./mcpClient";
import { streamChatCompletion } from "./sse";
import { getJobs, getSettings, getWorkspace, setJobs, uid, upsertJob } from "./storage";
import { workspaceGate } from "./workspaceGuard";
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
  setJobs(getJobs().filter((j) => j.id !== id));
  notify();
}

export function clearFinishedJobs(): void {
  setJobs(getJobs().filter((j) => j.status === "queued" || j.status === "running"));
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
  const turnCap = clampMaxAgentTurns(settings.maxAgentTurns);
  const enabledTools: ToolType[] = [...DEFAULT_ENABLED_TOOLS];
  const active = resolveActiveSettings(settings);

  const large = looksLargeJob(job.prompt);
  const buildProcess = shouldApplyBuildProcess(job.prompt, {
    buildMode: settings.buildModeEnabled !== false,
    planMode: settings.planModeEnabled === true,
  });
  const systemParts = [
    settings.systemPrompt || "",
    workspaceRoot
      ? `Workspace root: ${workspaceRoot}. Prefer relative paths. You are running as a headless background job.`
      : "No workspace root set. Connect the bridge Workspace before relying on file tools.",
    settings.autoAcceptEdits
      ? "Auto-accept edits is ON for this job."
      : "Auto-accept edits is OFF — gated write tools skip in headless mode.",
    settings.autoRunShell ? "Auto-run shell is ON." : "Auto-run shell is OFF — shell skips in headless mode.",
    "The final user-visible answer MUST be in content tokens; reasoning-only is incomplete.",
    "Do not invoke an external grok CLI. This job runner is the harness.",
    buildProcess ? buildReasoningThenBuildNudge() : large ? buildLargeJobNudge() : "",
  ].filter(Boolean);

  if (buildProcess) {
    job = appendLog(job, "build process: reason → ToDo → explore → scaffold → implement → verify");
  } else if (large) {
    job = appendLog(job, "large job protocol: ToDo → explore codebase → implement");
  }

  const history: ChatOpenAiMessage[] = [{ role: "user", content: job.prompt }];
  let turns = 0;
  let buildImplementNudgeUsed = false;

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
      if (finalizeReasoningChannel(bubble, coalesceOn)) {
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
        job = appendLog(job, "no tool calls — done");
        break;
      }

      for (const tc of toolCalls) {
        if (ac.signal.aborted) throw new DOMException("Aborted", "AbortError");
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
        });
        const clip = exec.content.slice(0, 500);
        job = appendLog(job, `${tc.name} → ${exec.status}: ${clip}${exec.content.length > 500 ? "…" : ""}`);
        history.push({
          role: "tool",
          tool_call_id: tc.id,
          content: exec.content.slice(0, 48_000),
        });
      }

      if (turn === turnCap) job = appendLog(job, "hit max agent turns");
    }

    job = persist({
      ...job,
      status: "done",
      endedAt: Date.now(),
      logs: [...job.logs, `[${new Date().toISOString()}] finished (${turns} turn(s))`],
    });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    const msg = aborted ? "cancelled" : e instanceof Error ? e.message : String(e);
    const latest = getJobs().find((j) => j.id === job.id) || job;
    persist({
      ...latest,
      status: "error",
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
