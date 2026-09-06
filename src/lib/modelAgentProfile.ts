import { isLargeQwenAgentModel } from './featherlessQwen.js';
import { classifyModel } from './modelSettingsGuide.js';

export const CORE_AGENT_TOOLS = [
  'read_file',
  'write_file',
  'grep',
  'glob',
  'list_dir',
  'file_outline',
  'todo',
  'git_status',
  'git_diff',
  'memory_search',
] as const;

const FULL_TOOL_NAMES = [
  'web_fetch',
  'web_search',
  'read_file',
  'write_file',
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
  'todo',
  'list_skills',
  'read_skill',
  'suggest_skill',
  'write_skill',
  'memory_search',
  'memory_save',
  'memory_status',
  'memory_wake',
] as const;

const PLAN_TOOL_NAMES = [
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
  'list_skills',
  'read_skill',
  'suggest_skill',
  'memory_search',
  'memory_status',
  'memory_wake',
] as const;

type ToolName = string;

export type AgentToolTier = 'none' | 'core' | 'full';

export type ModelAgentProfile = {
  model: string;
  family: string;
  toolTier: AgentToolTier;
  sendTools: boolean;
  allowMcp: boolean;
  compactPrompt: boolean;
  useThoughtLock: boolean;
  toolNames: ToolName[];
  label: string;
  systemAddendum: string;
};

export type ModelAgentProfileInput = {
  model: string;
  provider?: string;
  reasoning?: string;
  planMode?: boolean;
  buildMode?: boolean;
  /** Live Featherless features.tool_use when known. */
  toolUse?: boolean;
  contextLength?: number;
  enabledTools?: readonly string[];
};

function likelySmallContext(model: string, contextLength?: number): boolean {
  if (typeof contextLength === 'number' && contextLength > 0 && contextLength < 16384) return true;
  return /(?:^|[^0-9])(0\.5b|0\.6b|1b|3b|7b|8b)(?:[-_]|$)/i.test(model);
}

function resolveTier(opts: ModelAgentProfileInput, toolsLikely: boolean, small: boolean): AgentToolTier {
  if (opts.planMode) {
    if (opts.toolUse === false) return 'none';
    if (opts.toolUse === true || toolsLikely) return small ? 'core' : 'full';
    return 'none';
  }
  if (opts.toolUse === false) return 'none';
  if (opts.provider === 'featherless') {
    if (opts.toolUse === true) return small ? 'core' : 'full';
    if (opts.toolUse === undefined && toolsLikely) return small ? 'core' : 'full';
    return 'none';
  }
  if (!toolsLikely) return 'none';
  return small ? 'core' : 'full';
}

function namesForTier(tier: AgentToolTier, planMode: boolean, enabled?: readonly string[]): ToolName[] {
  if (tier === 'none') return [];
  let allow: readonly string[] =
    tier === 'core' ? CORE_AGENT_TOOLS : enabled && enabled.length ? enabled : FULL_TOOL_NAMES;
  if (planMode) {
    const plan = new Set<string>(PLAN_TOOL_NAMES);
    allow = allow.filter((t) => plan.has(t));
  }
  if (enabled) {
    const set = new Set(enabled);
    allow = allow.filter((t) => set.has(t) || t === 'todo');
  }
  return [...new Set(allow)];
}

function addendum(opts: {
  model: string;
  family: string;
  tier: AgentToolTier;
  small: boolean;
  thinking: boolean;
  planMode: boolean;
  buildMode: boolean;
  contextLength?: number;
}): string {
  const ctx = opts.contextLength ? `${opts.contextLength} tok` : opts.small ? 'small window' : 'wide window';
  const lines = [`## Model profile — ${opts.model}`, `Family: ${opts.family}. Context: ${ctx}.`];
  if (opts.tier === 'none') {
    lines.push(
      'Native function tools are OFF for this checkpoint. Do not emit tool-call JSON, ```json tool_calls fences, or fake tool results.',
      'Write every file into the connected working directory as ```diff or a // relative/path fence in CONTENT. Thought is prose only.',
      'If you need a file you do not have, name the path instead of inventing its contents. Chat-only source is a failed build.',
    );
  } else if (opts.tier === 'core') {
    lines.push(
      'Compact tool set only: ' + CORE_AGENT_TOOLS.join(', ') + '.',
      'One tool at a time via the API tools channel. Never paste tool JSON in markdown fences.',
      'CODE ONLY IN CONTENT via write_file or ```diff / // path — files must land in the working directory. Never in thought.',
    );
  } else {
    lines.push(
      'Full native tools are available. Call write_file or emit path-headed diffs via the API tools channel — never paste tool JSON in markdown.',
      'CODE ONLY IN CONTENT via write_file or ```diff / // path — files must land in the working directory. Never in thought.',
    );
  }
  if (opts.thinking) {
    lines.push('Thinking model: Goal / Inspect / steps in reasoning first; no source there.');
  }
  if (opts.planMode) {
    lines.push('Plan lock: checklist then stop. No diffs.');
  } else if (opts.buildMode && opts.tier !== 'none') {
    lines.push('Build lock: todo → tools → diffs in content this turn.');
  } else if (opts.buildMode && opts.tier === 'none') {
    lines.push('Build lock without tools: emit real diffs in content this turn; do not paste a directory sketch twice.');
  }
  return lines.join('\n');
}

export function buildModelAgentProfile(opts: ModelAgentProfileInput): ModelAgentProfile {
  const model = (opts.model || '').trim() || '(none)';
  const klass = classifyModel(model);
  const small =
    opts.provider === 'featherless' && isLargeQwenAgentModel(model)
      ? false
      : likelySmallContext(model, opts.contextLength);
  const thinking = klass.family === 'thinking';
  let tier = resolveTier(opts, klass.toolsLikely, small);
  const eligibleLarge =
    opts.provider === 'featherless' && isLargeQwenAgentModel(model);
  // Featherless Qwen3 (non-large): keep a short core tool list to cut theater/death spirals.
  const featherlessQwen =
    opts.provider === 'featherless' && /qwen/i.test(model);
  if (featherlessQwen && !eligibleLarge && tier === 'full') {
    tier = 'core';
  }
  const toolNames = namesForTier(tier, !!opts.planMode, opts.enabledTools);
  // compactPrompt NEVER solely because featherless; eligible large Qwen keeps full prompt/tools/skills.
  const compactPrompt = eligibleLarge ? false : small || (featherlessQwen && !eligibleLarge);
  const useThoughtLock = (opts.reasoning || 'off') !== 'off' && (thinking || !small);
  const label =
    tier === 'none' ? `${klass.chip} · no-tools` : tier === 'core' ? `${klass.chip} · core-tools` : `${klass.chip} · tools`;
  return {
    model,
    family: klass.family,
    toolTier: tier,
    sendTools: toolNames.length > 0,
    allowMcp: tier === 'full' && !opts.planMode,
    compactPrompt,
    useThoughtLock,
    toolNames,
    label,
    systemAddendum: addendum({
      model,
      family: klass.label,
      tier,
      small,
      thinking,
      planMode: !!opts.planMode,
      buildMode: !!opts.buildMode && !opts.planMode,
      contextLength: opts.contextLength,
    }),
  };
}
