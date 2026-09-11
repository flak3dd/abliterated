import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSyncedRef } from './useSyncedRef';
import { raceAbort } from '../lib/raceAbort';
import { assembleSystemPrompt, COMPACT_SYSTEM_MAX_CHARS } from '../lib/systemPromptBudget';
import { buildDeepenNowPrompt } from '../lib/deepenComplete';
import {
  agentPhaseLabel,
  agentPhaseShortLabel,
  finalizeReasoningChannel,
  splitThinkFromContent,
  stripThinkingWrappers,
  type AgentPhase,
  type AgentPhaseMeta,
} from '../lib/agentPhase';
import { bridge, type BridgeStatus } from '../lib/bridgeClient';
import { connectedBridgeWriteRoot, shouldWriteWorkspaceFiles, workspaceGate } from '../lib/workspaceGuard';
import {
  applyGrokEdits,
  dedupeEditsByToolTargets,
  formatGrokStatus,
  hasNonShellCodeFences,
  isPathInsideRoot,
  noteFileApplied,
  parseGrokEdits,
  type GrokApplyResult,
} from '../lib/grokLayer';
import { resolveActiveSettings } from '../lib/activeEndpoint';
import {
  buildMidRunIntegrateNudge,
  buildSelfDeepenNudge,
  canResumeAfterTool,
  clampMaxAgentTurns,
  clampSelfDeepenPasses,
  extractAtPins,
  extractSearchTokens,
  formatIdleSubtitle,
  buildVerifyBeforeDoneNudge,
  looksLikeVerifyEvidence,
  buildIncompleteCapNote,
  isAnswerCompleteMarker,
  isMissingContentAnswer,
  isMidRunMessageContent,
  MAX_AGENT_TURNS_HARD_CAP,
  MID_RUN_PREFIX,
  EMPTY_CONTENT_REPLY_NOTE,
  stripAnswerCompleteMarker,
  type AgentStopReason,
  buildLargeJobNudge,
  looksLargeJob,
  buildPlanModeNudge,
  buildThoughtModeNudge,
  buildBuildModeAlwaysNudge,
  filterModeTools,
  buildModeNudge,
  parseTodoItems,
  type TodoItem,
  looksExploreIntent,
  looksReadOnlyOrControlPrompt,
  looksFactualQuestion,
  hasBuildFileWrites,
  shouldApplyBuildProcess,
  shouldPrefetchWorkspace,
  buildReasoningThenBuildNudge,
  buildBuildModeTodoNudge,
  buildBuildModeImplementNudge,
  buildPlaceholderCodeNudge,
  liftTodoListToContent,
  looksLikeBuildOutput,
  looksLikePlaceholderOutput,
  shouldSkipSelfDeepen,
  looksTrivialFileEdit,
  looksPromptOnlyRequest,
  type AgentRunRecord,
} from '../lib/agentHelpers';
import {
  buildTurnPlan,
  buildTurnSteps,
  collectTurnFiles,
  syncStepsFromRun,
  type PlanItem,
  type WorkflowStep,
} from '../lib/turnWorkflow';
import { buildProveImproveNudge, buildRunProof, shouldProveImproveNudge } from '../lib/proveImprove';
import {
  needsInspectBeforeWrite,
  buildInspectBeforeWriteNudge,
  shouldEvidenceDeepen,
  extractLockedGoal,
  lastOperatorPrompt,
  lockedGoalSystemBlock,
  hasOpenTodos,
  type RunProof,
} from '../lib/harnessGates';
import {
  PLAN_CODE_OMITTED_NOTE,
  liftReasoningWork,
  stripImplementationFromText,
  enforceThoughtNoCode,
  reasoningStepsNotExecuted,
  buildReasoningExecuteNudge,
} from '../lib/reasoningWork';
import { hasValidCompletionFooter } from '../lib/completionFooter';
import { auditTurnChanges } from '../lib/changeAudit';
import { asStringList, executeAgentTool, runWorkspaceDiagnostics, toolArgString } from '../lib/agentTools';
import { buildModePromptSection } from '../lib/systemPrompt';
import { executeMcpToolCall, listConnectedMcpTools, mcpToolsToOpenAi, isMcpToolName } from '../lib/mcpClient';
import {
  planCapabilities,
  needsMcpFollowNudge,
  needsSkillCreateNudge,
  needsSkillReadNudge,
  buildMcpFollowNudge,
  buildSkillCreateNudge,
  buildSkillReadNudge,
  type CapabilityPlan,
} from '../lib/capabilityRouter';
import { buildFakeToolNudge, looksLikeFakeToolTheater, looksLikeToolRetryNarration, parseFakeToolCalls } from '../lib/fakeToolCalls';
import { detokenizeArtifacts } from '../lib/detokenizeArtifacts';
import { streamChatCompletion } from '../lib/sse';
import { looksLikeTokenCollapse, stripCollapsedText, TOKEN_COLLAPSE_REPLY_NOTE } from '../lib/tokenCollapse';
import { getMessages, recordAgentRun, replaceThreadMessages, saveMessage, setSettings, uid, upsertThread } from '../lib/storage';
import { formatSkillsCatalogPrompt, formatVerifyStrictSkillPrompt, shouldAutoInjectVerifyStrict, toCatalogEntries, type SkillCatalogEntry, type SkillRecord } from '../lib/skills';
import { formatAutoLoadedSkillsPrompt, formatProjectMemoryPrompt } from '../lib/projectMemory';
import { filterPinnedProjectMemory } from '../lib/projectRules';
import { enqueuePendingEdits } from '../lib/applyInbox';
import { formatSessionMemory, mempalaceOpts } from '../lib/mempalace';
import { buildModelAgentProfile } from '../lib/modelAgentProfile';
import { peekFeatherlessModel } from '../lib/featherlessLimits';
import { TASK_GRAPH_PATH, formatTaskGraphPrompt, parseTaskGraph, shouldUseTaskGraph } from '../lib/taskGraph';
import type {
  ChatOpenAiMessage,
  ClientSettings,
  Message,
  Thread,
  ToolCallPayload,
  AgentMode,
} from '../types';



/** Render at most this many newest messages; older ones load on demand. */
export const MESSAGE_WINDOW = 80;

/** Cheap, stable string hash used as a capability-plan cache key. */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/** Strip Qwen/R1 think wrappers before theater / build / deepen heuristics. */
function stripThinkForDetect(text: string): string {
  const withoutBlocks = (text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/<\/?think>/gi, ' ');
  return stripThinkingWrappers(withoutBlocks);
}

/** Named hard clamp; effective turns come from settings.maxAgentTurns. */
const MAX_AGENT_TURNS_CLAMP = MAX_AGENT_TURNS_HARD_CAP; // named hard clamp alias
const STATE_THROTTLE_MS = 80;
const SAVE_DEBOUNCE_MS = 150;

function grokSource(content: string, reasoning?: string, root?: string): string {
  if (parseGrokEdits(content, root).length) return content;
  if (reasoning && parseGrokEdits(reasoning, root).length) return reasoning;
  if (!content.trim() && reasoning && (reasoning.includes('```') || reasoning.includes('@@'))) {
    return reasoning;
  }
  return content;
}

/** Plan mode: keep outline/checklist; drop code that leaked into reasoning or content. */
function applyPlanReasoningGuard(assistant: Message): void {
  if (assistant.reasoning) {
    const planReason = stripImplementationFromText(stripThinkingWrappers(assistant.reasoning));
    assistant.reasoning = planReason || undefined;
  }
  const planText = stripImplementationFromText(assistant.content || '');
  if (planText) {
    assistant.content = planText;
  } else if (liftReasoningWork(assistant.content || '')) {
    assistant.content = PLAN_CODE_OMITTED_NOTE;
  } else if (!(assistant.content || '').trim() && (assistant.reasoning || '').trim()) {
    assistant.content = assistant.reasoning || '';
    assistant.reasoning = undefined;
  }
}

function grokAutoAcceptSuffix(workspaceRoot: string): string {
  const root = workspaceRoot.trim() || '.';
  return `Workspace writes are ON. Every code file must land under the connected bridge filepath ${root} via write_file or path-headed fences/diffs (ws://127.0.0.1:17322). Do not leave source only in chat. Shell still needs Run unless auto-run is on.`;
}

/** Cap tool results in API payloads (full text still kept in UI/storage). */
const MAX_API_TOOL_CHARS = 8_000;

function truncateForApi(content: string): string {
  if (!content || content.length <= MAX_API_TOOL_CHARS) return content;
  return `${content.slice(0, MAX_API_TOOL_CHARS)}\n/* truncated for API (${content.length} chars) */`;
}

function liveWorkspaceSuffix(root: string, toolsOff: boolean): string {
  const dest = root.trim()
    ? `the connected bridge filepath ${root}`
    : 'the connected bridge workspace';
  if (toolsOff) {
    return (
      `Live workspace. Files land this turn on ${dest} via \`\`\`diff / // relative/path fences in CONTENT — ` +
      'the client writes them through ws://127.0.0.1:17322. Do not call write_file. Chat-only source is a failed build. ' +
      'Answers in content. Reasoning is outline only — never code, diffs, bash, or // path files.'
    );
  }
  return (
    `Live workspace. Files land this turn on ${dest}: call write_file, or put the full file in CONTENT as \`\`\`diff / // relative/path (first line // path). ` +
    'Both are applied automatically through the localhost bridge — do not wait for a click, do not paste tool JSON, do not describe a retry. ' +
    'Chat-only source is a failed build. Call list_dir/glob/read_file/grep — do not fake ls/tree in bash. Answers in content. ' +
    'Reasoning is outline only — never code, diffs, bash, or // path files.'
  );
}

const PATH_MENTION_RE =
  /(?:^|[\s`'"(])((?:src|lib|app|daemon|public|tests?|scripts?|components?|screens?)\/[\w./+-]+|[\w./-]*package\.json|[\w./-]*tsconfig[\w./-]*|[\w./+-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|html|py|rs|go|toml|ya?ml))\b/gi;

function extractMentionedPaths(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(PATH_MENTION_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = (m[1] || '').replace(/[.,;:]+$/, '');
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

async function prefetchPinnedPaths(text: string, root: string): Promise<string[]> {
  if (!bridge.connected) return [];
  const pins = extractAtPins(text).filter((p) => isPathInsideRoot(p, root || undefined)).slice(0, 8);
  if (!pins.length) return [];
  const parts = await Promise.all(
    pins.map(async (pin) => {
      try {
        const entries = await bridge.listDir(pin).catch(() => null);
        if (entries) {
          const listing = entries
            .slice(0, 80)
            .map((e) => `${e.dir ? 'd' : 'f'} ${e.path}`)
            .join('\n');
          return `PINNED DIR @${pin}:\n\`\`\`\n${listing}\n\`\`\``;
        }
      } catch {
        /* file */
      }
      try {
        const content = await bridge.readFile(pin);
        const clipped = content.length > 24_000 ? `${content.slice(0, 24_000)}\n/* truncated */` : content;
        return `PINNED FILE @${pin}:\n\`\`\`\n${clipped}\n\`\`\``;
      } catch {
        return null;
      }
    }),
  );
  const notes: string[] = [];
  let budget = 12_000;
  for (const n of parts) {
    if (!n || budget <= 0) continue;
    const block = n.length > budget ? `${n.slice(0, budget)}\n/* truncated */` : n;
    notes.push(block);
    budget -= block.length;
  }
  return notes;
}

async function prefetchWorkspaceFiles(
  text: string,
  root: string,
  opts?: { explore?: boolean; build?: boolean },
): Promise<string[]> {
  if (!bridge.connected) return [];
  if (!shouldPrefetchWorkspace(text, opts)) return [];
  const notes: string[] = [];
  let budget = 12_000;

  const pinned = await prefetchPinnedPaths(text, root);
  for (const n of pinned) {
    notes.push(n);
    budget -= n.length;
  }

  const pins = extractAtPins(text);
  if (opts?.explore && !pins.length && budget > 500) {
    try {
      const entries = await bridge.listDir('.');
      if (entries?.length) {
        const listing = entries
          .slice(0, 80)
          .map((e) => `${e.dir ? 'd' : 'f'} ${e.path}`)
          .join('\n');
        let block = `PREFETCHED list_dir(.):\n\`\`\`\n${listing}\n\`\`\``;
        const cap = Math.min(6_000, budget);
        if (block.length > cap) block = `${block.slice(0, cap)}\n/* truncated */`;
        notes.push(block);
        budget -= block.length;
      }
    } catch {
      /* fail soft */
    }
  }

  const paths = extractMentionedPaths(text).filter((p) => isPathInsideRoot(p, root || undefined));
  const pinnedSet = new Set(pins);
  const toRead = paths.filter((p) => !pinnedSet.has(p)).slice(0, 4);
  if (toRead.length && budget > 0) {
    const bodies = await Promise.all(
      toRead.map(async (filePath) => {
        try {
          const content = await bridge.readFile(filePath);
          return { filePath, content };
        } catch {
          return null;
        }
      }),
    );
    for (const row of bodies) {
      if (!row || budget <= 0) continue;
      const take = Math.min(24_000, budget);
      const clipped = row.content.length > take ? `${row.content.slice(0, take)}\n/* truncated */` : row.content;
      const block = `WORKSPACE FILE ${row.filePath}:\n\`\`\`\n${clipped}\n\`\`\``;
      notes.push(block);
      budget -= block.length;
    }
  }

  if ((opts?.explore || opts?.build) && budget > 6_000) {
    const tokens = extractSearchTokens(text, 4);
    if (tokens.length) {
      try {
        const hits = await bridge.semanticSearch(tokens.join(' '), { maxSnippets: 8 });
        if (hits && hits !== 'no matches' && !hits.startsWith('no matches')) {
          const files: string[] = [];
          const seen = new Set<string>([...pinnedSet, ...paths]);
          for (const line of hits.split('\n')) {
            const m = line.match(/^([^:]+):\d+:/);
            if (!m) continue;
            const fp = m[1];
            if (seen.has(fp)) continue;
            seen.add(fp);
            files.push(fp);
            if (files.length >= 2) break;
          }
          const related = await Promise.all(
            files.map(async (filePath) => {
              if (!isPathInsideRoot(filePath, root || undefined)) return null;
              try {
                const content = await bridge.readFile(filePath);
                return { filePath, content };
              } catch {
                return null;
              }
            }),
          );
          for (const row of related) {
            if (!row || budget <= 0) continue;
            const take = Math.min(16_000, budget);
            const clipped = row.content.length > take ? `${row.content.slice(0, take)}\n/* truncated */` : row.content;
            const block = `RELATED FILE ${row.filePath}:\n\`\`\`\n${clipped}\n\`\`\``;
            notes.push(block);
            budget -= block.length;
          }
        }
      } catch {
        /* fail soft if bridge/search unavailable */
      }
    }
  }

  return notes;
}


function mergeMessage(list: Message[], msg: Message): Message[] {
  const idx = list.findIndex((m) => m.id === msg.id);
  if (idx >= 0) {
    if (list[idx] === msg) return list;
    const next = list.slice();
    next[idx] = msg;
    return next;
  }
  return [...list, msg];
}

export interface UseAgentLoopProps {
  thread: Thread;
  settings: ClientSettings;
  autoAcceptEdits: boolean;
  autoRunShell: boolean;
  workspaceRoot: string;
  onThreadUpdate: (thread: Thread) => void;
  onAgentStatus?: (label: string) => void;
  onGitMaybeChanged?: () => void;
  composerSeed?: string | null;
  onComposerSeedConsumed?: () => void;
  planMode?: boolean;
  buildMode?: boolean;
  agentMode?: AgentMode;
  onSettingsChange?: (s: ClientSettings) => void;
}


/** Owns chat state, the agent turn loop, and tool orchestration for ChatScreen. */
export function useAgentLoop({
  thread,
  settings,
  autoAcceptEdits,
  autoRunShell,
  workspaceRoot,
  onThreadUpdate,
  onAgentStatus,
  onGitMaybeChanged,
  composerSeed,
  onComposerSeedConsumed,
  planMode = false,
  buildMode = false,
  agentMode,
  onSettingsChange,
}: UseAgentLoopProps) {

  const resolvedAgentMode: AgentMode =
    agentMode ||
    settings.agentMode ||
    (planMode ? 'plan' : buildMode ? 'agent' : 'agent');
  const isPlanMode = resolvedAgentMode === 'plan';
  const isAskMode = resolvedAgentMode === 'ask';

  const [messages, setMessages] = useState<Message[]>([]);
  const [hiddenPrefix, setHiddenPrefix] = useState(0);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loopTurn, setLoopTurn] = useState(0);
  const [lastStopReason, setLastStopReason] = useState<AgentStopReason | null>(null);
  const [lastProof, setLastProof] = useState<RunProof | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>(bridge.currentStatus);
  const [appRoot, setAppRoot] = useState(bridge.currentAppRoot);
  const [dirConfirmed, setDirConfirmed] = useState(false);
  const [grokById, setGrokById] = useState<Record<string, GrokApplyResult[]>>({});
  const [latestGrok, setLatestGrok] = useState<GrokApplyResult[] | undefined>(undefined);
  const [grokEmptyHint, setGrokEmptyHint] = useState<string | undefined>(undefined);
  const hasAutoCheckpointedRef = useRef(false);
  const maxTurns = Math.min(MAX_AGENT_TURNS_CLAMP, clampMaxAgentTurns(settings.maxAgentTurns));
  const effectiveTools = useMemo(
    () => filterModeTools(thread.enabledTools, resolvedAgentMode),
    [resolvedAgentMode, thread.enabledTools],
  );
  const agentProfile = useMemo(() => {
    const active = resolveActiveSettings(settings);
    const peek = peekFeatherlessModel(active.defaultModel);
    return buildModelAgentProfile({
      model: active.defaultModel || thread.model,
      provider: active.provider,
      reasoning: settings.reasoning,
      planMode: isPlanMode,
      buildMode: resolvedAgentMode === 'agent',
      toolUse: peek?.toolUse,
      contextLength: peek?.contextLength,
      enabledTools: effectiveTools,
      workspaceRoot: connectedBridgeWriteRoot({
        workspaceRoot,
        appRoot,
        bridgeRoot: bridge.validWorkspaceRoot || bridge.currentRoot,
      }),
    });
  }, [
    settings,
    isPlanMode,
    resolvedAgentMode,
    thread.model,
    effectiveTools,
    workspaceRoot,
    appRoot,
  ]);
  const [planChecklist, setPlanChecklist] = useState<string[]>([]);
  const [skillsRecords, setSkillsRecords] = useState<SkillRecord[]>([]);
  const [skillsCatalog, setSkillsCatalog] = useState<SkillCatalogEntry[]>([]);
  const [projectMemoryBlock, setProjectMemoryBlock] = useState('');
  const [mempalaceBlock, setMempalaceBlock] = useState('');
  const [taskGraphBlock, setTaskGraphBlock] = useState('');
  const [workspaceSkillsBlock, setWorkspaceSkillsBlock] = useState('');
  const todosRef = useRef<TodoItem[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const nearBottomRef = useRef(true);
  // These mirror state but are also written eagerly mid-turn, ahead of the paired
  // setState commit, so the running loop reads its own writes. Not useSyncedRef.
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const autoAcceptRef = useSyncedRef(autoAcceptEdits);
  const autoRunRef = useSyncedRef(autoRunShell);
  const onAgentStatusRef = useSyncedRef(onAgentStatus);
  const onGitMaybeChangedRef = useSyncedRef(onGitMaybeChanged);
  const busyRef = useSyncedRef(busy);
  const settingsRef = useSyncedRef(settings);
  const pendingMidRunRef = useRef<string[]>([]);
  const sendTextRef = useRef<(text: string) => Promise<void>>(async () => {});
  const [queuedMidRun, setQueuedMidRun] = useState(0);
  const [showJump, setShowJump] = useState(false);
  const continueAfterToolRef = useRef<((messageId: string) => Promise<void>) | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>('idle');
  const [phaseMeta, setPhaseMeta] = useState<AgentPhaseMeta>({});
  const [showIdleMonitor, setShowIdleMonitor] = useState(false);
  const agentPhaseRef = useRef<AgentPhase>('idle');
  const phaseMetaRef = useRef<AgentPhaseMeta>({});
  const runStartedAtRef = useRef<number>(0);
  const turnHasContentRef = useRef(false);
  const turnHasReasoningRef = useRef(false);
  const loopTurnRef = useRef(loopTurn);
  loopTurnRef.current = loopTurn;
  const queuedMidRunRef = useRef(queuedMidRun);
  queuedMidRunRef.current = queuedMidRun;

  const lastStateFlushRef = useRef(0);
  const stateTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const pendingStreamRef = useRef<Message | null>(null);

  const clearPersistTimers = () => {
    if (stateTimerRef.current != null) {
      window.clearTimeout(stateTimerRef.current);
      stateTimerRef.current = null;
    }
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  };

  const flushStreamPersist = useCallback((msg: Message) => {
    clearPersistTimers();
    pendingStreamRef.current = null;
    lastStateFlushRef.current = performance.now();
    const next = saveMessage(msg);
    messagesRef.current = next;
    setMessages(next);
    return next;
  }, []);

  const persistStream = useCallback((msg: Message) => {
    pendingStreamRef.current = msg;
    const now = performance.now();
    const applyLocal = () => {
      lastStateFlushRef.current = performance.now();
      setMessages((prev) => {
        const next = mergeMessage(prev, msg);
        messagesRef.current = next;
        return next;
      });
    };
    if (now - lastStateFlushRef.current >= STATE_THROTTLE_MS) {
      if (stateTimerRef.current != null) {
        window.clearTimeout(stateTimerRef.current);
        stateTimerRef.current = null;
      }
      applyLocal();
    } else if (stateTimerRef.current == null) {
      const wait = STATE_THROTTLE_MS - (now - lastStateFlushRef.current);
      stateTimerRef.current = window.setTimeout(() => {
        stateTimerRef.current = null;
        const pending = pendingStreamRef.current;
        if (pending) {
          setMessages((prev) => {
            const next = mergeMessage(prev, pending);
            messagesRef.current = next;
            return next;
          });
          lastStateFlushRef.current = performance.now();
        }
      }, Math.max(wait, 0));
    }

    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const pending = pendingStreamRef.current;
      if (pending) saveMessage(pending);
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const persist = useCallback((msg: Message) => {
    clearPersistTimers();
    pendingStreamRef.current = null;
    const next = saveMessage(msg);
    messagesRef.current = next;
    setMessages(next);
    return next;
  }, []);

  useEffect(() => {
    clearPersistTimers();
    const loaded = getMessages(thread.id);
    messagesRef.current = loaded;
    setMessages(loaded);
    setHiddenPrefix(Math.max(0, loaded.length - MESSAGE_WINDOW));
    setGrokById({});
    setLatestGrok(undefined);
    setGrokEmptyHint(undefined);
    setInput('');
    pendingMidRunRef.current = [];
    setQueuedMidRun(0);
    nearBottomRef.current = true;
    agentPhaseRef.current = 'idle';
    phaseMetaRef.current = {};
    setAgentPhase('idle');
    setPhaseMeta({});
    setShowIdleMonitor(false);
    onAgentStatusRef.current?.('');
    setPlanChecklist([]);
    todosRef.current = [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id]);

  useEffect(() => {
    if (!isPlanMode) setPlanChecklist([]);
  }, [isPlanMode]);

  useEffect(() => {
    if (!isPlanMode || busy) return;
    const latest = messages[messages.length - 1];
    if (latest && latest.role === 'assistant' && latest.content) {
      const items = parseTodoItems(latest.content);
      if (items.length) {
        setPlanChecklist(items.map((t) => (t.done ? `[x] ${t.text}` : t.text)));
      }
    }
  }, [isPlanMode, busy, messages]);

  // Keep an open thread on the currently active Models/API model.
  useEffect(() => {
    const model = resolveActiveSettings(settings).defaultModel;
    if (!model || thread.model === model) return;
    const updated = { ...thread, model, updatedAt: Date.now() };
    upsertThread(updated);
    onThreadUpdate(updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    thread.id,
    settings.inferenceProvider,
    settings.defaultModel,
    settings.sparkModel,
    settings.featherlessModel,
  ]);

  useEffect(() => bridge.onStatusChange(setBridgeStatus), []);
  useEffect(() => bridge.onAppRootChange(setAppRoot), []);

  useEffect(() => {
    setDirConfirmed(false);
  }, [thread.id]);

  useEffect(() => {
    if (messages.length > 0 && workspaceGate(workspaceRoot, appRoot).ok) {
      setDirConfirmed(true);
    }
  }, [messages.length, workspaceRoot, appRoot]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
      nearBottomRef.current = near;
      setShowJump(!near);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    const el = scrollerRef.current;
    if (!el) return;
    if (!force && !nearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
    nearBottomRef.current = true;
    setShowJump(false);
  }, []);

  useEffect(() => {
    scrollToBottom(false);
  }, [messages, grokById, scrollToBottom]);

  const pushAgentStatus = useCallback(
    (phase: AgentPhase, meta: AgentPhaseMeta, turn: number, queued: number) => {
      if (phase === 'idle') {
        onAgentStatusRef.current?.('');
        return;
      }
      const short = agentPhaseShortLabel(phase, meta);
      const turnPart = turn > 0 ? `${turn}/${maxTurns}` : '';
      const q = queued > 0 ? ' · queued' : '';
      const parts = [short, turnPart].filter(Boolean);
      onAgentStatusRef.current?.(parts.length ? `${parts.join(' · ')}${q}` : `agent${q}`);
    },
    [maxTurns],
  );

  const setPhase = useCallback(
    (phase: AgentPhase, patch: Partial<AgentPhaseMeta> = {}, turnOverride?: number) => {
      const prev = phaseMetaRef.current;
      const nextMeta: AgentPhaseMeta = { ...prev, ...patch };
      agentPhaseRef.current = phase;
      phaseMetaRef.current = nextMeta;
      setAgentPhase(phase);
      setPhaseMeta(nextMeta);
      const turn = turnOverride ?? loopTurnRef.current;
      pushAgentStatus(phase, nextMeta, turn, queuedMidRunRef.current);
    },
    [pushAgentStatus],
  );

  // Keep StatusBar in sync when turn/queue changes without a phase transition.
  useEffect(() => {
    if (!busy) return;
    pushAgentStatus(agentPhaseRef.current, phaseMetaRef.current, loopTurn, queuedMidRun);
  }, [busy, loopTurn, queuedMidRun, pushAgentStatus]);

  // Elapsed ticker lives in AgentStatusMonitor so 500ms ticks do not rebuild the transcript.

  useEffect(() => {
    if (!composerSeed) return;
    setInput(composerSeed);
    onComposerSeedConsumed?.();
    window.setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const len = composerSeed.length;
      el.setSelectionRange(len, len);
    }, 0);
  }, [composerSeed, onComposerSeedConsumed]);

  useEffect(() => () => clearPersistTimers(), []);

  useEffect(() => {
    setHiddenPrefix((prev) => {
      const target = Math.max(0, messages.length - MESSAGE_WINDOW);
      if (prev === 0) return target;
      if (prev > target) return target;
      if (messages.length > MESSAGE_WINDOW && prev >= messages.length - MESSAGE_WINDOW - 1) {
        return target;
      }
      return prev;
    });
  }, [messages.length]);


  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!bridge.connected) {
        if (!cancelled) {
          setSkillsCatalog([]);
          setProjectMemoryBlock('');
          setMempalaceBlock('');
          setTaskGraphBlock('');
          setWorkspaceSkillsBlock('');
        }
        return;
      }
      try {
        const files = await bridge.readProjectMemory();
        const pinned = settings.projectRulesPinned !== false;
        if (!cancelled) setProjectMemoryBlock(formatProjectMemoryPrompt(filterPinnedProjectMemory(files, pinned)));
      } catch {
        if (!cancelled) setProjectMemoryBlock('');
      }
      if (settings.mempalaceEnabled !== false && settings.mempalaceAutoRecall !== false) {
        try {
          const opts = mempalaceOpts(settings, workspaceRoot);
          const wake = await bridge.mempalaceWake(opts);
          if (!cancelled) setMempalaceBlock(wake);
        } catch {
          if (!cancelled) setMempalaceBlock('');
        }
      } else if (!cancelled) {
        setMempalaceBlock('');
      }
      try {
        const raw = await bridge.readFile(TASK_GRAPH_PATH);
        if (!cancelled) setTaskGraphBlock(formatTaskGraphPrompt(parseTaskGraph(raw)));
      } catch {
        if (!cancelled) setTaskGraphBlock('');
      }
      if (settings.skillsEnabled === false) {
        if (!cancelled) {
          setSkillsRecords([]);
          setSkillsCatalog([]);
          setWorkspaceSkillsBlock('');
        }
        return;
      }
      try {
        const skills = (await bridge.listSkills()) as SkillRecord[];
        if (!cancelled) {
          setSkillsRecords(skills as SkillRecord[]);
          setSkillsCatalog(toCatalogEntries(skills));
          setWorkspaceSkillsBlock(formatAutoLoadedSkillsPrompt(skills));
        }
      } catch {
        if (!cancelled) {
          setSkillsRecords([]);
          setSkillsCatalog([]);
          setWorkspaceSkillsBlock('');
        }
      }
    };
    void load();
    const unsub = bridge.onStatusChange(() => {
      void load();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [
    settings.skillsEnabled,
    settings.projectRulesPinned,
    settings.mempalaceEnabled,
    settings.mempalaceAutoRecall,
    settings.mempalacePalacePath,
    settings.mempalaceWing,
    workspaceRoot,
    bridgeStatus,
  ]);

  const buildCapabilityPlan = (queryText: string, cache?: { plan: CapabilityPlan | null, turn: number, queryHash?: number }): CapabilityPlan => {
    // Cache capability plan for 2 turns to avoid redundant string matching
    if (cache && cache.plan && cache.turn >= loopTurnRef.current - 1 && cache.queryHash === hashString(queryText)) {
      return cache.plan;
    }
    const plan = planCapabilities({
      queryText,
      skills: skillsRecords,
      mcpTools: listConnectedMcpTools(),
      skillsEnabled: settingsRef.current.skillsEnabled !== false,
      allowAllMcp: agentProfile.allowMcp && !isPlanMode && !isAskMode,
      canWriteSkill: !isPlanMode && !isAskMode && autoAcceptEdits && agentProfile.toolTier === 'full',
      excludeSkillIds:
        settingsRef.current.skillsEnabled !== false && settingsRef.current.verifyStrictProfile === true
          ? ['verify-strict']
          : [],
    });
    if (cache) {
      cache.plan = plan;
      cache.turn = loopTurnRef.current;
      cache.queryHash = hashString(queryText);
    }
    return plan;
  };

  const toApiMessages = (list: Message[], extraSystem: string[] = [], cache?: { plan: CapabilityPlan | null; turn: number }): ChatOpenAiMessage[] => {
    const out: ChatOpenAiMessage[] = [];
    let sys = thread.systemPrompt || settingsRef.current.systemPrompt || '';
    const lastUser = [...list].reverse().find((m) => m.role === 'user');
    const buildProcess =
      !isPlanMode &&
      !isAskMode &&
      lastUser &&
      shouldApplyBuildProcess(lastUser.content, { buildMode: resolvedAgentMode === 'agent', planMode: isPlanMode });
    const largeNudge =
      !buildProcess && !isPlanMode && !isAskMode && lastUser && looksLargeJob(lastUser.content)
        ? buildLargeJobNudge()
        : '';
    const thoughtOn = agentProfile.useThoughtLock;
    const thoughtNudge = thoughtOn ? buildThoughtModeNudge() : '';
    const toolsOff = !agentProfile.sendTools;
    const writeRoot = connectedBridgeWriteRoot({
      workspaceRoot,
      appRoot,
      bridgeRoot: bridge.validWorkspaceRoot || bridge.currentRoot,
    });
    const modeSection = buildModePromptSection(resolvedAgentMode);
    const modeNudge = buildModeNudge(resolvedAgentMode);
    const buildNudge = isPlanMode || isAskMode
      ? ''
      : buildProcess
        ? buildReasoningThenBuildNudge({ toolsOff })
        : resolvedAgentMode === 'agent'
          ? buildBuildModeAlwaysNudge({ toolsOff })
          : '';
    const planNudge = isPlanMode ? buildPlanModeNudge() : '';
    const planBuildNudge =
      isPlanMode && lastUser && /\b(build|implement|apply|write|code)\b/i.test(lastUser.content)
        ? 'Plan mode is still on; only checklist allowed — operator must Approve to write. Do not emit diffs.'
        : '';
    const lockedGoal = extractLockedGoal(list);
    const injectGraph = shouldUseTaskGraph({
      largeJob: !!(lastUser && looksLargeJob(lastUser.content)),
      buildProcess: !!buildProcess,
      hasExistingGraph: !!taskGraphBlock,
    });
    const injectVerifyStrict =
      settings.skillsEnabled !== false &&
      shouldAutoInjectVerifyStrict({
        buildProcess: !!buildProcess,
        largeJob: !!(lastUser && looksLargeJob(lastUser.content)),
        verifyStrictProfile: settings.verifyStrictProfile === true,
      });
    const verifyStrictBlock = injectVerifyStrict
      ? formatVerifyStrictSkillPrompt(skillsRecords, { force: true })
      : '';
    const capPlan = buildCapabilityPlan(`${lockedGoal}\n${lastOperatorPrompt(list) || lastUser?.content || ''}`, cache);
    const showSkills = !agentProfile.compactPrompt && settings.skillsEnabled !== false;
    // Steering directives first, bulk context last: fitChatPayload clips an oversized
    // system message from the tail, so the tail must hold the most droppable text.
    sys = assembleSystemPrompt(
      [
        { text: sys, essential: true },
        { text: modeSection, essential: true },
        { text: lockedGoalSystemBlock(lockedGoal), essential: true },
        { text: thoughtNudge, essential: true },
        { text: modeNudge, essential: true },
        { text: isPlanMode ? planNudge : '', essential: true },
        { text: planBuildNudge, essential: true },
        { text: buildNudge, essential: true },
        { text: largeNudge, essential: true },
        { text: liveWorkspaceSuffix(writeRoot, toolsOff), essential: true },
        {
          text: shouldWriteWorkspaceFiles({
            planMode: isPlanMode || isAskMode,
            workspaceRoot,
            appRoot,
            connected: bridgeStatus === 'connected',
            bridgeRoot: bridge.validWorkspaceRoot || bridge.currentRoot,
          })
            ? grokAutoAcceptSuffix(writeRoot)
            : '',
          essential: true,
        },
        { text: agentProfile.systemAddendum, essential: true },
        { text: capPlan.systemBlock },
        { text: verifyStrictBlock },
        ...extraSystem.map((text) => ({ text })),
        { text: projectMemoryBlock },
        { text: injectGraph && !agentProfile.compactPrompt ? taskGraphBlock : '' },
        { text: showSkills ? formatSkillsCatalogPrompt(skillsCatalog) : '' },
        { text: showSkills ? workspaceSkillsBlock : '' },
        { text: agentProfile.compactPrompt ? '' : mempalaceBlock },
      ],
      { maxChars: agentProfile.compactPrompt ? COMPACT_SYSTEM_MAX_CHARS : undefined },
    );
    if (sys) out.push({ role: 'system', content: sys });

    // PROGRESSIVE CONTEXT PACKING:
    // 1. Always keep original user request
    // 2. Always keep last 12 messages
    // 3. Truncate long tool outputs before dropping messages
    // 4. Drop from the middle first, oldest tool outputs first
    const firstUserIndex = list.findIndex(m => m.role === 'user' && !isMidRunMessageContent(m.content));
    const keepFirst = firstUserIndex >= 0 ? [list[firstUserIndex]] : [];
    const keepLast = list.slice(-12);
    const middleStart = firstUserIndex >= 0 ? firstUserIndex + 1 : 0;
    const middleEnd = Math.max(middleStart, list.length - 12);
    const middle = list.slice(middleStart, middleEnd);

    // Sort middle messages: tool messages first (oldest first), then others
    const sortedMiddle = [...middle].sort((a, b) => {
      if (a.role === 'tool' && b.role !== 'tool') return -1;
      if (b.role === 'tool' && a.role !== 'tool') return 1;
      return 0;
    });

    // Build message list with aggressive truncation for middle tools
    const allMessages = [...keepFirst, ...sortedMiddle, ...keepLast];

    for (const m of allMessages) {
      if (m.role === 'system') continue;
      if (m.role === 'tool') {
        // More aggressive truncation for middle tool messages
        const isMiddle = middle.includes(m);
        const maxChars = isMiddle ? 2000 : MAX_API_TOOL_CHARS;
        const content = m.content.length > maxChars
          ? `${m.content.slice(0, maxChars)}\n/* truncated (middle context) */`
          : truncateForApi(m.content);

        out.push({
          role: 'tool',
          content,
          tool_call_id: m.toolCallId || m.toolCall?.id || '',
        });
        continue;
      }
      if (m.role === 'assistant') {
        const msg: ChatOpenAiMessage = { role: 'assistant', content: m.content };
        if (m.reasoning?.trim()) msg.reasoning_content = m.reasoning;
        if (m.toolCalls && m.toolCalls.length) {
          msg.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments ?? {}),
            },
          }));
        }
        out.push(msg);
        continue;
      }
      // Mid-run barge-in messages are UI markers; the integrate nudge carries their text to the API.
      if (m.role === 'user' && isMidRunMessageContent(m.content)) continue;
      out.push({ role: m.role, content: m.content });
    }
    return out;
  };

  const runGrokLayer = async (msg: Message) => {
    const writeRoot = connectedBridgeWriteRoot({
      workspaceRoot,
      appRoot,
      bridgeRoot: bridge.validWorkspaceRoot || bridge.currentRoot,
    });
    const source = grokSource(msg.content, msg.reasoning, writeRoot || workspaceRoot);
    if (isPlanMode || isAskMode) {
      setLatestGrok([]);
      setGrokEmptyHint(undefined);
      return [] as GrokApplyResult[];
    }
    // Fast path: skip heavy parsing if no code blocks or diffs exist
    if (!source.includes('```') && !source.includes('@@')) {
      setLatestGrok([]);
      setGrokEmptyHint(undefined);
      return [] as GrokApplyResult[];
    }
    const parsed = parseGrokEdits(source, writeRoot || workspaceRoot);
    // Prefer the structured tool channel: if this turn also calls write_file /
    // apply_patch for a file, let the tool write it and skip the content fence.
    const toolTargets = (msg.toolCalls || [])
      .filter((tc) => tc.name === 'write_file' || tc.name === 'apply_patch')
      .map((tc) => toolArgString(tc.arguments, ['path', 'file', 'target']));
    const edits = dedupeEditsByToolTargets(parsed, toolTargets, writeRoot || workspaceRoot);
    const dedupedAny = edits.length !== parsed.length;
    const writeToWorkspace = shouldWriteWorkspaceFiles({
      planMode: false,
      workspaceRoot,
      appRoot,
      connected: bridge.connected,
      bridgeRoot: bridge.validWorkspaceRoot || bridge.currentRoot,
    });
    const results = await applyGrokEdits(edits, {
      autoAccept: autoAcceptRef.current,
      writeToWorkspace,
      root: writeRoot || workspaceRoot,
    });
    if (results.some((r) => r.status === 'ok') && !hasAutoCheckpointedRef.current && bridge.connected) {
      hasAutoCheckpointedRef.current = true;
      try {
        const label = `auto: turn ${loopTurnRef.current} - grok diff`;
        const ckpt = await bridge.checkpointSave(label);
        if (ckpt) {
          msg.checkpointId = ckpt;
          msg.checkpointLabel = label;
          flushStreamPersist({ ...msg });
        }
      } catch (e) {
        console.warn('Auto-checkpoint failed:', e);
      }
      if (settingsRef.current.postEditDiagnostics) {
        const diags = await runWorkspaceDiagnostics(workspaceRoot);
        if (diags.length > 0) {
          msg.diagnostics = diags;
          flushStreamPersist({ ...msg });
        }
      }
    }
    const pending = edits.filter((_, i) => results[i]?.status === 'pending');
    if (pending.length) enqueuePendingEdits(pending, msg.id);
    setGrokById((prev) => ({ ...prev, [msg.id]: results }));
    setLatestGrok(results);
    setGrokEmptyHint(
      results.length === 0 && !dedupedAny && hasNonShellCodeFences(source)
        ? 'no path-headed edits — chat only'
        : undefined,
    );
    return results;
  };

  const makeToolMessage = (tool: ToolCallPayload, content: string): Message => ({
    id: uid('msg'),
    threadId: thread.id,
    role: 'tool',
    content,
    toolCallId: tool.id,
    toolCall: tool,
    createdAt: Date.now(),
    status: 'complete',
  });


  const executeTool = async (tool: ToolCallPayload): Promise<{ msg: Message; executed: boolean }> => {
    if ((isPlanMode || isAskMode) && isMcpToolName(tool.name)) {
      const isReadOnlyMcp = /search|status|list|query|get|read|check|wake/i.test(tool.name);
      if (!isReadOnlyMcp) {
        const denied = {
          ...tool,
          status: 'denied' as const,
          result: isAskMode
            ? 'Ask mode: Mutating MCP tools are blocked in read-only mode.'
            : 'Plan mode: Mutating MCP tools locked until you approve the plan.',
        };
        return {
          msg: makeToolMessage(denied, denied.result || ''),
          executed: false,
        };
      }
    }
    const tools = effectiveTools;
    const result = await executeAgentTool(tool, {
      enabledTools: tools,
      agentMode: resolvedAgentMode,
      autoAcceptEdits: isPlanMode || isAskMode ? false : autoAcceptRef.current,
      autoRunShell: isPlanMode || isAskMode ? false : autoRunRef.current,
      settings,
      workspaceRoot,
      mode: 'interactive',
      onGitMaybeChanged: () => onGitMaybeChangedRef.current?.(),
      executeMcpTool: executeMcpToolCall,
      todoItems: todosRef.current,
      onTodos: (items) => {
        todosRef.current = items;
        setPlanChecklist(items.map((t) => (t.done ? `[x] ${t.text}` : t.text)));
      },
    });
    return { msg: makeToolMessage(result.tool, result.content), executed: result.executed };
  };


  const runCreatePrClick = useCallback(
    async (message: Message) => {
      const tool = message.toolCall;
      if (!tool || tool.name !== 'create_pr') return;
      if (busyRef.current) return;
      const title = toolArgString(tool.arguments, ['title']);
      const body = toolArgString(tool.arguments, ['body', 'description']);
      const base = toolArgString(tool.arguments, ['base', 'baseBranch']) || undefined;
      try {
        const result = await bridge.createPr({ title, body, base });
        persist({ ...message, content: result, toolCall: { ...tool, status: 'executed', result } });
        onGitMaybeChangedRef.current?.();
        await continueAfterToolRef.current?.(message.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        persist({ ...message, content: msg, toolCall: { ...tool, status: 'error', result: msg } });
      }
    },
    [persist],
  );

  const runCheckpointRestoreClick = useCallback(
    async (message: Message) => {
      const tool = message.toolCall;
      if (!tool || tool.name !== 'checkpoint_restore') return;
      if (busyRef.current) return;
      const id = toolArgString(tool.arguments, ['id', 'checkpoint', 'name']);
      try {
        const result = await bridge.checkpointRestore(id);
        persist({ ...message, content: result, toolCall: { ...tool, status: 'executed', result } });
        onGitMaybeChangedRef.current?.();
        await continueAfterToolRef.current?.(message.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        persist({ ...message, content: msg, toolCall: { ...tool, status: 'error', result: msg } });
      }
    },
    [persist],
  );

  const runGitCommitClick = useCallback(
    async (message: Message) => {
      const tool = message.toolCall;
      if (!tool || tool.name !== 'git_commit') return;
      if (busyRef.current) return;
      const commitMsg = toolArgString(tool.arguments, ['message', 'msg']);
      const paths = asStringList(tool.arguments.paths);
      try {
        const result = await bridge.gitCommit(commitMsg, paths);
        persist({ ...message, content: result, toolCall: { ...tool, status: 'executed', result } });
        onGitMaybeChangedRef.current?.();
        await continueAfterToolRef.current?.(message.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        persist({ ...message, content: msg, toolCall: { ...tool, status: 'error', result: msg } });
      }
    },
    [persist],
  );

  const runWriteFileClick = useCallback(
    async (message: Message) => {
      const tool = message.toolCall;
      if (!tool || tool.name !== 'write_file') return;
      if (busyRef.current) return;
      if (planMode) return;
      const file = toolArgString(tool.arguments, ['path', 'file', 'target']);
      const content = toolArgString(tool.arguments, ['content', 'text', 'body']);
      if (!file) {
        const msg = 'missing path';
        persist({ ...message, content: msg, toolCall: { ...tool, status: 'error', result: msg } });
        return;
      }
      const writeRoot = connectedBridgeWriteRoot({
        workspaceRoot,
        appRoot,
        bridgeRoot: bridge.validWorkspaceRoot || bridge.currentRoot,
      });
      if (!isPathInsideRoot(file, writeRoot || workspaceRoot || bridge.currentRoot)) {
        const msg = 'path escape blocked';
        persist({ ...message, content: msg, toolCall: { ...tool, status: 'error', result: msg } });
        return;
      }
      if (!bridge.connected) {
        const msg = 'bridge disconnected';
        persist({ ...message, content: msg, toolCall: { ...tool, status: 'error', result: msg } });
        return;
      }
      try {
        const ok = await bridge.writeFile(file, content, { root: writeRoot || workspaceRoot || undefined });
        if (!ok) {
          const msg = 'write failed';
          persist({ ...message, content: msg, toolCall: { ...tool, status: 'error', result: msg } });
          return;
        }
        noteFileApplied(file);
        const result = 'wrote ' + file + ' (' + content.length + ' chars)';
        persist({ ...message, content: result, toolCall: { ...tool, status: 'executed', result } });
        onGitMaybeChangedRef.current?.();
        await continueAfterToolRef.current?.(message.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        persist({ ...message, content: msg, toolCall: { ...tool, status: 'error', result: msg } });
      }
    },
    [persist, planMode, workspaceRoot],
  );

  const finishRun = (
    stopReason: AgentStopReason,
    meta: {
      startedAt: number;
      turns: number;
      tools: string[];
      theaterRetries?: number;
      fakeToolParsed?: number;
      deepenPasses?: number;
      verifyEvidence?: boolean;
      provenImprovement?: boolean;
      inspectBeforeWrite?: boolean;
      proof?: RunProof;
    },
  ) => {
    const endedAt = Date.now();
    setLastStopReason(stopReason);
    if (meta.proof) setLastProof(meta.proof);
    const run: AgentRunRecord = {
      threadId: thread.id,
      startedAt: meta.startedAt,
      endedAt,
      turns: meta.turns,
      stopReason,
      tools: meta.tools,
      ms: endedAt - meta.startedAt,
      theaterRetries: meta.theaterRetries,
      fakeToolParsed: meta.fakeToolParsed,
      deepenPasses: meta.deepenPasses,
      verifyEvidence: meta.verifyEvidence,
      provenImprovement: meta.provenImprovement,
      inspectBeforeWrite: meta.inspectBeforeWrite,
    };
    recordAgentRun(run);
    const s = settingsRef.current;
    if (s.mempalaceEnabled === false || s.mempalaceAutoSave === false) return;
    if (!bridge.connected) return;
    const rows = messagesRef.current;
    const lastUser = [...rows].reverse().find((m) => m.role === 'user' && !isMidRunMessageContent(m.content));
    const lastAsst = [...rows].reverse().find((m) => m.role === 'assistant');
    const userText = lastUser?.content || '';
    if (
      /^(↻|Build process:|Tool recovery:|Deepen this answer|Need a scoped verify|Plan approved\.)/.test(userText)
    ) {
      return;
    }
    const payload = formatSessionMemory(userText, lastAsst?.content || '', {
      model: thread.model || s.defaultModel,
      thread: thread.title || thread.id,
    });
    if (!payload.trim()) return;
    const opts = mempalaceOpts(s, workspaceRoot);
    void bridge.mempalaceSave(payload, { ...opts, room: 'abliterated-chat' }).catch(() => {
      /* palace optional — do not fail the run */
    });
  };

  const runCompletion = async (history: Message[]) => {
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setLoopTurn(1);
    loopTurnRef.current = 1;
    setLastStopReason(null);
    setLastProof(null);
    pendingMidRunRef.current = [];
    setQueuedMidRun(0);
    queuedMidRunRef.current = 0;
    setShowIdleMonitor(false);
    hasAutoCheckpointedRef.current = false;
    let current = history;
    const startedAt = Date.now();
    runStartedAtRef.current = startedAt;
    phaseMetaRef.current = { runStartedAt: startedAt };
    setPhase('starting', { runStartedAt: startedAt }, 1);
    const toolsUsed: string[] = [];
    let turnPlan: PlanItem[] = [];
    let turnSteps: WorkflowStep[] = [];
    const grokAcc: GrokApplyResult[] = [];
    const writeCalls: ToolCallPayload[] = [];
    let workflowHostId: string | null = null;
    let promptOnly = false;
    let pins: string[] = [];
    const paintWorkflow = (host: Message, precomputedToolEvidence?: string) => {
      const toolEvidence = precomputedToolEvidence ?? current
        .filter((m) => m.role === 'tool')
        .map((m) => m.content || '')
        .join('\n');
      const synced = syncStepsFromRun({
        steps: turnSteps,
        plan: turnPlan,
        phase: agentPhaseRef.current,
        toolsUsed,
        grokResults: grokAcc,
        verifyEvidence: looksLikeVerifyEvidence(`${host.content || ''}\n${toolEvidence}`, toolsUsed),
        promptOnly,
        content: host.content,
      });
      turnSteps = synced.steps;
      turnPlan = synced.plan;
      host.plan = synced.plan;
      host.steps = synced.steps;
      host.files = collectTurnFiles({
        pins,
        grokResults: grokAcc,
        toolCalls: [...writeCalls, ...(host.toolCalls || [])],
      });
      const audit = host.content ? auditTurnChanges({
        content: host.content || '',
        toolCalls: [...writeCalls, ...(host.toolCalls || [])],
        grokResults: grokAcc,
      }) : null;
      if (audit && (audit.hasModifications || audit.summaryItems.length || audit.verificationItems.length)) {
        host.changeSummary = audit.changeSummary;
      }
      if (!host.planApproved) host.planApproved = isPlanMode ? 'awaiting' : 'approved';
      return audit;
    };
    const attachWorkflow = (msg: Message) => {
      if (workflowHostId && workflowHostId !== msg.id) {
        const prev = messagesRef.current.find((m) => m.id === workflowHostId);
        if (prev && (prev.steps || prev.plan)) {
          persist({ ...prev, steps: undefined, plan: undefined, files: undefined });
        }
      }
      workflowHostId = msg.id;
      paintWorkflow(msg);
    };
    let turnsDone = 0;
    let deepensUsed = 0;
    let fakeToolRetryUsed = false;
    let fakeToolParsedCount = 0;
    let inspectBeforeWriteUsed = false;
    let mcpFollowNudgeUsed = false;
    let skillCreateNudgeUsed = false;
    let skillReadNudgeUsed = false;
    let buildTodoNudgeUsed = false;
    let buildImplementNudgeUsed = false;
    let proveImproveNudgeUsed = false;
    let buildVerifyNudgeUsed = false;
    let changeVerifyNudgeUsed = false;
    let reasoningExecNudgeUsed = false;
    let placeholderNudgeUsed = false;
    let stopReason: AgentStopReason = 'no_tools';
    let turnCap = clampMaxAgentTurns(settingsRef.current.maxAgentTurns);
    const deepenCap = clampSelfDeepenPasses(settingsRef.current.selfDeepenPasses);

    // Loop detection: track fingerprints of last 3 turns
    const lastThreeFingerprints: string[] = [];

    // Capability plan cache - valid for 2 turns
    const capabilityCache = { plan: null as CapabilityPlan | null, turn: -1, queryHash: 0 };

    const drainMidRunMessages = (): boolean => {
      const pending = pendingMidRunRef.current.splice(0, pendingMidRunRef.current.length);
      setQueuedMidRun(0);
      queuedMidRunRef.current = 0;
      if (!pending.length) return false;
      setPhase('integrating_mid_run', {}, turnsDone || loopTurnRef.current);
      const nudge: Message = {
        id: uid('msg'),
        threadId: thread.id,
        role: 'user',
        content: buildMidRunIntegrateNudge(pending),
        createdAt: Date.now(),
        status: 'complete',
      };
      persist(nudge);
      current = messagesRef.current;
      return true;
    };

    try {
      const lastUser = (() => {
        const prompt = lastOperatorPrompt(history);
        return prompt ? { role: 'user' as const, content: prompt } : [...history].reverse().find((m) => m.role === 'user');
      })();
      const grokBuildProcess =
        !isPlanMode &&
        !!(
          lastUser &&
          shouldApplyBuildProcess(lastUser.content, { buildMode: !!buildMode, planMode: !!isPlanMode })
        );
      const exploreIntent = !!(lastUser && looksExploreIntent(lastUser.content));
      promptOnly = !!(lastUser && looksPromptOnlyRequest(lastUser.content));
      pins = lastUser ? extractAtPins(lastUser.content) : [];
      turnPlan = buildTurnPlan(lastUser?.content || '', pins, { promptOnly });
      turnSteps = buildTurnSteps(lastUser?.content || '', pins);
      const prefetched =
        lastUser && bridge.connected
          ? await raceAbort(
              prefetchWorkspaceFiles(lastUser.content, workspaceRoot, {
                explore: exploreIntent,
                build: grokBuildProcess,
              }),
              ac.signal,
              () => [] as string[],
            )
          : [];
      if (ac.signal.aborted) {
        stopReason = 'abort';
        return;
      }

      for (let turn = 1; turn <= turnCap; turn++) {
        turnCap = clampMaxAgentTurns(settingsRef.current.maxAgentTurns);
        if (turn > turnCap) {
          stopReason = 'cap';
          break;
        }
        if (ac.signal.aborted) {
          stopReason = 'abort';
          break;
        }
        // Safe boundary: before next stream — integrate any mid-run operator notes.
        if (turn > 1) drainMidRunMessages();

        // Q5: Compute once per turn - avoid scanning message list multiple times
        const lockedGoal = extractLockedGoal(current);
        const operatorPrompt = lastOperatorPrompt(current) || lastUser?.content || '';
        const toolEvidence = current
          .filter((m) => m.role === 'tool')
          .map((m) => m.content || '')
          .join('\n');

        // Loop detection: check if we're repeating the same turn
        if (turn > 2) {
          const lastContent = current.length >= 2 ? current[current.length - 2]?.content || '' : '';
          const lastTools = toolsUsed.slice(-5).join(',');
          const fingerprint = `${lastContent.slice(0, 200)}|${lastTools}`;

          if (lastThreeFingerprints.includes(fingerprint)) {
            // We're looping - inject break nudge or stop
            if (lastThreeFingerprints.filter(f => f === fingerprint).length >= 2) {
              stopReason = 'loop_detected';
              break;
            }
            const nudge: Message = {
              id: uid('msg'),
              threadId: thread.id,
              role: 'user',
              content: 'You appear to be repeating the same action. Break out of the loop with a different approach, or use [ANSWER_COMPLETE] if you are done.',
              createdAt: Date.now(),
              status: 'complete',
            };
            current = persist(nudge);
          }

          lastThreeFingerprints.push(fingerprint);
          if (lastThreeFingerprints.length > 3) lastThreeFingerprints.shift();
        }

        // Post-edit diagnostics nudge if previous turn produced diagnostics
        const prevAssistant = current.length >= 1 ? current[current.length - 1] : undefined;
        if (prevAssistant?.diagnostics && prevAssistant.diagnostics.length > 0) {
          const diagNudge: Message = {
            id: uid('msg'),
            threadId: thread.id,
            role: 'user',
            content: `Post-edit diagnostics detected ${prevAssistant.diagnostics.length} issue(s):\n` +
              prevAssistant.diagnostics.map((d) => `- ${d.file}${d.line ? `:${d.line}` : ''} [${d.severity || 'error'}]: ${d.message}`).join('\n') +
              '\nPlease review and resolve these issues.',
            createdAt: Date.now(),
            status: 'complete',
          };
          current = persist(diagNudge);
        }

        setLoopTurn(turn);
        loopTurnRef.current = turn;
        turnsDone = turn;
        turnHasContentRef.current = false;
        turnHasReasoningRef.current = false;
        setPhase(
          'starting',
          {
            runStartedAt: runStartedAtRef.current,
            hasContent: false,
            hasReasoning: false,
            reasoningStartedAt: undefined,
            toolName: undefined,
          },
          turn,
        );
        const assistant: Message = {
          id: uid('msg'),
          threadId: thread.id,
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          status: 'streaming',
          mode: resolvedAgentMode,
        };
        attachWorkflow(assistant);
        persist(assistant);
        try {
          const live = settingsRef.current;
          const active = resolveActiveSettings(live);
          const capNow = buildCapabilityPlan(
            `${lockedGoal}\n${operatorPrompt}`,
            capabilityCache,
          );
          const extraMcpTools = capNow.extraMcp.length
            ? mcpToolsToOpenAi(capNow.extraMcp)
            : agentProfile.allowMcp
              ? mcpToolsToOpenAi(listConnectedMcpTools())
              : [];
          const result = await streamChatCompletion({
            settings: live,
            model: active.defaultModel || thread.model,
            messages: toApiMessages(current, turn === 1 ? prefetched : [], capabilityCache),
            abortSignal: ac.signal,
            enabledTools: effectiveTools,
            extraTools: extraMcpTools.length
              ? (extraMcpTools as Parameters<typeof streamChatCompletion>[0]['extraTools'])
              : undefined,
            toolChoice:
              turn === 1 &&
              (exploreIntent || capNow.forceTools) &&
              !looksReadOnlyOrControlPrompt(lastUser?.content || '')
                ? 'required'
                : 'auto',
            flightKey: `chat:${thread.id}`,
            onReset: () => {
              assistant.content = '';
              assistant.reasoning = '';
              turnHasContentRef.current = false;
              turnHasReasoningRef.current = false;
              persistStream({ ...assistant });
            },
            onDelta: (text) => {
              if (!turnHasContentRef.current) {
                // First real content delta — replace any live-mirrored reasoning preview.
                assistant.content = text;
                turnHasContentRef.current = true;
                setPhase('writing', { hasContent: true }, turn);
              } else {
                assistant.content += text;
                if (agentPhaseRef.current !== 'writing' && agentPhaseRef.current !== 'tool_plan') {
                  setPhase('writing', { hasContent: true }, turn);
                }
              }
              persistStream({ ...assistant });

              // MID-TURN PREFETCH: extract file paths and prefetch in background
              // Only run every 1024 chars to avoid overhead
              if (bridge.connected && assistant.content.length % 1024 < text.length) {
                const mentionedPaths = extractMentionedPaths(assistant.content);
                if (mentionedPaths.length > 0) {
                  // Fire and forget - don't block streaming
                  prefetchPinnedPaths(mentionedPaths.join(' '), workspaceRoot).catch(() => {});
                }
              }
            },
            onReasoningDelta: (text) => {
              assistant.reasoning = (assistant.reasoning || '') + text;
              if (!turnHasReasoningRef.current) {
                turnHasReasoningRef.current = true;
                setPhase(
                  'reasoning',
                  {
                    hasReasoning: true,
                    reasoningStartedAt: Date.now(),
                  },
                  turn,
                );
              } else if (
                agentPhaseRef.current !== 'writing' &&
                agentPhaseRef.current !== 'reasoning' &&
                !turnHasContentRef.current
              ) {
                setPhase('reasoning', { hasReasoning: true }, turn);
              }
              persistStream({ ...assistant });
            },
          });
          let toolCalls = result.toolCalls;
          assistant.toolCalls = toolCalls.length ? toolCalls : undefined;
          // Safety net: detokenize full strings (covers non-SSE / missed-delta paths)
          assistant.content = detokenizeArtifacts(assistant.content || '');
          if (assistant.reasoning) {
            assistant.reasoning = detokenizeArtifacts(assistant.reasoning);
          }
          const splitThink = splitThinkFromContent(assistant.content || '');
          if (splitThink.thinking) {
            assistant.reasoning = [assistant.reasoning, splitThink.thinking].filter(Boolean).join('\n\n');
            assistant.content = splitThink.content;
          }
          assistant.content = stripCollapsedText(assistant.content || '');
          if (assistant.reasoning) assistant.reasoning = stripCollapsedText(assistant.reasoning);
          if (result.tokenCollapsed && isMissingContentAnswer(assistant.content)) {
            assistant.content = TOKEN_COLLAPSE_REPLY_NOTE;
            assistant.reasoning = looksLikeTokenCollapse(assistant.reasoning || '')
              ? ''
              : assistant.reasoning;
          }
          assistant.status = 'complete';
          const finalizeAssistant = async () => {
            const coalesceOn = settingsRef.current.coalesceReasoningToContent !== false;
            enforceThoughtNoCode(assistant, { liftToContent: !isPlanMode });
            if (isPlanMode) applyPlanReasoningGuard(assistant);
            finalizeReasoningChannel(assistant, coalesceOn && !isPlanMode);
            if (isPlanMode) applyPlanReasoningGuard(assistant);
            assistant.content = liftTodoListToContent(assistant.content || '', assistant.reasoning || '');
            if (isPlanMode) applyPlanReasoningGuard(assistant);
            else enforceThoughtNoCode(assistant, { liftToContent: true });
            grokAcc.push(...((await runGrokLayer(assistant)) || []));
            paintWorkflow(assistant);
            flushStreamPersist({ ...assistant });
          };
          await finalizeAssistant();

          if (ac.signal.aborted) {
            // Already finalized + attempted grok above (runGrokLayer no-ops in planMode).
            if (!(assistant.content || '').trim() && !(assistant.reasoning || '').trim()) {
              assistant.content = '(stopped)';
              flushStreamPersist({ ...assistant });
            }
            stopReason = 'abort';
            break;
          }
          if (!toolCalls.length) {
            if (result.tokenCollapsed || assistant.content === TOKEN_COLLAPSE_REPLY_NOTE) {
              setPhase('error', {}, turn);
              stopReason = 'error';
              flushStreamPersist({ ...assistant });
              break;
            }
            const content = assistant.content || '';
            const detectContent = stripThinkForDetect(content);
            const answerComplete = isAnswerCompleteMarker(content);
            const junkTurn = shouldSkipSelfDeepen(detectContent, { status: assistant.status });
            const isBuildOutput = looksLikeBuildOutput(detectContent, toolsUsed);
            const parsedTodos = parseTodoItems(detectContent);
            const isPlaceholderOutput = looksLikePlaceholderOutput(detectContent);
            const toolEvidence = current
              .filter((m) => m.role === 'tool')
              .map((m) => m.content || '')
              .join('\n');
            const verifyText = `${detectContent}\n${toolEvidence}`;
            const retryNarration =
              looksLikeToolRetryNarration(detectContent) ||
              looksLikeToolRetryNarration(assistant.reasoning || '');
            const fakeParsed = parseFakeToolCalls(detectContent);
            if (fakeParsed.length) {
              fakeToolParsedCount += fakeParsed.length;
              toolCalls = fakeParsed.map((f) => ({
                id: uid('tool'),
                name: f.name as ToolCallPayload['name'],
                arguments: f.arguments,
                status: 'pending' as const,
              }));
              assistant.toolCalls = toolCalls;
              flushStreamPersist({ ...assistant });
              // Fall through into existing tool execution path.
            } else if ((looksLikeFakeToolTheater(detectContent) || retryNarration) && !fakeToolRetryUsed) {
              // One strike only — never loop "emit API tool_calls" nudges across deepen.
              fakeToolRetryUsed = true;
              setPhase(
                'self_deepen',
                { deepenPass: deepensUsed + 1, deepenMax: deepenCap },
                turn,
              );
              const nudge: Message = {
                id: uid('msg'),
                threadId: thread.id,
                role: 'user',
                content: buildFakeToolNudge(),
                createdAt: Date.now(),
                status: 'complete',
              };
              current = persist(nudge);
              continue;
            } else if ((looksLikeFakeToolTheater(detectContent) || retryNarration) && fakeToolRetryUsed) {
              // Already nudged once; stop rather than deepen into another theater loop.
              setPhase('finishing', {}, turn);
              stopReason = deepensUsed > 0 ? 'deepened' : 'no_tools';
              break;
            } else {
              // Empty content after coalesce: no API recovery. Setting off → reasoning panel only.
              if (isMissingContentAnswer(assistant.content)) {
                const hasReasoning = !!(assistant.reasoning || '').trim();
                if (hasReasoning && settingsRef.current.coalesceReasoningToContent === false) {
                  setPhase('finishing', {}, turn);
                  stopReason = deepensUsed > 0 ? 'deepened' : 'no_tools';
                  break;
                }
                setPhase(hasReasoning ? 'finishing' : 'error', {}, turn);
                if (!hasReasoning) {
                  assistant.content = EMPTY_CONTENT_REPLY_NOTE;
                  flushStreamPersist({ ...assistant });
                }
                stopReason = deepensUsed > 0 ? 'deepened' : 'no_tools';
                break;
              }

              if (answerComplete) {
                assistant.content = stripAnswerCompleteMarker(content);
                flushStreamPersist({ ...assistant });
                // Operator mid-run overrides ANSWER_COMPLETE — integrate and continue.
                if (drainMidRunMessages()) {
                  continue;
                }
                // After strip: empty content → coalesce again (zero-cost), never API retry.
                if (isMissingContentAnswer(assistant.content)) {
                  await finalizeAssistant();
                  if (isMissingContentAnswer(assistant.content)) {
                    const hasReasoning = !!(assistant.reasoning || '').trim();
                    if (hasReasoning && settingsRef.current.coalesceReasoningToContent === false) {
                      setPhase('finishing', {}, turn);
                      stopReason = deepensUsed > 0 ? 'deepened' : 'no_tools';
                      break;
                    }
                    setPhase(hasReasoning ? 'finishing' : 'error', {}, turn);
                    if (!hasReasoning) {
                      assistant.content = EMPTY_CONTENT_REPLY_NOTE;
                      flushStreamPersist({ ...assistant });
                    }
                    stopReason = deepensUsed > 0 ? 'deepened' : 'no_tools';
                    break;
                  }
                }
                setPhase('finishing', {}, turn);
                stopReason = deepensUsed > 0 ? 'deepened' : 'no_tools';
                break;
              }
              if (
                grokBuildProcess &&
                !junkTurn &&
                !isBuildOutput &&
                !answerComplete
              ) {
                const todos = parsedTodos;
                if (todos.length && !buildImplementNudgeUsed) {
                  buildImplementNudgeUsed = true;
                  setPhase(
                    'self_deepen',
                    { deepenPass: deepensUsed + 1, deepenMax: deepenCap },
                    turn,
                  );
                  const nudge: Message = {
                    id: uid('msg'),
                    threadId: thread.id,
                    role: 'user',
                    content: buildBuildModeImplementNudge({ toolsOff: !agentProfile.sendTools }),
                    createdAt: Date.now(),
                    status: 'complete',
                  };
                  current = persist(nudge);
                  continue;
                }
                if (!todos.length && !buildTodoNudgeUsed) {
                  buildTodoNudgeUsed = true;
                  setPhase(
                    'self_deepen',
                    { deepenPass: deepensUsed + 1, deepenMax: deepenCap },
                    turn,
                  );
                  const nudge: Message = {
                    id: uid('msg'),
                    threadId: thread.id,
                    role: 'user',
                    content: buildBuildModeTodoNudge({ toolsOff: !agentProfile.sendTools }),
                    createdAt: Date.now(),
                    status: 'complete',
                  };
                  current = persist(nudge);
                  continue;
                }
              }

              if (
                grokBuildProcess &&
                !buildVerifyNudgeUsed &&
                !junkTurn &&
                isBuildOutput &&
                !looksLikeVerifyEvidence(verifyText, toolsUsed) &&
                !answerComplete
              ) {
                buildVerifyNudgeUsed = true;
                setPhase(
                  'self_deepen',
                  { deepenPass: deepensUsed + 1, deepenMax: deepenCap },
                  turn,
                );
                const nudge: Message = {
                  id: uid('msg'),
                  threadId: thread.id,
                  role: 'user',
                  content: buildVerifyBeforeDoneNudge(),
                  createdAt: Date.now(),
                  status: 'complete',
                };
                current = persist(nudge);
                continue;
              }

              // Reasoning mapped file steps but content never executed them, and nothing
              // was written this run (grok fences or write tools). Nudge once to execute
              // — placed ABOVE the footerDone/shouldEvidenceDeepen block so a text-only
              // Done footer cannot short-circuit it. One-shot flag bounds the loop.
              if (
                !isPlanMode &&
                !isAskMode &&
                !reasoningExecNudgeUsed &&
                settingsRef.current.selfDeepenEnabled !== false &&
                !answerComplete &&
                !junkTurn &&
                grokAcc.length === 0 &&
                !hasBuildFileWrites(toolsUsed) &&
                !!lastUser?.content &&
                !looksReadOnlyOrControlPrompt(lastUser.content) &&
                !looksFactualQuestion(lastUser.content) &&
                !looksPromptOnlyRequest(lastUser.content) &&
                reasoningStepsNotExecuted(assistant.reasoning || '', detectContent)
              ) {
                reasoningExecNudgeUsed = true;
                setPhase('self_deepen', { deepenPass: deepensUsed + 1, deepenMax: deepenCap }, turn);
                const nudge: Message = {
                  id: uid('msg'),
                  threadId: thread.id,
                  role: 'user',
                  content: buildReasoningExecuteNudge(),
                  createdAt: Date.now(),
                  status: 'complete',
                };
                current = persist(nudge);
                continue;
              }

              const liveDeepen = settingsRef.current;
              const deepenPasses = clampSelfDeepenPasses(liveDeepen.selfDeepenPasses);
              const deepenOn =
                liveDeepen.selfDeepenEnabled !== false && deepenPasses > 0 && deepensUsed < deepenPasses;
              const filesLanded =
                grokAcc.some((r) => r.status === 'ok') || hasBuildFileWrites(toolsUsed);
              const missingFiles =
                !!grokBuildProcess &&
                !filesLanded &&
                !isBuildOutput;
              // Already shipped a valid Done/Continue footer — treat as complete; skip an extra deepen turn.
              // A footer without landed files on a build is still a fragment.
              const footerDone =
                liveDeepen.completionFooterEnabled !== false &&
                hasValidCompletionFooter(content) &&
                (filesLanded || !grokBuildProcess);
              const openTodos =
                hasOpenTodos(todosRef.current) || parsedTodos.some((t) => !t.done);

              // EARLY COMPLETION FAST-PATH: If answer is clearly complete, skip all deepen checks
              const isClearlyComplete =
                answerComplete &&
                toolsUsed.length > 0 &&
                !isPlaceholderOutput &&
                looksLikeVerifyEvidence(verifyText, toolsUsed) &&
                filesLanded;

              if (isClearlyComplete) {
                setPhase('finishing', {}, turn);
                paintWorkflow(assistant);
                flushStreamPersist({ ...assistant });
                stopReason = deepensUsed > 0 ? 'deepened' : 'no_tools';
                break;
              }
              if (
                grokBuildProcess &&
                !placeholderNudgeUsed &&
                isPlaceholderOutput &&
                !junkTurn &&
                !answerComplete
              ) {
                placeholderNudgeUsed = true;
                setPhase(
                  'self_deepen',
                  { deepenPass: deepensUsed + 1, deepenMax: deepenCap },
                  turn,
                );
                const nudge: Message = {
                  id: uid('msg'),
                  threadId: thread.id,
                  role: 'user',
                  content: buildPlaceholderCodeNudge(),
                  createdAt: Date.now(),
                  status: 'complete',
                };
                current = persist(nudge);
                continue;
              }
              if (
                shouldEvidenceDeepen({
                  content,
                  deepenOn,
                  junkTurn,
                  footerDone,
                  answerComplete,
                  openTodos,
                  filesLanded,
                  missingFiles,
                })
              ) {
                deepensUsed += 1;
                setPhase(
                  'self_deepen',
                  { deepenPass: deepensUsed, deepenMax: deepenPasses || deepenCap },
                  turn,
                );
                const writeRoot = connectedBridgeWriteRoot({
                  workspaceRoot,
                  appRoot,
                  bridgeRoot: bridge.validWorkspaceRoot || bridge.currentRoot,
                });
                const nudge: Message = {
                  id: uid('msg'),
                  threadId: thread.id,
                  role: 'user',
                  content: buildSelfDeepenNudge({
                    completeness: liveDeepen.deepenCompleteness !== false,
                    landFiles: missingFiles || (grokBuildProcess && !filesLanded),
                    toolsOff: !agentProfile.sendTools,
                    workspaceRoot: writeRoot,
                  }),
                  createdAt: Date.now(),
                  status: 'complete',
                };
                current = persist(nudge);
                // Mid-run drain happens at the top of the next turn — avoid a second nudge here.
                continue;
              }
              // Would stop: if mid-run notes arrived, integrate and keep going.
              if (drainMidRunMessages()) {
                continue;
              }
              if (
                !planMode &&
                !proveImproveNudgeUsed &&
                !buildTodoNudgeUsed &&
                !buildImplementNudgeUsed &&
                !buildVerifyNudgeUsed &&
                lastUser?.content &&
                shouldProveImproveNudge({
                  userText: lastUser.content,
                  content,
                  toolsUsed,
                }) &&
                !answerComplete
              ) {
                proveImproveNudgeUsed = true;
                setPhase(
                  'self_deepen',
                  { deepenPass: deepensUsed + 1, deepenMax: deepenCap },
                  turn,
                );
                const nudge: Message = {
                  id: uid('msg'),
                  threadId: thread.id,
                  role: 'user',
                  content: buildProveImproveNudge(),
                  createdAt: Date.now(),
                  status: 'complete',
                };
                current = persist(nudge);
                continue;
              }
              const capStop = buildCapabilityPlan(
                `${extractLockedGoal(current)}\n${lastOperatorPrompt(current) || lastUser?.content || ''}`,
                capabilityCache,
              );
              if (!planMode && !mcpFollowNudgeUsed && needsMcpFollowNudge(capStop, toolsUsed) && !answerComplete) {
                mcpFollowNudgeUsed = true;
                setPhase(
                  'self_deepen',
                  { deepenPass: deepensUsed + 1, deepenMax: deepenCap },
                  turn,
                );
                const nudge: Message = {
                  id: uid('msg'),
                  threadId: thread.id,
                  role: 'user',
                  content: buildMcpFollowNudge(capStop),
                  createdAt: Date.now(),
                  status: 'complete',
                };
                current = persist(nudge);
                continue;
              }
              if (
                !planMode &&
                !skillReadNudgeUsed &&
                needsSkillReadNudge(capStop, toolsUsed) &&
                !answerComplete
              ) {
                skillReadNudgeUsed = true;
                setPhase(
                  'self_deepen',
                  { deepenPass: deepensUsed + 1, deepenMax: deepenCap },
                  turn,
                );
                const nudge: Message = {
                  id: uid('msg'),
                  threadId: thread.id,
                  role: 'user',
                  content: buildSkillReadNudge(capStop),
                  createdAt: Date.now(),
                  status: 'complete',
                };
                current = persist(nudge);
                continue;
              }
              if (
                !planMode &&
                !skillCreateNudgeUsed &&
                !skillReadNudgeUsed &&
                needsSkillCreateNudge(capStop, toolsUsed) &&
                !answerComplete
              ) {
                skillCreateNudgeUsed = true;
                setPhase(
                  'self_deepen',
                  { deepenPass: deepensUsed + 1, deepenMax: deepenCap },
                  turn,
                );
                const nudge: Message = {
                  id: uid('msg'),
                  threadId: thread.id,
                  role: 'user',
                  content: buildSkillCreateNudge(capStop),
                  createdAt: Date.now(),
                  status: 'complete',
                };
                current = persist(nudge);
                continue;
              }
              // Content is non-empty here (coalesce / empty handling above).
              setPhase('finishing', {}, turn);
              const audit = paintWorkflow(assistant, toolEvidence);
              flushStreamPersist({ ...assistant });

              if (
                !planMode &&
                !changeVerifyNudgeUsed &&
                settingsRef.current.completionFooterEnabled !== false &&
                !junkTurn &&
                !answerComplete &&
                audit?.needsVerificationNudge &&
                audit?.nudgePrompt
              ) {
                changeVerifyNudgeUsed = true;
                setPhase(
                  'self_deepen',
                  { deepenPass: deepensUsed + 1, deepenMax: deepenCap },
                  turn,
                );
                const nudge: Message = {
                  id: uid('msg'),
                  threadId: thread.id,
                  role: 'user',
                  content: audit.nudgePrompt,
                  createdAt: Date.now(),
                  status: 'complete',
                };
                current = persist(nudge);
                continue;
              }

              stopReason = deepensUsed > 0 ? 'deepened' : 'no_tools';
              break;
            }
          }

          if (
            !isPlanMode &&
            !isAskMode &&
            !inspectBeforeWriteUsed &&
            lastUser?.content &&
            needsInspectBeforeWrite({
              userText: lastUser.content,
              toolsUsed,
              pendingToolNames: toolCalls.map((t) => t.name),
              trivialEdit: looksTrivialFileEdit(lastUser.content),
            })
          ) {
            inspectBeforeWriteUsed = true;
            assistant.toolCalls = undefined;
            flushStreamPersist({ ...assistant, toolCalls: undefined });
            setPhase(
              'self_deepen',
              { deepenPass: deepensUsed + 1, deepenMax: deepenCap },
              turn,
            );
            const nudge: Message = {
              id: uid('msg'),
              threadId: thread.id,
              role: 'user',
              content: buildInspectBeforeWriteNudge(),
              createdAt: Date.now(),
              status: 'complete',
            };
            current = persist(nudge);
            continue;
          }

          setPhase('tool_plan', { toolName: undefined }, turn);
          let executedAny = false;
          let latest = messagesRef.current;

          // TOOL DAG SCHEDULING: Reads → Writes → Gated/Shell
          // All reads run first in parallel, never blocked by writes
          const READ_TOOLS = new Set(['read_file', 'grep', 'list_dir', 'glob', 'semantic_search', 'file_outline', 'web_fetch', 'web_search']);
          const WRITE_TOOLS = new Set(['write_file', 'apply_patch', 'edit_file', 'search_replace', 'str_replace']);

          const readTools: ToolCallPayload[] = [];
          const writeTools: ToolCallPayload[] = [];
          const gatedTools: ToolCallPayload[] = [];

          for (const tool of toolCalls) {
            toolsUsed.push(tool.name);
            writeCalls.push(tool);
            if (READ_TOOLS.has(tool.name)) {
              readTools.push(tool);
            } else if (WRITE_TOOLS.has(tool.name)) {
              writeTools.push(tool);
            } else {
              gatedTools.push(tool);
            }
          }

          // Execute READ tools first in parallel (never blocked)
          if (readTools.length > 0) {
            setPhase('tool_exec', { toolName: readTools.length > 1 ? `${readTools.length} reads` : readTools[0].name }, turn);

            const results = await Promise.all(
              readTools.map(async (tool) => {
                const abortedResult = () => ({
                  msg: makeToolMessage({ ...tool, status: 'error' as const, result: 'aborted' }, 'aborted'),
                  executed: false,
                });
                if (ac.signal.aborted) return { tool, ...abortedResult() };
                const result = await raceAbort(executeTool(tool), ac.signal, abortedResult);
                return { tool, ...result };
              })
            );

            for (const { msg, executed } of results) {
              if (executed) executedAny = true;
              latest = persist(msg);
            }
          }

          // Execute WRITE tools sequentially (order matters)
          for (const tool of writeTools) {
            setPhase('tool_exec', { toolName: tool.name }, turn);
            if (ac.signal.aborted) {
              latest = persist(makeToolMessage({ ...tool, status: 'error', result: 'aborted' }, 'aborted'));
              continue;
            }
            const { msg, executed } = await raceAbort(executeTool(tool), ac.signal, () => ({
              msg: makeToolMessage({ ...tool, status: 'error' as const, result: 'aborted' }, 'aborted'),
              executed: false,
            }));
            if (executed) {
              executedAny = true;
              if (!hasAutoCheckpointedRef.current && bridge.connected) {
                hasAutoCheckpointedRef.current = true;
                try {
                  const label = `auto: turn ${turn} - ${tool.name}`;
                  const ckpt = await bridge.checkpointSave(label);
                  if (ckpt) {
                    assistant.checkpointId = ckpt;
                    assistant.checkpointLabel = label;
                    flushStreamPersist({ ...assistant });
                  }
                } catch (e) {
                  console.warn('Auto-checkpoint failed:', e);
                }
              }
              if (settingsRef.current.postEditDiagnostics) {
                const diags = await runWorkspaceDiagnostics(workspaceRoot);
                if (diags.length > 0) {
                  assistant.diagnostics = diags;
                  flushStreamPersist({ ...assistant });
                }
              }
            }
            latest = persist(msg);
          }

          // Execute GATED tools last (sequential, potentially interactive)
          for (const tool of gatedTools) {
            setPhase('tool_exec', { toolName: tool.name }, turn);
            if (ac.signal.aborted) {
              latest = persist(makeToolMessage({ ...tool, status: 'error', result: 'aborted' }, 'aborted'));
              continue;
            }
            const { msg, executed } = await raceAbort(executeTool(tool), ac.signal, () => ({
              msg: makeToolMessage({ ...tool, status: 'error' as const, result: 'aborted' }, 'aborted'),
              executed: false,
            }));
            if (executed) executedAny = true;
            latest = persist(msg);
          }

          current = latest;
          paintWorkflow(assistant, toolEvidence);
          flushStreamPersist({ ...assistant });
          if (ac.signal.aborted) {
            stopReason = 'abort';
            break;
          }
          if (!executedAny) {
            setPhase('waiting_gate', { toolName: toolCalls[0]?.name }, turn);
            stopReason = 'pending_gate';
            break;
          }
          // Mid-run drain at next turn top (avoids double integrate nudge).
          if (turn === turnCap) {
            stopReason = 'cap';
          }
        } catch (err) {
          if ((err as Error).name === 'AbortError') {
            setPhase('stopped', {}, turn);
            assistant.status = 'complete';
            const coalesceOnAbort = settingsRef.current.coalesceReasoningToContent !== false;
            enforceThoughtNoCode(assistant, { liftToContent: !isPlanMode });
            if (isPlanMode) applyPlanReasoningGuard(assistant);
            finalizeReasoningChannel(assistant, coalesceOnAbort && !isPlanMode);
            if (isPlanMode) applyPlanReasoningGuard(assistant);
            else enforceThoughtNoCode(assistant, { liftToContent: true });
            if (!assistant.content.trim() && !assistant.reasoning?.trim()) assistant.content = '(stopped)';
            // Apply diffs from coalesced reasoning even on abort (no-op if planMode).
            grokAcc.push(...((await runGrokLayer(assistant)) || []));
            paintWorkflow(assistant);
            flushStreamPersist({ ...assistant });
            stopReason = 'abort';
          } else {
            setPhase('error', {}, turn);
            assistant.status = 'error';
            assistant.content = assistant.content || (err instanceof Error ? err.message : String(err));
            stopReason = 'error';
          }
          flushStreamPersist({ ...assistant });
          break;
        }
      }
      if (turnsDone >= turnCap && stopReason === 'no_tools') {
        /* completed last turn with no tools — already no_tools */
      } else if (turnsDone >= turnCap && stopReason !== 'pending_gate' && stopReason !== 'abort' && stopReason !== 'error') {
        // If we exited the loop by exhausting turns after tools, mark cap
        const last = current[current.length - 1];
        if (last?.role === 'tool') stopReason = 'cap';
      }
    } finally {
      abortRef.current = null;
      if (stopReason === 'abort') setPhase('stopped', {}, turnsDone);
      else if (stopReason === 'error') setPhase('error', {}, turnsDone);
      else if (stopReason === 'pending_gate') setPhase('waiting_gate', {}, turnsDone);
      else setPhase('finishing', {}, turnsDone);
      setBusy(false);
      setLoopTurn(0);
      loopTurnRef.current = 0;
      // Persist any undrained mid-run notes as an integrate nudge so they remain in context.
      if (pendingMidRunRef.current.length) {
        const pending = pendingMidRunRef.current.splice(0, pendingMidRunRef.current.length);
        setQueuedMidRun(0);
        queuedMidRunRef.current = 0;
        if (pending.length) {
          persist({
            id: uid('msg'),
            threadId: thread.id,
            role: 'user',
            content: buildMidRunIntegrateNudge(pending),
            createdAt: Date.now(),
            status: 'complete',
          });
        }
      }
      const lastAsst = [...messagesRef.current].reverse().find((m) => m.role === 'assistant');
      if (lastAsst) {
        paintWorkflow(lastAsst);
        persist({ ...lastAsst });
      }
      const toolEvidenceEnd = messagesRef.current
        .filter((m) => m.role === 'tool')
        .map((m) => m.content || '')
        .join('\n');
      const proofText = `${lastAsst?.content || ''}\n${toolEvidenceEnd}`;
      const uniqueTools = [...new Set(toolsUsed)];
      const proof = buildRunProof(proofText, uniqueTools);
      finishRun(stopReason, {
        startedAt,
        turns: turnsDone,
        tools: uniqueTools,
        theaterRetries: fakeToolRetryUsed ? 1 : 0,
        fakeToolParsed: fakeToolParsedCount,
        deepenPasses: deepensUsed,
        verifyEvidence: proof.verify,
        provenImprovement: proof.proven,
        inspectBeforeWrite: inspectBeforeWriteUsed,
        proof,
      });
      if (stopReason === 'cap') {
        persist({
          id: uid('msg'),
          threadId: thread.id,
          role: 'assistant',
          content: buildIncompleteCapNote(turnCap),
          createdAt: Date.now(),
          status: 'complete',
        });
      }
      // Compact idle monitor remembers last stop phase briefly.
      const endPhase: AgentPhase =
        stopReason === 'abort'
          ? 'stopped'
          : stopReason === 'error'
            ? 'error'
            : stopReason === 'cap'
              ? 'stopped'
            : stopReason === 'pending_gate'
              ? 'waiting_gate'
              : 'idle';
      agentPhaseRef.current = endPhase;
      setAgentPhase(endPhase);
      setShowIdleMonitor(endPhase !== 'idle');
      if (endPhase === 'idle') {
        onAgentStatusRef.current?.('');
      } else {
        pushAgentStatus(endPhase, phaseMetaRef.current, turnsDone, 0);
      }
    }
  };

  const continueAfterTool = useCallback(
    async (messageId: string) => {
      if (busyRef.current) return;
      const list = messagesRef.current;
      if (!canResumeAfterTool(list, messageId)) return;
      await runCompletion(list);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [thread, settings, workspaceRoot, autoAcceptEdits],
  );
  continueAfterToolRef.current = continueAfterTool;

  const sendText = async (textRaw: string) => {
    const text = textRaw.trim();
    if (!text) return;

    const gate = workspaceGate(workspaceRoot, appRoot);
    const needsDir = !gate.ok || (messagesRef.current.length === 0 && !dirConfirmed);
    if (needsDir && !busy) return;

    const midRunOn = settings.midRunInjectEnabled !== false;
    if (busy) {
      if (!midRunOn) return;
      // Queue mid-run barge-in: finish current atomic step, then drain at turn boundary.
      pendingMidRunRef.current.push(text);
      setQueuedMidRun(pendingMidRunRef.current.length);
      setInput('');
      const user: Message = {
        id: uid('msg'),
        threadId: thread.id,
        role: 'user',
        content: `${MID_RUN_PREFIX}${text}`,
        createdAt: Date.now(),
        status: 'complete',
      };
      persist(user);
      nearBottomRef.current = true;
      setShowJump(false);
      requestAnimationFrame(() => scrollToBottom(true));
      queuedMidRunRef.current = pendingMidRunRef.current.length;
      pushAgentStatus(agentPhaseRef.current, phaseMetaRef.current, loopTurn, queuedMidRunRef.current);
      return;
    }

    setInput('');
    const user: Message = {
      id: uid('msg'),
      threadId: thread.id,
      role: 'user',
      content: text,
      createdAt: Date.now(),
      status: 'complete',
    };
    const history = persist(user);
    nearBottomRef.current = true;
    setShowJump(false);
    requestAnimationFrame(() => scrollToBottom(true));
    const title = thread.title === 'New session' ? text.slice(0, 48) : thread.title;
    const updated = { ...thread, title, updatedAt: Date.now() };
    upsertThread(updated);
    onThreadUpdate(updated);
    await runCompletion(history);
  };

  sendTextRef.current = sendText;

  const send = async () => {
    await sendText(input);
  };

  const handleContinuePrompt = useCallback((text: string) => {
    void sendTextRef.current(text);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retry = useCallback(async () => {
    if (busy) return;
    if (!workspaceGate(workspaceRoot, appRoot).ok) return;
    const list = messagesRef.current;
    const lastUserIdx = [...list].map((m, i) => [m, i] as const).reverse().find(([m]) => m.role === 'user');
    if (!lastUserIdx) return;
    const trimmed = list.slice(0, lastUserIdx[1] + 1);
    messagesRef.current = trimmed;
    setMessages(trimmed);
    setHiddenPrefix(Math.max(0, trimmed.length - MESSAGE_WINDOW));
    replaceThreadMessages(thread.id, trimmed);
    await runCompletion(trimmed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, thread, settings, workspaceRoot, autoAcceptEdits]);

  const fillInput = useCallback((text: string) => {
    setInput(text);
    window.setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const len = text.length;
      el.setSelectionRange(len, len);
    }, 0);
  }, []);


  const handleGitCommit = useCallback(
    (msg: Message) => {
      void runGitCommitClick(msg);
    },
    [runGitCommitClick],
  );
  const handleCreatePr = useCallback(
    (msg: Message) => {
      void runCreatePrClick(msg);
    },
    [runCreatePrClick],
  );
  const handleCheckpointRestore = useCallback(
    (msg: Message) => {
      void runCheckpointRestoreClick(msg);
    },
    [runCheckpointRestoreClick],
  );

  const restoreCheckpointById = useCallback(
    async (checkpointId: string) => {
      if (busyRef.current) return;
      try {
        await bridge.checkpointRestore(checkpointId);
        onGitMaybeChangedRef.current?.();
      } catch (err) {
        console.error('Failed to restore checkpoint:', err);
      }
    },
    [],
  );
  const handleWriteFile = useCallback(
    (msg: Message) => {
      void runWriteFileClick(msg);
    },
    [runWriteFileClick],
  );

  const handleShellExecuted = useCallback(
    (msg: Message, result: string) => {
      if (busyRef.current) return;
      const tool = msg.toolCall;
      if (!tool || tool.name !== 'shell') return;
      if (tool.status === 'executed' || tool.status === 'error') return;
      persist({ ...msg, content: result, toolCall: { ...tool, status: 'executed', result } });
      void continueAfterTool(msg.id);
    },
    [persist, continueAfterTool],
  );

  const statusLabel = useMemo(() => {
    const q = queuedMidRun > 0 ? ' · queued' : '';
    if (busy) {
      const short = agentPhaseShortLabel(agentPhase, phaseMeta);
      if (loopTurn > 0) return `${short || 'agent'} · ${loopTurn}/${maxTurns}${q}`;
      return `${short || 'streaming'}${q}`;
    }
    const last = messages[messages.length - 1];
    if (last?.status === 'error' || agentPhase === 'error') return 'error';
    if (agentPhase === 'waiting_gate') return agentPhaseLabel('waiting_gate', phaseMeta);
    if (agentPhase === 'stopped') return 'stopped';
    return formatIdleSubtitle(lastStopReason, 'idle');
  }, [busy, loopTurn, messages, maxTurns, lastStopReason, queuedMidRun, agentPhase, phaseMeta]);

  const grokHeader = formatGrokStatus(
    latestGrok,
    autoAcceptEdits,
    bridgeStatus === 'connected',
    grokEmptyHint,
  );
  const workspaceOk = workspaceGate(workspaceRoot, appRoot);
  const needsWorkingDir = !workspaceOk.ok || (messages.length === 0 && !dirConfirmed);
  const completenessOn = settings.deepenCompleteness !== false;

  const patchDeepenCompleteness = (next: boolean) => {
    const merged = { ...settingsRef.current, deepenCompleteness: next };
    setSettings(merged);
    onSettingsChange?.(merged);
  };

  const deepenThisAnswerNow = () => {
    // Keep Chat/Settings/Jobs agreed when the user asks for a one-shot deepen.
    if (!completenessOn) patchDeepenCompleteness(true);
    void sendTextRef.current(buildDeepenNowPrompt());
  };


  return {
    messages,
    messagesRef,
    hiddenPrefix,
    setHiddenPrefix,
    input,
    setInput,
    busy,
    loopTurn,
    maxTurns,
    lastProof,
    bridgeStatus,
    appRoot,
    setDirConfirmed,
    needsWorkingDir,
    grokById,
    grokHeader,
    planChecklist,
    agentPhase,
    phaseMeta,
    showIdleMonitor,
    queuedMidRun,
    showJump,
    statusLabel,
    agentProfile,
    effectiveTools,
    completenessOn,
    runStartedAtRef,
    scrollerRef,
    inputRef,
    persist,
    scrollToBottom,
    sendText,
    send,
    stop,
    retry,
    fillInput,
    continueAfterTool,
    handleGitCommit,
    handleCreatePr,
    handleCheckpointRestore,
    restoreCheckpointById,
    handleWriteFile,
    handleShellExecuted,
    handleContinuePrompt,
    patchDeepenCompleteness,
    deepenThisAnswerNow,
    agentMode: resolvedAgentMode,
  };
}

