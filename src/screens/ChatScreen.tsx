import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ArrowLeft, ArrowDown, RotateCcw, Send, Square, ListChecks } from 'lucide-react';
import { cn } from '../lib/cn';
import {
  buildDeepenNowPrompt,
  DEEPEN_COMPLETENESS_CHAT_LABEL,
  DEEPEN_COMPLETENESS_TOOLTIP,
} from '../lib/deepenComplete';
import { MessageBubble } from '../components/chat/MessageBubble';
import { AgentStatusMonitor } from '../components/chat/AgentStatusMonitor';
import { WorkingDirPrompt } from '../components/chat/WorkingDirPrompt';
import {
  agentPhaseLabel,
  agentPhaseShortLabel,
  finalizeReasoningChannel,
  stripThinkingWrappers,
  type AgentPhase,
  type AgentPhaseMeta,
} from '../lib/agentPhase';
import { bridge, type BridgeStatus } from '../lib/bridgeClient';
import { shouldWriteWorkspaceFiles, workspaceGate } from '../lib/workspaceGuard';
import {
  applyGrokEdits,
  formatGrokStatus,
  isPathInsideRoot,
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
  filterPlanModeTools,
  parseTodoBullets,
  parseTodoItems,
  type TodoItem,
  looksExploreIntent,
  shouldApplyBuildProcess,
  buildReasoningThenBuildNudge,
  buildBuildModeTodoNudge,
  buildBuildModeImplementNudge,
  liftTodoListToContent,
  looksLikeBuildOutput,
  shouldSkipSelfDeepen,
  looksReadOnlyOrControlPrompt,
} from '../lib/agentHelpers';
import { looksLikeProvenImprovement, buildProveImproveNudge } from '../lib/proveImprove';
import {
  PLAN_CODE_OMITTED_NOTE,
  liftReasoningWork,
  stripImplementationFromText,
  enforceThoughtNoCode,
} from '../lib/reasoningWork';
import { hasValidCompletionFooter } from '../lib/completionFooter';
import { asStringList, executeAgentTool, toolArgString } from '../lib/agentTools';
import { executeMcpToolCall, listConnectedMcpTools, mcpToolsToOpenAi, isMcpToolName } from '../lib/mcpClient';
import { buildFakeToolNudge, looksLikeFakeToolTheater, parseFakeToolCalls } from '../lib/fakeToolCalls';
import { detokenizeArtifacts } from '../lib/detokenizeArtifacts';
import { streamChatCompletion } from '../lib/sse';
import { getMessages, recordAgentRun, replaceThreadMessages, saveMessage, setSettings, uid, upsertThread } from '../lib/storage';
import { formatSkillsCatalogPrompt, formatVerifyStrictSkillPrompt, shouldAutoInjectVerifyStrict, toCatalogEntries, type SkillCatalogEntry, type SkillRecord } from '../lib/skills';
import { formatAutoLoadedSkillsPrompt, formatProjectMemoryPrompt } from '../lib/projectMemory';
import { formatSessionMemory, mempalaceOpts } from '../lib/mempalace';
import { ModelSettingsGuidePanel } from '../components/common/ModelSettingsGuide';
import { buildModelAgentProfile } from '../lib/modelAgentProfile';
import { peekFeatherlessModel } from '../lib/featherlessLimits';
import { TASK_GRAPH_PATH, formatTaskGraphPrompt, parseTaskGraph, shouldUseTaskGraph } from '../lib/taskGraph';
import type { ChatOpenAiMessage, ClientSettings, Message, Tab, Thread, ToolCallPayload } from '../types';

import { PLAN_MODE_TOOLS } from '../types';

/** Render at most this many newest messages; older ones load on demand. */
const MESSAGE_WINDOW = 80;

/** Strip Qwen/R1 think wrappers before theater / build / deepen heuristics. */
function stripThinkForDetect(text: string): string {
  const withoutBlocks = (text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, ' ')
    .replace(/<\/?think>/gi, ' ');
  return stripThinkingWrappers(withoutBlocks);
}


export interface ChatScreenHandle {
  stop: () => void;
  retry: () => Promise<void>;
  continueAfterTool: (messageId: string) => Promise<void>;
  fillInput: (text: string) => void;
}

interface Props {
  thread: Thread;
  settings: ClientSettings;
  autoAcceptEdits: boolean;
  autoRunShell: boolean;
  workspaceRoot: string;
  onChooseWorkspace?: (path: string) => Promise<void>;
  onBack: () => void;
  onThreadUpdate: (thread: Thread) => void;
  onAgentStatus?: (label: string) => void;
  onGitMaybeChanged?: () => void;
  composerSeed?: string | null;
  onComposerSeedConsumed?: () => void;
  planMode?: boolean;
  buildMode?: boolean;
  onTogglePlanMode?: () => void;
  onToggleBuildMode?: () => void;
  onApprovePlan?: () => void;
  /** Persist ClientSettings patches (Completeness toggle syncs with Settings/Jobs). */
  onSettingsChange?: (s: ClientSettings) => void;
  onOpenTab?: (tab: Tab) => void;
}

/** Named hard clamp; effective turns come from settings.maxAgentTurns. */
const MAX_AGENT_TURNS_CLAMP = MAX_AGENT_TURNS_HARD_CAP; // named hard clamp alias
const STATE_THROTTLE_MS = 80;
const SAVE_DEBOUNCE_MS = 150;

type QuickAction = {
  id: string;
  label: string;
  fill?: string;
  send?: string;
};

const QUICK_ACTIONS: QuickAction[] = [
  { id: 'git-status', label: 'git status', send: 'Run git_status and summarize the working tree.' },
  { id: 'search', label: 'search', fill: 'semantic_search ' },
  { id: 'grep', label: 'grep', fill: 'grep for ' },
  { id: 'find', label: 'find files', fill: 'glob **/*.ts' },
  { id: 'read', label: 'read file', fill: 'read_file ' },
  { id: 'commit', label: 'commit', fill: 'git_commit with message: ' },
  {
    id: 'fix-tests',
    label: 'fix failing tests',
    send: 'Find failing tests, read the failures, fix with a minimal ```diff, then verify.',
  },
];

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
  return `Workspace writes are ON. Every code file must land under ${root} via write_file or path-headed fences/diffs. Do not leave source only in chat. Shell still needs Run unless auto-run is on.`;
}

/** Cap tool results in API payloads (full text still kept in UI/storage). */
const MAX_API_TOOL_CHARS = 8_000;

function truncateForApi(content: string): string {
  if (!content || content.length <= MAX_API_TOOL_CHARS) return content;
  return `${content.slice(0, MAX_API_TOOL_CHARS)}\n/* truncated for API (${content.length} chars) */`;
}

const LIVE_WORKSPACE_SUFFIX =
  'Live workspace. Write EVERY code file into the connected working directory with write_file or a path-headed ```diff / // relative/path fence. Chat-only source is a failed build. Call list_dir/glob/read_file/grep — do not fake ls/tree in bash fences. Answers go in content. Reasoning is outline only — never code, diffs, bash, or // path files.';

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
  const pins = extractAtPins(text).filter((p) => isPathInsideRoot(p, root || undefined));
  const notes: string[] = [];
  let budget = 12_000;
  for (const pin of pins.slice(0, 12)) {
    if (budget <= 0) break;
    try {
      const entries = await bridge.listDir(pin).catch(() => null);
      if (entries) {
        const listing = entries
          .slice(0, 80)
          .map((e) => `${e.dir ? 'd' : 'f'} ${e.path}`)
          .join('\n');
        const block = `PINNED DIR @${pin}:\n\`\`\`\n${listing}\n\`\`\``;
        notes.push(block);
        budget -= block.length;
        continue;
      }
    } catch {
      /* try as file */
    }
    try {
      const content = await bridge.readFile(pin);
      const clipped = content.length > Math.min(24_000, budget) ? `${content.slice(0, Math.min(24_000, budget))}\n/* truncated */` : content;
      const block = `PINNED FILE @${pin}:\n\`\`\`\n${clipped}\n\`\`\``;
      notes.push(block);
      budget -= block.length;
    } catch {
      /* missing pins are fine */
    }
  }
  return notes;
}

async function prefetchWorkspaceFiles(text: string, root: string): Promise<string[]> {
  if (!bridge.connected) return [];
  const notes: string[] = [];
  let budget = 12_000;

  const pinned = await prefetchPinnedPaths(text, root);
  for (const n of pinned) {
    notes.push(n);
    budget -= n.length;
  }

  if (looksExploreIntent(text) && budget > 500) {
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
  const pinnedSet = new Set(extractAtPins(text));
  for (const filePath of paths.slice(0, 8)) {
    if (budget <= 0) break;
    if (pinnedSet.has(filePath)) continue;
    try {
      const content = await bridge.readFile(filePath);
      const take = Math.min(24_000, budget);
      const clipped = content.length > take ? `${content.slice(0, take)}\n/* truncated */` : content;
      const block = `WORKSPACE FILE ${filePath}:\n\`\`\`\n${clipped}\n\`\`\``;
      notes.push(block);
      budget -= block.length;
    } catch {
      /* missing files are fine */
    }
  }

  // Smart prefetch: distinctive tokens → semantic_search → top files
  if (budget > 6_000) {
    const tokens = extractSearchTokens(text, 4);
    if (tokens.length) {
      try {
        const hits = await bridge.semanticSearch(tokens.join(' '), { maxSnippets: 12 });
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
            if (files.length >= 4) break;
          }
          for (const filePath of files) {
            if (budget <= 0) break;
            if (!isPathInsideRoot(filePath, root || undefined)) continue;
            try {
              const content = await bridge.readFile(filePath);
              const take = Math.min(16_000, budget);
              const clipped = content.length > take ? `${content.slice(0, take)}\n/* truncated */` : content;
              const block = `RELATED FILE ${filePath}:\n\`\`\`\n${clipped}\n\`\`\``;
              notes.push(block);
              budget -= block.length;
            } catch {
              /* ignore */
            }
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

function QuickChips({
  onFill,
  onSend,
}: {
  onFill: (text: string) => void;
  onSend: (text: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {QUICK_ACTIONS.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => {
            if (a.send) onSend(a.send);
            else if (a.fill) onFill(a.fill);
          }}
          className="chip"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

export const ChatScreen = forwardRef<ChatScreenHandle, Props>(function ChatScreen(
  {
    thread,
    settings,
    autoAcceptEdits,
    autoRunShell,
    workspaceRoot,
    onChooseWorkspace,
    onBack,
    onThreadUpdate,
    onAgentStatus,
    onGitMaybeChanged,
    composerSeed,
    onComposerSeedConsumed,
    planMode = false,
    buildMode = false,
    onTogglePlanMode,
    onApprovePlan,
    onSettingsChange,
    onOpenTab,
  },
  ref,
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [hiddenPrefix, setHiddenPrefix] = useState(0);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loopTurn, setLoopTurn] = useState(0);
  const [lastStopReason, setLastStopReason] = useState<AgentStopReason | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>(bridge.currentStatus);
  const [appRoot, setAppRoot] = useState(bridge.currentAppRoot);
  const [dirConfirmed, setDirConfirmed] = useState(false);
  const [grokById, setGrokById] = useState<Record<string, GrokApplyResult[]>>({});
  const [latestGrok, setLatestGrok] = useState<GrokApplyResult[] | undefined>(undefined);
  const maxTurns = Math.min(MAX_AGENT_TURNS_CLAMP, clampMaxAgentTurns(settings.maxAgentTurns));
  const effectiveTools = useMemo(
    () => (planMode ? filterPlanModeTools(thread.enabledTools) : thread.enabledTools),
    [planMode, thread.enabledTools],
  );
  const agentProfile = useMemo(() => {
    const active = resolveActiveSettings(settings);
    const peek = peekFeatherlessModel(active.defaultModel);
    return buildModelAgentProfile({
      model: active.defaultModel || thread.model,
      provider: active.provider,
      reasoning: settings.reasoning,
      planMode,
      buildMode,
      toolUse: peek?.toolUse,
      contextLength: peek?.contextLength,
      enabledTools: effectiveTools,
    });
  }, [
    settings,
    planMode,
    buildMode,
    thread.model,
    effectiveTools,
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
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const autoAcceptRef = useRef(autoAcceptEdits);
  autoAcceptRef.current = autoAcceptEdits;
  const autoRunRef = useRef(autoRunShell);
  autoRunRef.current = autoRunShell;
  const onAgentStatusRef = useRef(onAgentStatus);
  onAgentStatusRef.current = onAgentStatus;
  const onGitMaybeChangedRef = useRef(onGitMaybeChanged);
  onGitMaybeChangedRef.current = onGitMaybeChanged;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
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
    if (!planMode) setPlanChecklist([]);
  }, [planMode]);

  useEffect(() => {
    if (!planMode || busy) return;
    const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.content.trim());
    if (!last) return;
    const items = parseTodoBullets(last.content);
    if (items.length) setPlanChecklist(items);
  }, [planMode, busy, messages]);

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
        if (!cancelled) setProjectMemoryBlock(formatProjectMemoryPrompt(files));
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
    settings.mempalaceEnabled,
    settings.mempalaceAutoRecall,
    settings.mempalacePalacePath,
    settings.mempalaceWing,
    workspaceRoot,
    bridgeStatus,
  ]);

  const toApiMessages = (list: Message[], extraSystem: string[] = []): ChatOpenAiMessage[] => {
    const out: ChatOpenAiMessage[] = [];
    let sys = thread.systemPrompt || settingsRef.current.systemPrompt || '';
    const lastUser = [...list].reverse().find((m) => m.role === 'user');
    const buildProcess =
      !planMode &&
      lastUser &&
      shouldApplyBuildProcess(lastUser.content, { buildMode: !!buildMode, planMode: !!planMode });
    const largeNudge =
      !buildProcess && !planMode && lastUser && looksLargeJob(lastUser.content)
        ? buildLargeJobNudge()
        : '';
    const thoughtOn = agentProfile.useThoughtLock;
    const thoughtNudge = thoughtOn ? buildThoughtModeNudge() : '';
    const buildNudge = planMode
      ? ''
      : buildProcess
        ? buildReasoningThenBuildNudge()
        : buildMode
          ? buildBuildModeAlwaysNudge()
          : '';
    const planNudge = planMode ? buildPlanModeNudge() : '';
    const planBuildNudge =
      planMode && lastUser && /\b(build|implement|apply|write|code)\b/i.test(lastUser.content)
        ? 'Plan mode is still on; only checklist allowed — operator must Approve to write. Do not emit diffs.'
        : '';
    const injectGraph = shouldUseTaskGraph({
      largeJob: !!(lastUser && looksLargeJob(lastUser.content)),
      buildProcess: !!buildProcess,
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
    sys = [
      sys,
      LIVE_WORKSPACE_SUFFIX,
      projectMemoryBlock,
      mempalaceBlock,
      injectGraph ? taskGraphBlock : '',
      !agentProfile.compactPrompt && settings.skillsEnabled !== false
        ? formatSkillsCatalogPrompt(skillsCatalog)
        : '',
      !agentProfile.compactPrompt && settings.skillsEnabled !== false ? workspaceSkillsBlock : '',
      verifyStrictBlock,

      shouldWriteWorkspaceFiles({
        planMode,
        workspaceRoot,
        appRoot,
        connected: bridgeStatus === 'connected',
      })
        ? grokAutoAcceptSuffix(workspaceRoot)
        : '',
      agentProfile.systemAddendum,
      thoughtNudge,
      planNudge,
      planBuildNudge,
      buildNudge,
      largeNudge,
      ...extraSystem,
    ]
      .filter(Boolean)
      .join('\n\n');
    if (sys) out.push({ role: 'system', content: sys });
    for (const m of list) {
      if (m.role === 'system') continue;
      if (m.role === 'tool') {
        out.push({
          role: 'tool',
          content: truncateForApi(m.content),
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
    const source = grokSource(msg.content, msg.reasoning, workspaceRoot);
    if (planMode) {
      setLatestGrok([]);
      return;
    }
    const edits = parseGrokEdits(source, workspaceRoot);
    const writeToWorkspace = shouldWriteWorkspaceFiles({
      planMode: false,
      workspaceRoot,
      appRoot,
      connected: bridge.connected,
    });
    const results = await applyGrokEdits(edits, {
      autoAccept: autoAcceptRef.current,
      writeToWorkspace,
      root: workspaceRoot,
    });
    setGrokById((prev) => ({ ...prev, [msg.id]: results }));
    setLatestGrok(results);
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
    if (planMode && isMcpToolName(tool.name)) {
      const denied = {
        ...tool,
        status: 'denied' as const,
        result: 'Plan mode: MCP tools locked until you approve the plan.',
      };
      return {
        msg: makeToolMessage(denied, denied.result || ''),
        executed: false,
      };
    }
    const tools = planMode ? effectiveTools : thread.enabledTools;
    const result = await executeAgentTool(tool, {
      enabledTools: tools,
      autoAcceptEdits: planMode ? false : autoAcceptRef.current,
      autoRunShell: planMode ? false : autoRunRef.current,
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

  const finishRun = (
    stopReason: AgentStopReason,
    meta: { startedAt: number; turns: number; tools: string[] },
  ) => {
    const endedAt = Date.now();
    setLastStopReason(stopReason);
    recordAgentRun({
      threadId: thread.id,
      startedAt: meta.startedAt,
      endedAt,
      turns: meta.turns,
      stopReason,
      tools: meta.tools,
      ms: endedAt - meta.startedAt,
    });
    const s = settingsRef.current;
    if (s.mempalaceEnabled === false || s.mempalaceAutoSave === false) return;
    if (!bridge.connected) return;
    const rows = getMessages(thread.id);
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
    pendingMidRunRef.current = [];
    setQueuedMidRun(0);
    queuedMidRunRef.current = 0;
    setShowIdleMonitor(false);
    let current = history;
    const startedAt = Date.now();
    runStartedAtRef.current = startedAt;
    phaseMetaRef.current = { runStartedAt: startedAt };
    setPhase('starting', { runStartedAt: startedAt }, 1);
    const toolsUsed: string[] = [];
    let turnsDone = 0;
    let deepensUsed = 0;
    let fakeToolRetryUsed = false;
    let buildTodoNudgeUsed = false;
    let buildImplementNudgeUsed = false;
    let proveImproveNudgeUsed = false;
    let buildVerifyNudgeUsed = false;
    let stopReason: AgentStopReason = 'no_tools';
    let turnCap = clampMaxAgentTurns(settingsRef.current.maxAgentTurns);
    const deepenCap = clampSelfDeepenPasses(settingsRef.current.selfDeepenPasses);

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
      current = getMessages(thread.id);
      return true;
    };

    try {
      const lastUser = [...history].reverse().find((m) => m.role === 'user');
      const grokBuildProcess =
        !planMode &&
        !!(
          lastUser &&
          shouldApplyBuildProcess(lastUser.content, { buildMode: !!buildMode, planMode: !!planMode })
        );
      const exploreIntent = !!(lastUser && looksExploreIntent(lastUser.content));
      const prefetched =
        lastUser && bridge.connected ? await prefetchWorkspaceFiles(lastUser.content, workspaceRoot) : [];
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
        };
        persist(assistant);
        try {
          const live = settingsRef.current;
          const active = resolveActiveSettings(live);
          const result = await streamChatCompletion({
            settings: live,
            model: active.defaultModel || thread.model,
            messages: toApiMessages(current, turn === 1 ? prefetched : []),
            abortSignal: ac.signal,
            enabledTools: planMode ? effectiveTools : thread.enabledTools,
            extraTools: agentProfile.allowMcp
              ? (mcpToolsToOpenAi(listConnectedMcpTools()) as Parameters<
                  typeof streamChatCompletion
                >[0]['extraTools'])
              : undefined,
            toolChoice: turn === 1 && exploreIntent ? 'required' : 'auto',
            flightKey: `chat:${thread.id}`,
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
          assistant.status = 'complete';
          // Thought never keeps code — lift fences/diffs into content (files), then Plan strips writes.
          enforceThoughtNoCode(assistant, { liftToContent: !planMode });
          const coalesceOn = settingsRef.current.coalesceReasoningToContent !== false;
          if (planMode) applyPlanReasoningGuard(assistant);
          finalizeReasoningChannel(assistant, coalesceOn && !planMode);
          assistant.content = liftTodoListToContent(assistant.content || '', assistant.reasoning || '');
          if (planMode) applyPlanReasoningGuard(assistant);
          else enforceThoughtNoCode(assistant, { liftToContent: true });
          flushStreamPersist({ ...assistant });
          await runGrokLayer(assistant);

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
            const content = assistant.content || '';
            const detectContent = stripThinkForDetect(content);
            const fakeParsed = parseFakeToolCalls(detectContent);
            if (fakeParsed.length) {
              toolCalls = fakeParsed.map((f) => ({
                id: uid('tool'),
                name: f.name as ToolCallPayload['name'],
                arguments: f.arguments,
                status: 'pending' as const,
              }));
              assistant.toolCalls = toolCalls;
              flushStreamPersist({ ...assistant });
              // Fall through into existing tool execution path.
            } else if (looksLikeFakeToolTheater(detectContent) && !fakeToolRetryUsed) {
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
            } else if (looksLikeFakeToolTheater(detectContent) && fakeToolRetryUsed) {
              // Already nudged once; stop rather than deepen into another theater loop.
              setPhase('finishing', {}, turn);
              stopReason = deepensUsed > 0 ? 'deepened' : 'no_tools';
              break;
            } else {
              // Empty content after coalesce: no API recovery. Setting off → reasoning panel only.
              if (isMissingContentAnswer(assistant.content)) {
                const hasReasoning = !!(assistant.reasoning || '').trim();
                if (hasReasoning && !coalesceOn) {
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

              if (isAnswerCompleteMarker(content)) {
                assistant.content = stripAnswerCompleteMarker(content);
                flushStreamPersist({ ...assistant });
                // Operator mid-run overrides ANSWER_COMPLETE — integrate and continue.
                if (drainMidRunMessages()) {
                  continue;
                }
                // After strip: empty content → coalesce again (zero-cost), never API retry.
                if (isMissingContentAnswer(assistant.content)) {
                  enforceThoughtNoCode(assistant, { liftToContent: !planMode });
                  if (planMode) applyPlanReasoningGuard(assistant);
                  if (finalizeReasoningChannel(assistant, coalesceOn && !planMode)) {
                    if (planMode) applyPlanReasoningGuard(assistant);
                    else enforceThoughtNoCode(assistant, { liftToContent: true });
                    flushStreamPersist({ ...assistant });
                    await runGrokLayer(assistant);
                  }
                  if (isMissingContentAnswer(assistant.content)) {
                    const hasReasoning = !!(assistant.reasoning || '').trim();
                    if (hasReasoning && !coalesceOn) {
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
                !shouldSkipSelfDeepen(detectContent, { status: assistant.status }) &&
                !looksLikeBuildOutput(detectContent, toolsUsed) &&
                !isAnswerCompleteMarker(content)
              ) {
                const todos = parseTodoItems(detectContent);
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
                    content: buildBuildModeImplementNudge(),
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
                    content: buildBuildModeTodoNudge(),
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
                !shouldSkipSelfDeepen(detectContent, { status: assistant.status }) &&
                looksLikeBuildOutput(detectContent, toolsUsed) &&
                !looksLikeVerifyEvidence(detectContent, toolsUsed) &&
                !isAnswerCompleteMarker(content)
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

              const liveDeepen = settingsRef.current;
              const deepenPasses = clampSelfDeepenPasses(liveDeepen.selfDeepenPasses);
              const deepenOn =
                liveDeepen.selfDeepenEnabled !== false && deepenPasses > 0 && deepensUsed < deepenPasses;
              // Already shipped a valid Done/Continue footer — treat as complete; skip an extra deepen turn.
              const footerDone =
                liveDeepen.completionFooterEnabled !== false && hasValidCompletionFooter(content);
              // Junk / error / truncated / network-error turns never deepen.
              const junkTurn = shouldSkipSelfDeepen(detectContent, { status: assistant.status });
              if (deepenOn && content.trim() && !footerDone && !junkTurn && !isAnswerCompleteMarker(content)) {
                deepensUsed += 1;
                setPhase(
                  'self_deepen',
                  { deepenPass: deepensUsed, deepenMax: deepenPasses || deepenCap },
                  turn,
                );
                const nudge: Message = {
                  id: uid('msg'),
                  threadId: thread.id,
                  role: 'user',
                  content: buildSelfDeepenNudge({
                    completeness: liveDeepen.deepenCompleteness !== false,
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
                lastUser?.content &&
                !looksReadOnlyOrControlPrompt(lastUser.content) &&
                !looksLikeProvenImprovement(content, toolsUsed) &&
                !isAnswerCompleteMarker(content)
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
              // Content is non-empty here (coalesce / empty handling above).
              setPhase('finishing', {}, turn);
              stopReason = deepensUsed > 0 ? 'deepened' : 'no_tools';
              break;
            }
          }

          setPhase('tool_plan', { toolName: undefined }, turn);
          let executedAny = false;
          let latest = getMessages(thread.id);
          for (const tool of toolCalls) {
            toolsUsed.push(tool.name);
            setPhase('tool_exec', { toolName: tool.name }, turn);
            if (ac.signal.aborted) {
              latest = persist(makeToolMessage({ ...tool, status: 'error', result: 'aborted' }, 'aborted'));
              continue;
            }
            const { msg, executed } = await executeTool(tool);
            if (executed) executedAny = true;
            latest = persist(msg);
          }
          current = latest;
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
            enforceThoughtNoCode(assistant, { liftToContent: !planMode });
            if (planMode) applyPlanReasoningGuard(assistant);
            finalizeReasoningChannel(assistant, coalesceOnAbort && !planMode);
            if (planMode) applyPlanReasoningGuard(assistant);
            else enforceThoughtNoCode(assistant, { liftToContent: true });
            if (!assistant.content.trim() && !assistant.reasoning?.trim()) assistant.content = '(stopped)';
            // Apply diffs from coalesced reasoning even on abort (no-op if planMode).
            await runGrokLayer(assistant);
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
      finishRun(stopReason, { startedAt, turns: turnsDone, tools: [...new Set(toolsUsed)] });
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

  useImperativeHandle(
    ref,
    () => ({
      stop,
      retry,
      continueAfterTool,
      fillInput,
    }),
    [stop, retry, continueAfterTool, fillInput],
  );

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

  const grokHeader = formatGrokStatus(latestGrok, autoAcceptEdits, bridgeStatus === 'connected');
  const workspaceOk = workspaceGate(workspaceRoot, appRoot);
  const needsWorkingDir = !workspaceOk.ok || (messages.length === 0 && !dirConfirmed);
  const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K';
  const midRunOn = settings.midRunInjectEnabled !== false;
  const completenessOn = settings.deepenCompleteness !== false;
  const thoughtOn = settings.reasoning !== 'off';
  const placeholder = needsWorkingDir
    ? 'Choose a working directory first'
    : busy
    ? midRunOn
      ? 'Send to adjust mid-run…'
      : 'Agent busy — Stop to cancel'
    : planMode
      ? 'Plan mode — checklist only (no diffs) · Enter send'
      : buildMode
        ? 'Build mode — ToDo then diffs in content · Enter send'
        : thoughtOn
          ? 'Thought on — Goal/Inspect/Steps in reasoning · Enter send'
          : `Message · @src/foo.ts pin · ${modKey} commands · Enter send`;

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

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <button type="button" onClick={onBack} className="rounded p-1 text-muted transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500">
          <ArrowLeft size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-xs text-zinc-100">{thread.title}</div>
          <div className="font-mono text-[10px] text-muted">
            {resolveActiveSettings(settings).label} · {agentProfile.label} · {planMode ? 'PLAN · ' : buildMode ? 'BUILD · ' : ''}
            {agentProfile.useThoughtLock ? 'THOUGHT · ' : ''}
            {completenessOn ? 'COMPLETE · ' : ''}tools {agentProfile.sendTools ? agentProfile.toolNames.join(', ') : 'none'} · {statusLabel}
          </div>
          <div className="truncate font-mono text-[10px] text-zinc-500">
            {grokHeader}
            {workspaceRoot ? ` · ${workspaceRoot}` : ''}
          </div>
        </div>
        <label
          className={
            'flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] ' +
            (completenessOn
              ? 'border-emerald-600/70 bg-emerald-950/40 text-emerald-300'
              : 'border-border bg-background text-muted')
          }
          title={DEEPEN_COMPLETENESS_TOOLTIP}
        >
          <input
            type="checkbox"
            role="switch"
            aria-checked={completenessOn}
            aria-label={DEEPEN_COMPLETENESS_CHAT_LABEL}
            checked={completenessOn}
            onChange={() => patchDeepenCompleteness(!completenessOn)}
            className="h-3 w-3 accent-emerald-400"
          />
          {DEEPEN_COMPLETENESS_CHAT_LABEL}
        </label>
        <button
          type="button"
          onClick={deepenThisAnswerNow}
          disabled={needsWorkingDir || (busy && !midRunOn) || messages.length === 0}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-background px-2 py-1 font-mono text-[10px] text-zinc-300 transition-colors hover:border-emerald-600/50 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 disabled:opacity-40"
          title={`${DEEPEN_COMPLETENESS_TOOLTIP}. Queues mid-run inject when busy, otherwise sends a follow-up.`}
        >
          <ListChecks size={11} /> Deepen now
        </button>
        <button type="button" onClick={() => void retry()} disabled={busy} className="rounded p-1 text-muted transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 disabled:opacity-40">
          <RotateCcw size={14} />
        </button>
      </header>
      {onSettingsChange ? (
        <ModelSettingsGuidePanel
          compact
          model={resolveActiveSettings(settings).defaultModel}
          settings={settings}
          onSettingsChange={onSettingsChange}
          onOpenTab={onOpenTab}
        />
      ) : null}

      <div
        className={cn(
          'relative min-h-0 flex-1 chat-terminal',
          planMode ? 'chat-terminal--plan' : buildMode ? 'chat-terminal--build' : 'chat-terminal--discuss',
        )}
      >
        <div className="chat-terminal-bg" aria-hidden="true" />
        <div ref={scrollerRef} className="relative z-[1] h-full overflow-auto px-4 py-3">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-md space-y-4 py-8">
              {needsWorkingDir && onChooseWorkspace ? (
                <WorkingDirPrompt
                  appRoot={appRoot}
                  currentRoot={workspaceRoot}
                  onChoose={async (path) => {
                    await onChooseWorkspace(path);
                    setDirConfirmed(true);
                  }}
                />
              ) : (
                <>
                  <div className="text-center font-mono text-xs text-zinc-300">Ready when you are</div>
                  <ul className="space-y-1.5 font-mono text-[11px] leading-5 text-muted">
                    <li>
                      · Pin context with <span className="text-zinc-300">@src/path.ts</span>
                    </li>
                    <li>· Send mid-run to steer the agent (when enabled in Settings)</li>
                    <li>· Tap Continue chips after a Done footer</li>
                    <li>· Quick chips fill or send common tool prompts</li>
                  </ul>
                  {!busy ? <QuickChips onFill={fillInput} onSend={(t) => void sendText(t)} /> : null}
                </>
              )}
            </div>
          ) : (
            <>
              {hiddenPrefix > 0 ? (
                <div className="mb-3 flex justify-center">
                  <button
                    type="button"
                    className="rounded border border-border bg-surface px-3 py-1 font-mono text-[10px] text-zinc-300 hover:border-zinc-500"
                    onClick={() => setHiddenPrefix((n) => Math.max(0, n - MESSAGE_WINDOW))}
                  >
                    Load earlier messages ({hiddenPrefix} hidden)
                  </button>
                </div>
              ) : null}
              {messages.slice(hiddenPrefix).map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  autoAcceptEdits={autoAcceptEdits}
                  writesLocked={planMode}
                  terminalTone={planMode ? 'plan' : buildMode ? 'build' : 'discuss'}
                  grokResults={grokById[m.id]}
                  bridgeConnected={bridgeStatus === 'connected'}
                  onGitCommit={handleGitCommit}
                  onCreatePr={handleCreatePr}
                  onCheckpointRestore={handleCheckpointRestore}
                  onShellExecuted={handleShellExecuted}
                  completionFooterEnabled={settings.completionFooterEnabled !== false}
                  onContinuePrompt={handleContinuePrompt}
                  skipHighlight={m.status === 'streaming'}
                />
              ))}
            </>
          )}
        </div>
        {showJump ? (
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className="absolute bottom-3 left-1/2 z-[1] inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface/95 px-3 py-1 font-mono text-[10px] text-zinc-200 shadow-lg backdrop-blur hover:border-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500"
          >
            <ArrowDown size={11} /> Jump to latest
          </button>
        ) : null}
      </div>

      {!planMode && planChecklist.length ? (
        <div className="border-t border-zinc-800 bg-zinc-950/60 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wide text-zinc-400">ToDo</div>
          <ul className="mt-1 max-h-28 space-y-0.5 overflow-auto font-mono text-[11px] text-zinc-300">
            {planChecklist.map((item, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="shrink-0 text-muted">{i + 1}.</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!planMode && buildMode ? (
        <div className="border-t border-amber-800/50 bg-amber-950/20 px-3 py-1.5 font-mono text-[10px] text-amber-200/90">
          Build mode locked — todo → explore tools → real diffs in content this turn
          {thoughtOn ? ' · Thought: Goal / Inspect / steps in reasoning first' : ''}.
        </div>
      ) : null}
      {planMode ? (
        <div className="border-t border-sky-800/60 bg-sky-950/30 px-3 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wide text-sky-300">
            Plan mode · tools {effectiveTools.join(', ') || PLAN_MODE_TOOLS.join(', ')}
          </div>
          <div className="mt-1 font-mono text-[10px] text-amber-300/90">
            Writes locked — turn off Plan / Approve plan to apply diffs and write tools.
          </div>
          {planChecklist.length ? (
            <ul className="mt-1 max-h-28 space-y-0.5 overflow-auto font-mono text-[11px] text-zinc-300">
              {planChecklist.map((item, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="shrink-0 text-muted">{i + 1}.</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-1 font-mono text-[10px] text-muted">
              Waiting for a checklist (bullets / numbered steps)…
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!planChecklist.length || busy}
              className="btn-primary font-mono text-[10px] disabled:opacity-40"
              title="Approve plan and unlock write tools"
              onClick={() => {
                onApprovePlan?.();
                if (!onApprovePlan) onTogglePlanMode?.();
              }}
            >
              Approve plan
            </button>
            <button
              type="button"
              className="btn-ghost font-mono text-[10px]"
              onClick={() => onTogglePlanMode?.()}
            >
              Cancel plan
            </button>
          </div>
        </div>
      ) : null}
      {needsWorkingDir && messages.length > 0 && onChooseWorkspace ? (
        <div className="border-t border-border bg-surface px-3 py-3">
          <WorkingDirPrompt
            appRoot={appRoot}
            currentRoot={workspaceRoot}
            onChoose={async (path) => {
              await onChooseWorkspace(path);
              setDirConfirmed(true);
            }}
          />
        </div>
      ) : null}
      <form
        className="border-t border-border bg-surface p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {busy || showIdleMonitor ? (
          <AgentStatusMonitor
            phase={busy ? agentPhase : agentPhase === 'idle' ? 'stopped' : agentPhase}
            meta={phaseMeta}
            turn={busy ? loopTurn : 0}
            maxTurns={maxTurns}
            queuedMidRun={queuedMidRun}
            runStartedAt={busy ? (runStartedAtRef.current || phaseMeta.runStartedAt) : phaseMeta.runStartedAt}
            ticking={busy}
            compact={!busy && showIdleMonitor}
          />
        ) : null}
        {!busy && !needsWorkingDir ? (
          <div className="mb-1.5">
            <QuickChips onFill={fillInput} onSend={(t) => void sendText(t)} />
          </div>
        ) : busy ? (
          <div className="mb-1 font-mono text-[10px] text-zinc-600">Esc stops</div>
        ) : null}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={placeholder}
            disabled={needsWorkingDir}
            className="field max-h-32 flex-1 resize-none"
          />
          <label
            className={
              'flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] ' +
              (completenessOn
                ? 'border-emerald-600/70 bg-emerald-950/40 text-emerald-300'
                : 'border-border bg-background text-muted')
            }
            title={DEEPEN_COMPLETENESS_TOOLTIP}
          >
            <input
              type="checkbox"
              role="switch"
              aria-checked={completenessOn}
              aria-label={DEEPEN_COMPLETENESS_CHAT_LABEL}
              checked={completenessOn}
              onChange={() => patchDeepenCompleteness(!completenessOn)}
              className="h-3 w-3 accent-emerald-400"
            />
            {DEEPEN_COMPLETENESS_CHAT_LABEL}
          </label>
          {onTogglePlanMode ? (
            <label
              className={
                'flex shrink-0 cursor-pointer select-none items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] ' +
                (planMode
                  ? 'border-sky-600/70 bg-sky-950/50 text-sky-300'
                  : 'border-border bg-background text-muted')
              }
              title="Plan mode: read-only explore → checklist until Approve. Write/shell/MCP stay locked."
            >
              <input
                type="checkbox"
                role="switch"
                aria-checked={planMode}
                checked={planMode}
                onChange={() => onTogglePlanMode()}
                className="h-3 w-3 accent-sky-400"
              />
              {planMode ? 'Plan active' : 'Plan mode'}
            </label>
          ) : null}
          {busy ? (
            <>
              <button type="button" onClick={stop} className="btn-danger shrink-0" title="Stop agent (Esc)">
                <Square size={11} /> Stop
              </button>
              {midRunOn ? (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="btn-primary shrink-0"
                  title="Queue mid-run note"
                >
                  <Send size={11} /> Send
                </button>
              ) : null}
            </>
          ) : (
            <button type="submit" disabled={needsWorkingDir || !input.trim()} className="btn-primary shrink-0">
              <Send size={11} /> Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
});
