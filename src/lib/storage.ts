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
import { LEGACY_PROMPTS, SYSTEM_PROMPT } from './systemPrompt';

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

const envToken = (import.meta.env.VITE_ABLITERATED_TOKEN as string | undefined)?.trim() || '';
const envBase = (import.meta.env.VITE_ABLITERATED_BASE_URL as string | undefined)?.trim() || 'https://api.abliteration.ai/v1';
const envModel = (import.meta.env.VITE_ABLITERATED_MODEL as string | undefined)?.trim() || 'abliterated-model';

export const DEFAULT_SETTINGS: ClientSettings = {
  baseUrl: envBase,
  token: envToken,
  defaultModel: envModel,
  reasoning: 'off',
  systemPrompt: SYSTEM_PROMPT,
  remoteHostEnabled: true,
  pairingCode: randomPairingCode(),
  autoAcceptEdits: false,
  autoRunShell: false,
  maxAgentTurns: DEFAULT_MAX_AGENT_TURNS,
  selfDeepenEnabled: true,
  selfDeepenPasses: DEFAULT_SELF_DEEPEN_PASSES,
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
  featherlessEnabled: true,
  featherlessBaseUrl: 'https://api.featherless.ai/v1',
  featherlessToken: '',
  featherlessModel: 'Qwen/Qwen2.5-7B-Instruct',
  featherlessViaProxy: false,
  imageGenEnabled: false,
  imageBaseUrl: 'http://127.0.0.1:7860/v1',
  imageToken: '',
  imageModel: 'abliterated-flux-klein',
  imageViaProxy: true,
  mcpServers: [],
  skillsEnabled: true,
  licenseKey: import.meta.env.DEV ? 'ABLIT-ADMIN' : '',
  webSearchBraveKey: '',
  webSearchSearxUrl: '',
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

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    const quota =
      name === 'QuotaExceededError' ||
      name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      (typeof err === 'object' &&
        err != null &&
        'code' in err &&
        (err as { code?: number }).code === 22) ||
      (err instanceof Error && /quota/i.test(err.message));
    if (quota) {
      console.warn(`[ablit] localStorage quota exceeded writing ${key}`);
      return;
    }
    console.warn(`[ablit] localStorage write failed for ${key}`, err);
  }
}

export function getSettings(): ClientSettings {
  const stored = readJson<Partial<ClientSettings>>(KEYS.settings, {});
  const storedPrompt = stored.systemPrompt;
  const systemPrompt =
    !storedPrompt || (LEGACY_PROMPTS as readonly string[]).includes(storedPrompt)
      ? SYSTEM_PROMPT
      : storedPrompt;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    baseUrl: stored.baseUrl?.trim() || DEFAULT_SETTINGS.baseUrl,
    token: stored.token?.trim() || DEFAULT_SETTINGS.token,
    defaultModel: stored.defaultModel?.trim() || DEFAULT_SETTINGS.defaultModel,
    pairingCode: stored.pairingCode || randomPairingCode(),
    autoAcceptEdits: stored.autoAcceptEdits === true,
    autoRunShell: stored.autoRunShell === true,
    maxAgentTurns: clampMaxAgentTurns(
      stored.maxAgentTurns != null ? stored.maxAgentTurns : DEFAULT_MAX_AGENT_TURNS,
    ),
    selfDeepenEnabled: stored.selfDeepenEnabled !== false,
    selfDeepenPasses: (() => {
      let passes = clampSelfDeepenPasses(
        stored.selfDeepenPasses != null ? stored.selfDeepenPasses : DEFAULT_SELF_DEEPEN_PASSES,
      );
      // Free tier: cap self-deepen cost (0–1 max).
      const license = getLicenseState({
        licenseKey:
          typeof stored.licenseKey === 'string' ? stored.licenseKey.trim() : DEFAULT_SETTINGS.licenseKey,
      });
      if (license.isFree) {
        passes = Math.min(passes, license.features.maxSelfDeepenPasses);
      }
      return passes;
    })(),
    midRunInjectEnabled: stored.midRunInjectEnabled !== false,
    completionFooterEnabled: stored.completionFooterEnabled !== false,
    coalesceReasoningToContent: stored.coalesceReasoningToContent !== false,
    planModeEnabled: stored.planModeEnabled === true,
    buildModeEnabled: stored.buildModeEnabled !== false,
    fastModel: stored.fastModel?.trim() || '',
    maxConcurrentJobs: clampMaxConcurrentJobs(
      stored.maxConcurrentJobs != null ? stored.maxConcurrentJobs : DEFAULT_MAX_CONCURRENT_JOBS,
    ),
    inferenceProvider: stored.inferenceProvider || 'abliteration',
    sparkEnabled: stored.sparkEnabled === true,
    sparkBaseUrl: stored.sparkBaseUrl?.trim() || DEFAULT_SETTINGS.sparkBaseUrl,
    sparkToken: stored.sparkToken ?? DEFAULT_SETTINGS.sparkToken,
    sparkModel: stored.sparkModel?.trim() || DEFAULT_SETTINGS.sparkModel,
    sparkViaProxy: stored.sparkViaProxy !== false,
    featherlessEnabled: stored.featherlessEnabled !== false,
    featherlessBaseUrl: (() => {
      const raw = stored.featherlessBaseUrl?.trim() || '';
      const legacyLocal =
        raw === 'http://127.0.0.1:3000/v1' ||
        raw === 'http://localhost:3000/v1';
      if (!raw || legacyLocal) return DEFAULT_SETTINGS.featherlessBaseUrl;
      return raw;
    })(),
    featherlessToken: stored.featherlessToken ?? DEFAULT_SETTINGS.featherlessToken,
    featherlessModel: stored.featherlessModel?.trim() || DEFAULT_SETTINGS.featherlessModel,
    featherlessViaProxy: (() => {
      const raw = stored.featherlessBaseUrl?.trim() || '';
      const legacyLocal =
        raw === 'http://127.0.0.1:3000/v1' ||
        raw === 'http://localhost:3000/v1';
      if (!raw || legacyLocal) return false;
      // Cloud API-key mode defaults: viaProxy off unless explicitly enabled (for local OAuth)
      return stored.featherlessViaProxy === true;
    })(),
    imageGenEnabled: stored.imageGenEnabled === true,
    imageBaseUrl: stored.imageBaseUrl?.trim() || DEFAULT_SETTINGS.imageBaseUrl,
    imageToken: stored.imageToken ?? DEFAULT_SETTINGS.imageToken,
    imageModel: stored.imageModel?.trim() || DEFAULT_SETTINGS.imageModel,
    imageViaProxy: stored.imageViaProxy !== false,
    mcpServers: Array.isArray(stored.mcpServers) ? stored.mcpServers : [],
    skillsEnabled: stored.skillsEnabled !== false,
    licenseKey:
      typeof stored.licenseKey === 'string' ? stored.licenseKey.trim() : DEFAULT_SETTINGS.licenseKey,
    webSearchBraveKey:
      typeof stored.webSearchBraveKey === 'string' ? stored.webSearchBraveKey.trim() : '',
    webSearchSearxUrl:
      typeof stored.webSearchSearxUrl === 'string' ? stored.webSearchSearxUrl.trim() : '',
    systemPrompt,
  };
}

export function setSettings(settings: ClientSettings): void {
  writeJson(KEYS.settings, settings);
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
  writeJson(KEYS.messages, messages);
}

export function saveMessage(message: Message): Message[] {
  const all = getMessages();
  const idx = all.findIndex((m) => m.id === message.id);
  if (idx >= 0) all[idx] = message;
  else all.push(message);
  setMessages(all);
  return all.filter((m) => m.threadId === message.threadId);
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
  if (ws.rootPath === '/workspace') ws.rootPath = '';
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
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
