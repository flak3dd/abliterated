export type Tab = 'home' | 'workspace' | 'models' | 'jobs' | 'api' | 'settings' | 'images';
export type ReasoningLevel = 'off' | 'low' | 'high' | 'max';
export const ALL_TOOL_TYPES = [
  'web_fetch',
  'web_search',
  'read_file',
  'write_file',
  'shell',
  'verify',
  'grep',
  'glob',
  'git_status',
  'git_commit',
  'git_diff',
  'create_pr',
  'checkpoint_save',
  'checkpoint_restore',
  'list_dir',
  'file_outline',
  'semantic_search',
  'generate_image',
  'todo',
  'task_read',
  'task_update',
  'list_skills',
  'read_skill',
  'suggest_skill',
  'write_skill',
  'memory_search',
  'memory_save',
  'memory_status',
  'memory_wake',
] as const;
export type ToolType = (typeof ALL_TOOL_TYPES)[number];
/** Exact default lists from older builds — upgradeEnabledTools replaces these with ALL_TOOL_TYPES. */
export const OLD_DEFAULT_TOOLS: ToolType[] = ['web_fetch', 'read_file', 'shell'];
export const PREV_DEFAULT_TOOLS: ToolType[] = [
  'web_fetch',
  'read_file',
  'shell',
  'grep',
  'glob',
  'git_status',
  'git_commit',
];

/** Prior full tool list before git_diff / create_pr / checkpoints. */
export const PREV2_DEFAULT_TOOLS: ToolType[] = [
  'web_fetch',
  'read_file',
  'shell',
  'grep',
  'glob',
  'git_status',
  'git_commit',
  'list_dir',
  'file_outline',
  'semantic_search',
  'generate_image',
];

/** Prior full tool list before the todo checklist tool. */
export const PREV3_DEFAULT_TOOLS: ToolType[] = [
  'web_fetch',
  'read_file',
  'shell',
  'grep',
  'glob',
  'git_status',
  'git_commit',
  'git_diff',
  'create_pr',
  'checkpoint_save',
  'checkpoint_restore',
  'list_dir',
  'file_outline',
  'semantic_search',
  'generate_image',
];

/** Prior full tool list before skills tools. */
export const PREV4_DEFAULT_TOOLS: ToolType[] = [
  'web_fetch',
  'read_file',
  'shell',
  'grep',
  'glob',
  'git_status',
  'git_commit',
  'git_diff',
  'create_pr',
  'checkpoint_save',
  'checkpoint_restore',
  'list_dir',
  'file_outline',
  'semantic_search',
  'generate_image',
  'todo',
];

/** Prior full tool list before web_search. */
export const PREV5_DEFAULT_TOOLS: ToolType[] = [
  'web_fetch',
  'read_file',
  'shell',
  'grep',
  'glob',
  'git_status',
  'git_commit',
  'git_diff',
  'create_pr',
  'checkpoint_save',
  'checkpoint_restore',
  'list_dir',
  'file_outline',
  'semantic_search',
  'generate_image',
  'todo',
  'list_skills',
  'read_skill',
  'suggest_skill',
  'write_skill',
];

/** Prior full tool list before write_file / verify / task_read / task_update. */
export const PREV6_DEFAULT_TOOLS: ToolType[] = [
  'web_fetch',
  'web_search',
  'read_file',
  'shell',
  'grep',
  'glob',
  'git_status',
  'git_commit',
  'git_diff',
  'create_pr',
  'checkpoint_save',
  'checkpoint_restore',
  'list_dir',
  'file_outline',
  'semantic_search',
  'generate_image',
  'todo',
  'list_skills',
  'read_skill',
  'suggest_skill',
  'write_skill',
];

/** Prior full tool list before MemPalace memory_* tools. */
export const PREV7_DEFAULT_TOOLS: ToolType[] = [
  'web_fetch',
  'web_search',
  'read_file',
  'write_file',
  'shell',
  'verify',
  'grep',
  'glob',
  'git_status',
  'git_commit',
  'git_diff',
  'create_pr',
  'checkpoint_save',
  'checkpoint_restore',
  'list_dir',
  'file_outline',
  'semantic_search',
  'generate_image',
  'todo',
  'task_read',
  'task_update',
  'list_skills',
  'read_skill',
  'suggest_skill',
  'write_skill',
];

export const DEFAULT_ENABLED_TOOLS: ToolType[] = [...ALL_TOOL_TYPES];

/** Read-only tools allowed while Plan mode is on (writes unlock after approve). */
export const PLAN_MODE_TOOLS: ToolType[] = [
  'read_file',
  'grep',
  'glob',
  'list_dir',
  'file_outline',
  'semantic_search',
  'git_status',
  'git_diff',
  'web_fetch',
  'web_search',
  'todo',
  'task_read',
  'task_update',
  'list_skills',
  'read_skill',
  'suggest_skill',
  'memory_search',
  'memory_status',
  'memory_wake',
];

export type HunkStatus = 'pending' | 'accepted' | 'rejected';

export interface DiffHunk {
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
  status: HunkStatus;
}

export type ToolCallStatus = 'pending' | 'allowed' | 'denied' | 'executed' | 'error';

export interface ToolCallPayload {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: ToolCallStatus;
  result?: string;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type MessageStatus = 'streaming' | 'complete' | 'error';

export interface Message {
  id: string;
  threadId: string;
  role: MessageRole;
  content: string;
  reasoning?: string;
  toolCallId?: string;
  toolCall?: ToolCallPayload;
  toolCalls?: ToolCallPayload[];
  createdAt: number;
  status?: MessageStatus;
}

export interface Thread {
  id: string;
  title: string;
  model: string;
  pinned: boolean;
  systemPrompt?: string;
  enabledTools: ToolType[];
  /** Working directory when the session was created / last active. */
  workspaceRoot?: string;
  createdAt: number;
  updatedAt: number;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'incomplete';

export interface Job {
  id: string;
  projectName: string;
  title: string;
  prompt: string;
  threadId?: string;
  status: JobStatus;
  logs: string[];
  /** Bullet ToDo extracted from large-job planning output. */
  todos?: string[];
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  /** Why the job stopped: cap | abort | error | no_tools (optional). */
  stopReason?: 'cap' | 'abort' | 'error' | 'no_tools' | 'done';
  /** Multi-agent fleet job. */
  multiAgent?: boolean;
  fleetId?: string;
  /** Active role when multi-agent. */
  role?: 'orchestrator' | 'coder' | 'researcher' | 'tester' | 'verifier';
}

export interface WorkspaceContext {
  rootPath: string;
  currentBranch: string;
  isDirty: boolean;
  selectedFiles: string[];
  scratchpadContent: string;
}


export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export type InferenceProvider = 'abliteration' | 'dgx-spark' | 'featherless' | 'custom';

export interface ClientSettings {
  baseUrl: string;
  token: string;
  defaultModel: string;
  reasoning: ReasoningLevel;
  contextLength?: number;
  systemPrompt: string;
  remoteHostEnabled: boolean;
  pairingCode: string;
  /** Opt-in: apply parsed file edits via the localhost bridge without an Apply click. Default false. */
  autoAcceptEdits: boolean;
  /** Opt-in: run model shell tool calls on the localhost daemon without a Run click. Default false. Independent of autoAcceptEdits. */
  autoRunShell: boolean;
  /** Max agent loop turns per run. Default 24; UI clamps 1–50. */
  maxAgentTurns: number;
  /** How many Jobs may run in parallel (1 = single-flight). */
  maxConcurrentJobs: number;
  /** After a text-only answer, optionally self-review / deepen. Default true. */
  selfDeepenEnabled: boolean;
  /** Max deepen passes per run (0–5). Default 2; 0 disables even if enabled. */
  selfDeepenPasses: number;
  /**
   * When true, self-deepen / Jobs inject Abliterated-only completeness checklist
   * from deepenComplete.ts. Default matches self-deepen (on unless stored off).
   */
  deepenCompleteness: boolean;
  /** When true (default), user can queue messages while the agent is busy (mid-run barge-in). */
  midRunInjectEnabled: boolean;
  /** When true (default), parse/show completion footer Continue chips; prompt still asks for the footer when on. */
  completionFooterEnabled: boolean;
  /** When true (default), promote reasoning into content if the content channel is empty (zero-cost; no API retry). */
  coalesceReasoningToContent: boolean;
  /** Default Plan-mode preference (UI may still toggle per session). */
  planModeEnabled: boolean;
  /** Implementation protocol: ToDo after reasoning, skeleton first. */
  buildModeEnabled: boolean;
  /** Optional small/fast model id for summaries/footers (empty = use active model). */
  fastModel: string;
  /** Which inference backend the UI routes chat/models through. Default abliteration. */
  inferenceProvider: InferenceProvider;
  /** Master availability flag for DGX Spark / NIM. Off by default. */
  sparkEnabled: boolean;
  sparkBaseUrl: string;
  sparkToken: string;
  sparkModel: string;
  /** When true (default), DEV rewrites local Spark URLs to same-origin `/spark-v1`. */
  sparkViaProxy: boolean;
  /** Master availability for Featherless. Default true when selected. */
  featherlessEnabled: boolean;
  featherlessBaseUrl: string;
  /** Featherless API key (preferred cloud mode). */
  featherlessToken: string;
  featherlessModel: string;
  /** When true, DEV rewrites local Featherless (:3000) URLs to `/featherless-v1`. Cloud api.featherless.ai uses `/featherless-api` regardless. */
  featherlessViaProxy: boolean;
  /** Opt-in local/OpenAI-compatible image generation. Default false. */
  imageGenEnabled: boolean;
  imageBaseUrl: string;
  imageToken: string;
  imageModel: string;
  /** When true (default), DEV rewrites local image URLs to same-origin `/image-v1`. */
  imageViaProxy: boolean;
  /** Optional MCP stdio servers (spawned via localhost bridge). */
  mcpServers: McpServerConfig[];
  /** Freemium license key (localStorage). Empty = Free tier. */
  licenseKey: string;
  /** Billing site origin for in-app checkout (default https://abliterated.app). */
  billingSiteUrl?: string;
  /** Receipt / redeem email remembered for checkout. */
  billingEmail?: string;
  /** Account email from Sign up / Log in (preferred over billingEmail when set). */
  accountEmail?: string;
  /** Server-issued login id bound to this device. */
  loginId?: string;
  /** Stable per-install device fingerprint for auth / redeem. */
  deviceId?: string;
  /** True when the user completed Sign up or Log in successfully. */
  accountLoggedIn?: boolean;
  /** Discover/follow SKILL.md recipes (default true). */
  skillsEnabled: boolean;
  /** Optional Brave Search API key (X-Subscription-Token). Empty = keyless HTML search. */
  webSearchBraveKey: string;
  /** Optional SearxNG base URL (JSON format). Empty = unused. */
  webSearchSearxUrl: string;
  /** Opt-in: per-Job git worktree under .ablit/worktrees/<jobId>. Default false (bridge single-ROOT stub). */
  jobWorktreesEnabled: boolean;
  /** Opt-in multi-agent orchestrator/workers/critic. Default false. */
  multiAgentEnabled: boolean;
  /** Local MemPalace (verbatim memory palace). Default true; degrades if CLI missing. */
  mempalaceEnabled: boolean;
  /** Palace directory. Empty = MemPalace default (~/.mempalace/palace). */
  mempalacePalacePath: string;
  /** Wing override. Empty = basename of the connected workspace. */
  mempalaceWing: string;
  /** Inject wake-up (L0+L1) into the system prompt. Default true when enabled. */
  mempalaceAutoRecall: boolean;
  /** File the last user/assistant turn into the palace after each run. Default true when enabled. */
  mempalaceAutoSave: boolean;
  /** Verify-strict quality loop (Build + skills auto-inject). Default true. */
  verifyStrictProfile: boolean;
}

export type ChatOpenAiToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ChatOpenAiMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ChatOpenAiToolCall[];
  /** Qwen3/vLLM thinking — resend on later turns so tool loops keep prior reasoning. */
  reasoning_content?: string;
};
