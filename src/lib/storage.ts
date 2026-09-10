import type {
  ClientSettings,
  Job,
  Message,
  Thread,
  ToolType,
  WorkspaceContext,
} from '../types';
import {
  ALL_TOOL_TYPES,
  OLD_DEFAULT_TOOLS,
  PREV_DEFAULT_TOOLS,
  PREV2_DEFAULT_TOOLS,
  PREV3_DEFAULT_TOOLS,
  PREV4_DEFAULT_TOOLS,
  PREV5_DEFAULT_TOOLS,
  PREV6_DEFAULT_TOOLS,
  PREV7_DEFAULT_TOOLS,
} from '../types';
import {
  AGENT_RUNS_KEEP,
  DEFAULT_MAX_AGENT_TURNS,
  DEFAULT_MAX_CONCURRENT_JOBS,
  DEFAULT_SELF_DEEPEN_PASSES,
  appendAgentRun,
  clampMaxAgentTurns,
  clampMaxConcurrentJobs,
  clampSelfDeepenPasses,
  type AgentRunRecord,
} from './agentHelpers';
import { getLicenseState } from './license';
import { durableSet, isBulkyStorageKey, wipeDurableStore } from './durableStore';
import { LEGACY_PROMPTS, SYSTEM_PROMPT } from './systemPrompt';
import { DEFAULT_FEATHERLESS_MODEL, migrateFeatherlessModel } from './featherlessQwen.js';
import { isTemporaryPath } from './workspaceGuard';

export const KEYS = {
  settings: 'ablit_settings',
  threads: 'ablit_threads',
  messages: 'ablit_messages',
  jobs: 'ablit_jobs',
  workspace: 'ablit_workspace',
  agentRuns: 'ablit_agent_runs',
} as const;

function randomPairingCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function generatePairingCode(): string {
  return randomPairingCode();
}

export const DEFAULT_SETTINGS: ClientSettings = {
  // Shared Abliteration/Custom slot: ship empty so Custom is not prefilled with cloud samples.
  // Abliteration requests fall back via resolveActiveSettings (cloud URL/model).
  // Never default-in VITE_ABLITERATED_TOKEN (would bake secrets into the SPA).
  baseUrl: '',
  token: '',
  defaultModel: '',
  reasoning: 'off',
  systemPrompt: SYSTEM_PROMPT,
  remoteHostEnabled: true,
  pairingCode: randomPairingCode(),
  autoAcceptEdits: false,
  autoRunShell: false,
  maxAgentTurns: DEFAULT_MAX_AGENT_TURNS,
  selfDeepenEnabled: true,
  selfDeepenPasses: DEFAULT_SELF_DEEPEN_PASSES,
  deepenCompleteness: true,
  midRunInjectEnabled: true,
  completionFooterEnabled: true,
  coalesceReasoningToContent: true,
  planModeEnabled: false,
  buildModeEnabled: true,
  fastModel: '',
  maxConcurrentJobs: 1,
  inferenceProvider: 'abliteration',
  sparkEnabled: false,
  sparkBaseUrl: 'http://127.0.0.1:8000/v1',
  sparkToken: '',
  sparkModel: 'qwen-abliterated',
  sparkViaProxy: true,
  sparkLanHost: '',
  sparkSshAlias: '',
  featherlessEnabled: true,
  featherlessBaseUrl: 'https://api.featherless.ai/v1',
  featherlessToken: '',
  featherlessModel: DEFAULT_FEATHERLESS_MODEL,
  featherlessViaProxy: false,
  imageGenEnabled: false,
  imageBackend: 'spark',
  imageBaseUrl: 'http://127.0.0.1:7860/v1',
  imageToken: '',
  imageModel: 'krea2-raw-fp8',
  // Prefer off: Vite DEV browser still enables via getSettings when unset; Electron stays off.
  imageViaProxy: false,
  xaiImageBaseUrl: 'https://api.x.ai/v1',
  xaiImageToken: '',
  xaiImageModel: 'grok-imagine-image-2.0',
  xaiImageResolution: '2k',
  xaiImageQuality: 'auto',
  mcpServers: [],
  skillsEnabled: true,
  licenseKey: import.meta.env.DEV ? 'ABLIT-ADMIN' : '',
  billingSiteUrl: 'https://abliterated.app',
  billingEmail: '',
  accountEmail: '',
  loginId: '',
  deviceId: '',
  accountLoggedIn: false,
  setupComplete: false,
  projectRulesPinned: true,
  webSearchBraveKey: '',
  webSearchSearxUrl: '',
  jobWorktreesEnabled: false,
  multiAgentEnabled: false,
  mempalaceEnabled: true,
  mempalacePalacePath: '',
  mempalaceWing: '',
  mempalaceAutoRecall: true,
  mempalaceAutoSave: true,
  verifyStrictProfile: true,
  agentMode: 'agent',
  postEditDiagnostics: false,
};

export function isPlaceholderRoot(path: string): boolean {
  const s = path.trim();
  return s === '' || s === '/workspace' || s === '.';
}

export const DEFAULT_WORKSPACE: WorkspaceContext = {
  rootPath: '',
  currentBranch: 'main',
  isDirty: false,
  selectedFiles: [],
  scratchpadContent: '// Temporary scratchpad buffer\n',
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt payload — drop it so later writes can recover cleanly.
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore quota / private-mode */
    }
    return fallback;
  }
}

/** Soft cap on persisted chat rows (all threads). Oldest dropped first on write/quota. */
const MESSAGES_SOFT_CAP = 800;
/** Per-thread window kept when pruning under quota pressure. */
const MESSAGES_PER_THREAD_CAP = 200;

function isQuotaError(err: unknown): boolean {
  const name = err instanceof DOMException ? err.name : '';
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    (typeof err === 'object' &&
      err != null &&
      'code' in err &&
      (err as { code?: number }).code === 22) ||
    (err instanceof Error && /quota/i.test(err.message))
  );
}

function windowMessages(messages: Message[]): Message[] {
  if (messages.length <= MESSAGES_SOFT_CAP) return messages;
  // Keep newest globally, but never strand a thread with zero rows if possible.
  const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  return sorted.slice(-MESSAGES_SOFT_CAP);
}

function pruneMessagesForQuota(messages: Message[]): Message[] {
  const byThread = new Map<string, Message[]>();
  for (const m of messages) {
    const list = byThread.get(m.threadId) || [];
    list.push(m);
    byThread.set(m.threadId, list);
  }
  const kept: Message[] = [];
  for (const list of byThread.values()) {
    const ordered = [...list].sort((a, b) => a.createdAt - b.createdAt);
    kept.push(...ordered.slice(-MESSAGES_PER_THREAD_CAP));
  }
  return windowMessages(kept);
}

function persistDurable(key: string, value: unknown): void {
  if (isBulkyStorageKey(key)) void durableSet(key, value);
}

function writeJson(key: string, value: unknown): void {
  const payload = () => JSON.stringify(value);
  try {
    localStorage.setItem(key, payload());
    persistDurable(key, value);
    return;
  } catch (err) {
    if (!isQuotaError(err)) {
      console.warn(`[ablit] localStorage write failed for ${key}`, err);
      return;
    }
    console.warn(`[ablit] localStorage quota exceeded writing ${key}; pruning`);
  }
  // Quota path: drop oldest jobs, then shrink messages, then retry.
  try {
    if (key !== KEYS.settings && key !== KEYS.threads) {
      const jobs = readJson<Job[]>(KEYS.jobs, []);
      if (jobs.length > 20) {
        const trimmed = jobs
          .filter((j) => j.status === 'queued' || j.status === 'running')
          .concat(
            jobs
              .filter((j) => j.status !== 'queued' && j.status !== 'running')
              .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
              .slice(0, 20),
          );
        localStorage.setItem(KEYS.jobs, JSON.stringify(trimmed));
      }
    }
  } catch {
    /* ignore */
  }
  try {
    if (key === KEYS.messages && Array.isArray(value)) {
      value = pruneMessagesForQuota(value as Message[]);
    } else {
      const msgs = pruneMessagesForQuota(readJson<Message[]>(KEYS.messages, []));
      localStorage.setItem(KEYS.messages, JSON.stringify(msgs));
    }
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
    persistDurable(key, value);
  } catch (err) {
    console.warn(`[ablit] localStorage write still failing for ${key}`, err);
    persistDurable(key, value);
  }
}

/**
 * Hard invariant sanitizer: guarantees that it is impossible for settings
 * to exist in a state that bricks or disables the AI agent.
 */
export function sanitizeSettings(stored?: Partial<ClientSettings>): ClientSettings {
  const s = stored || {};
  const storedPrompt = (s.systemPrompt || '').trim();
  const systemPrompt =
    !storedPrompt || storedPrompt.length < 20 || (LEGACY_PROMPTS as readonly string[]).includes(storedPrompt)
      ? SYSTEM_PROMPT
      : storedPrompt;

  const validProviders = ['abliteration', 'platform', 'dgx-spark', 'featherless', 'custom'] as const;
  const provider = s.inferenceProvider && validProviders.includes(s.inferenceProvider)
    ? s.inferenceProvider
    : 'abliteration';

  const maxAgentTurns = clampMaxAgentTurns(
    s.maxAgentTurns != null ? s.maxAgentTurns : DEFAULT_MAX_AGENT_TURNS,
  );
  const maxConcurrentJobs = clampMaxConcurrentJobs(
    s.maxConcurrentJobs != null ? s.maxConcurrentJobs : DEFAULT_MAX_CONCURRENT_JOBS,
  );

  let selfDeepenPasses = clampSelfDeepenPasses(
    s.selfDeepenPasses != null ? s.selfDeepenPasses : DEFAULT_SELF_DEEPEN_PASSES,
  );
  const license = getLicenseState({
    licenseKey: typeof s.licenseKey === 'string' ? s.licenseKey.trim() : DEFAULT_SETTINGS.licenseKey,
  });
  if (license.isFree) {
    selfDeepenPasses = Math.min(selfDeepenPasses, license.features.maxSelfDeepenPasses);
  }

  const defaultModel = (s.defaultModel || '').trim() || DEFAULT_SETTINGS.defaultModel || 'abliterated-model';
  const sparkModel = (s.sparkModel || '').trim() || DEFAULT_SETTINGS.sparkModel || 'qwen-abliterated';
  const rawFeatherlessModel = (s.featherlessModel || '').trim() || DEFAULT_SETTINGS.featherlessModel;
  const flMig = migrateFeatherlessModel(rawFeatherlessModel);

  const sparkBaseUrl = (s.sparkBaseUrl || '').trim() || DEFAULT_SETTINGS.sparkBaseUrl;
  let featherlessBaseUrl = (s.featherlessBaseUrl || '').trim();
  if (!featherlessBaseUrl || featherlessBaseUrl === 'http://127.0.0.1:3000/v1' || featherlessBaseUrl === 'http://localhost:3000/v1') {
    featherlessBaseUrl = DEFAULT_SETTINGS.featherlessBaseUrl;
  }
  const baseUrl = (s.baseUrl || '').trim() || DEFAULT_SETTINGS.baseUrl;

  // Remote host & bridge is required for AI agent tools to operate on local machine
  const remoteHostEnabled = s.remoteHostEnabled !== false;

  // Auto-enable companion flags so the active provider is marked operational
  const sparkEnabled = provider === 'dgx-spark' ? true : s.sparkEnabled === true;
  const featherlessEnabled = provider === 'featherless' ? true : s.featherlessEnabled !== false;

  const result: ClientSettings = {
    ...DEFAULT_SETTINGS,
    ...s,
    baseUrl,
    token: typeof s.token === 'string' ? s.token.trim() : DEFAULT_SETTINGS.token,
    defaultModel,
    pairingCode: s.pairingCode || randomPairingCode(),
    autoAcceptEdits: s.autoAcceptEdits === true,
    autoRunShell: s.autoRunShell === true,
    maxAgentTurns,
    maxConcurrentJobs,
    selfDeepenEnabled: s.selfDeepenEnabled !== false,
    selfDeepenPasses,
    deepenCompleteness: typeof s.deepenCompleteness === 'boolean' ? s.deepenCompleteness : s.selfDeepenEnabled !== false,
    midRunInjectEnabled: s.midRunInjectEnabled !== false,
    completionFooterEnabled: s.completionFooterEnabled !== false,
    coalesceReasoningToContent: s.coalesceReasoningToContent !== false,
    jobWorktreesEnabled: s.jobWorktreesEnabled === true,
    multiAgentEnabled: s.multiAgentEnabled === true,
    mempalaceEnabled: s.mempalaceEnabled !== false,
    mempalacePalacePath: typeof s.mempalacePalacePath === 'string' ? s.mempalacePalacePath.trim() : '',
    mempalaceWing: typeof s.mempalaceWing === 'string' ? s.mempalaceWing.trim() : '',
    mempalaceAutoRecall: s.mempalaceAutoRecall !== false,
    mempalaceAutoSave: s.mempalaceAutoSave !== false,
    verifyStrictProfile: s.verifyStrictProfile !== false,
    planModeEnabled: s.planModeEnabled === true,
    buildModeEnabled: s.buildModeEnabled !== false,
    agentMode: (s.agentMode === 'ask' || s.agentMode === 'plan' || s.agentMode === 'debug' || s.agentMode === 'agent')
      ? s.agentMode
      : s.planModeEnabled === true ? 'plan' : 'agent',
    postEditDiagnostics: s.postEditDiagnostics === true,
    fastModel: (s.fastModel || '').trim(),
    inferenceProvider: provider,
    sparkEnabled,
    sparkBaseUrl,
    sparkToken: s.sparkToken ?? DEFAULT_SETTINGS.sparkToken,
    sparkModel,
    sparkViaProxy: s.sparkViaProxy !== false,
    sparkLanHost: (s.sparkLanHost || '').trim() || DEFAULT_SETTINGS.sparkLanHost,
    sparkSshAlias: (s.sparkSshAlias || '').trim() || DEFAULT_SETTINGS.sparkSshAlias,
    featherlessEnabled,
    featherlessBaseUrl,
    featherlessToken: s.featherlessToken ?? DEFAULT_SETTINGS.featherlessToken,
    featherlessModel: flMig.model,
    featherlessViaProxy: s.featherlessViaProxy === true,
    imageGenEnabled: s.imageGenEnabled === true,
    imageBackend: s.imageBackend === 'xai' ? ('xai' as const) : ('spark' as const),
    imageBaseUrl: (s.imageBaseUrl || '').trim() || DEFAULT_SETTINGS.imageBaseUrl,
    imageToken: s.imageToken ?? DEFAULT_SETTINGS.imageToken,
    imageModel: (() => {
      const raw = (s.imageModel || '').trim() || DEFAULT_SETTINGS.imageModel;
      if (
        raw === 'comfy-dreamshaper' || raw === 'flux2-klein-9b' || raw === 'flux2-klein-4b' ||
        raw === 'DreamShaper_8_pruned' || raw === 'abliterated-flux-klein' ||
        raw === 'krea2-turbo-nvfp4' || raw === 'krea2-turbo-int8' || raw === 'quality' || raw === 'hero'
      ) {
        return 'krea2-raw-fp8';
      }
      return raw;
    })(),
    imageViaProxy: s.imageViaProxy === true,
    xaiImageBaseUrl: (s.xaiImageBaseUrl || '').trim() || DEFAULT_SETTINGS.xaiImageBaseUrl,
    xaiImageToken: s.xaiImageToken ?? DEFAULT_SETTINGS.xaiImageToken,
    xaiImageModel: (s.xaiImageModel || '').trim() || DEFAULT_SETTINGS.xaiImageModel,
    xaiImageResolution: s.xaiImageResolution === '1k' ? ('1k' as const) : ('2k' as const),
    xaiImageQuality: s.xaiImageQuality === 'low' ? ('low' as const) : s.xaiImageQuality === 'medium' ? ('medium' as const) : ('auto' as const),
    mcpServers: Array.isArray(s.mcpServers) ? s.mcpServers : [],
    skillsEnabled: s.skillsEnabled !== false,
    licenseKey: typeof s.licenseKey === 'string' ? s.licenseKey.trim() : DEFAULT_SETTINGS.licenseKey,
    billingSiteUrl: typeof s.billingSiteUrl === 'string' && s.billingSiteUrl.trim()
      ? s.billingSiteUrl.trim().replace(/\/+$/, '')
      : (DEFAULT_SETTINGS.billingSiteUrl || 'https://abliterated.app'),
    billingEmail: typeof s.billingEmail === 'string' ? s.billingEmail.trim() : '',
    accountEmail: typeof s.accountEmail === 'string' ? s.accountEmail.trim() : '',
    loginId: typeof s.loginId === 'string' ? s.loginId.trim() : '',
    deviceId: typeof s.deviceId === 'string' ? s.deviceId.trim() : '',
    accountLoggedIn: s.accountLoggedIn === true,
    setupComplete: s.setupComplete === true,
    projectRulesPinned: s.projectRulesPinned !== false,
    webSearchBraveKey: typeof s.webSearchBraveKey === 'string' ? s.webSearchBraveKey.trim() : '',
    webSearchSearxUrl: typeof s.webSearchSearxUrl === 'string' ? s.webSearchSearxUrl.trim() : '',
    remoteHostEnabled,
    systemPrompt,
  };

  if (flMig.patch) {
    result.reasoning = flMig.patch.reasoning;
    result.coalesceReasoningToContent = flMig.patch.coalesceReasoningToContent;
  }

  return result;
}

export function getSettings(): ClientSettings {
  const stored = readJson<Partial<ClientSettings>>(KEYS.settings, {});
  return sanitizeSettings(stored);
}

export function setSettings(settings: ClientSettings): void {
  const sanitized = sanitizeSettings(settings);
  writeJson(KEYS.settings, sanitized);
}

function sameToolSet(a: ToolType[] | undefined, b: readonly ToolType[]): boolean {
  if (!a || a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((t) => set.has(t));
}

function upgradeEnabledTools(tools: ToolType[] | undefined): ToolType[] {
  if (!tools || tools.length === 0) return [...ALL_TOOL_TYPES];
  if (sameToolSet(tools, OLD_DEFAULT_TOOLS)) return [...ALL_TOOL_TYPES];
  if (sameToolSet(tools, PREV_DEFAULT_TOOLS)) return [...ALL_TOOL_TYPES];
  if (sameToolSet(tools, PREV2_DEFAULT_TOOLS)) return [...ALL_TOOL_TYPES];
  if (sameToolSet(tools, PREV3_DEFAULT_TOOLS)) return [...ALL_TOOL_TYPES];
  if (sameToolSet(tools, PREV4_DEFAULT_TOOLS)) return [...ALL_TOOL_TYPES];
  if (sameToolSet(tools, PREV5_DEFAULT_TOOLS)) return [...ALL_TOOL_TYPES];
  if (sameToolSet(tools, PREV6_DEFAULT_TOOLS)) return [...ALL_TOOL_TYPES];
  if (sameToolSet(tools, PREV7_DEFAULT_TOOLS)) return [...ALL_TOOL_TYPES];
  if (!tools.includes('memory_search')) {
    return [...tools, 'memory_search', 'memory_save', 'memory_status', 'memory_wake'];
  }
  if (!tools.includes('todo')) return [...tools, 'todo'];
  if (!tools.includes('list_skills')) {
    return [...tools, 'list_skills', 'read_skill', 'suggest_skill', 'write_skill'];
  }
  if (!tools.includes('web_search')) return [...tools, 'web_search'];
  return tools;
}

export function getThreads(): Thread[] {
  const threads = readJson<Thread[]>(KEYS.threads, []);
  let changed = false;
  const next = threads.map((t) => {
    const enabledTools = upgradeEnabledTools(t.enabledTools);
    if (enabledTools === t.enabledTools) return t;
    if (
      t.enabledTools &&
      enabledTools.length === t.enabledTools.length &&
      enabledTools.every((x, i) => x === t.enabledTools[i])
    ) {
      return t;
    }
    changed = true;
    return { ...t, enabledTools };
  });
  if (changed) setThreads(next);
  return next;
}

export function setThreads(threads: Thread[]): void {
  writeJson(KEYS.threads, threads);
}

export function upsertThread(thread: Thread): Thread[] {
  const threads = getThreads();
  const idx = threads.findIndex((t) => t.id === thread.id);
  if (idx >= 0) threads[idx] = thread;
  else threads.unshift(thread);
  threads.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
  setThreads(threads);
  return threads;
}

export function deleteThread(id: string): Thread[] {
  const next = getThreads().filter((t) => t.id !== id);
  setThreads(next);
  deleteThreadMessages(id);
  return next;
}

export function getMessages(threadId?: string): Message[] {
  const all = readJson<Message[]>(KEYS.messages, []);
  if (!threadId) return all;
  return all.filter((m) => m.threadId === threadId);
}

export function setMessages(messages: Message[]): void {
  writeJson(KEYS.messages, windowMessages(messages));
}

export function saveMessage(message: Message): Message[] {
  let toSave = message;
  if (toSave.role === 'tool' && toSave.toolCall && 'result' in toSave.toolCall) {
    const { result: _, ...rest } = toSave.toolCall;
    toSave = { ...toSave, toolCall: rest };
  }
  const all = getMessages();
  const idx = all.findIndex((m) => m.id === toSave.id);
  if (idx >= 0) all[idx] = toSave;
  else all.push(toSave);
  setMessages(all);
  return all.filter((m) => m.threadId === toSave.threadId);
}

/** Replace one thread's rows in ablit_messages (used by Chat retry). */
export function replaceThreadMessages(threadId: string, msgs: Message[]): Message[] {
  const sanitized = msgs.map((m) => {
    if (m.role === 'tool' && m.toolCall && 'result' in m.toolCall) {
      const { result: _, ...rest } = m.toolCall;
      return { ...m, toolCall: rest, threadId };
    }
    return { ...m, threadId };
  });
  const others = getMessages().filter((m) => m.threadId !== threadId);
  const next = [...others, ...sanitized];
  setMessages(next);
  return sanitized;
}

export function deleteThreadMessages(threadId: string): void {
  setMessages(getMessages().filter((m) => m.threadId !== threadId));
}

export function getJobs(): Job[] {
  return readJson<Job[]>(KEYS.jobs, []).map((j) => ({
    ...j,
    prompt: typeof j.prompt === 'string' ? j.prompt : '',
    logs: Array.isArray(j.logs) ? j.logs : [],
    todos: Array.isArray(j.todos)
      ? j.todos.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      : undefined,
  }));
}

export function setJobs(jobs: Job[]): void {
  writeJson(KEYS.jobs, jobs);
}

export function upsertJob(job: Job): Job[] {
  const jobs = getJobs();
  const idx = jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) jobs[idx] = job;
  else jobs.unshift(job);
  setJobs(jobs);
  return jobs;
}

export function getWorkspace(): WorkspaceContext {
  const stored = readJson<Partial<WorkspaceContext>>(KEYS.workspace, {});
  const ws = { ...DEFAULT_WORKSPACE, ...stored };
  // Blank the placeholder always; blank a temp/scratch root only when it was
  // auto-adopted (not an explicit user choice), so an explicit /tmp workspace survives.
  if (ws.rootPath === '/workspace' || (isTemporaryPath(ws.rootPath) && !ws.rootExplicit)) {
    ws.rootPath = '';
  }
  return ws;
}

export function setWorkspace(workspace: WorkspaceContext): void {
  writeJson(KEYS.workspace, workspace);
}

export function getAgentRuns(): AgentRunRecord[] {
  return readJson<AgentRunRecord[]>(KEYS.agentRuns, []);
}

export function setAgentRuns(runs: AgentRunRecord[]): void {
  writeJson(KEYS.agentRuns, runs);
}

export function recordAgentRun(run: AgentRunRecord): AgentRunRecord[] {
  const next = appendAgentRun(getAgentRuns(), run, AGENT_RUNS_KEEP);
  setAgentRuns(next);
  return next;
}

export function wipeAll(): void {
  localStorage.removeItem(KEYS.settings);
  localStorage.removeItem(KEYS.threads);
  localStorage.removeItem(KEYS.messages);
  localStorage.removeItem(KEYS.jobs);
  localStorage.removeItem(KEYS.workspace);
  localStorage.removeItem(KEYS.agentRuns);
  localStorage.removeItem('ablit_apply_inbox');
  void import('./applyInbox')
    .then((m) => m.clearApplyInbox())
    .catch(() => undefined);
  void wipeDurableStore();
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
