import type { AgentMode, ClientSettings, InferenceProvider } from '../types';

export type AgentSetupId =
  | 'autonomous_builder'
  | 'architect_planner'
  | 'strict_verifier'
  | 'fast_chat'
  | 'multi_agent';

export interface AgentSetupProfile {
  id: AgentSetupId;
  name: string;
  icon: string;
  badge: string;
  tagline: string;
  description: string;
  recommendedAgentMode: AgentMode;
  preferredProviders: readonly InferenceProvider[];
  recommendedToggles: {
    buildModeEnabled: boolean;
    planModeEnabled: boolean;
    autoAcceptEdits: boolean;
    autoRunShell: boolean;
    verifyStrictProfile: boolean;
    selfDeepenEnabled: boolean;
    deepenCompleteness: boolean;
    skillsEnabled: boolean;
    projectRulesPinned: boolean;
    midRunInjectEnabled: boolean;
    coalesceReasoningToContent: boolean;
    completionFooterEnabled: boolean;
    mempalaceEnabled: boolean;
    mempalaceAutoRecall: boolean;
    mempalaceAutoSave: boolean;
    jobWorktreesEnabled: boolean;
    multiAgentEnabled: boolean;
    remoteHostEnabled: boolean;
    postEditDiagnostics: boolean;
  };
  recommendedNumbers?: {
    maxAgentTurns?: number;
    selfDeepenPasses?: number;
    maxConcurrentJobs?: number;
  };
}

export const AGENT_SETUP_PROFILES: readonly AgentSetupProfile[] = [
  {
    id: 'autonomous_builder',
    name: 'Autonomous Builder',
    icon: '🚀',
    badge: 'Popular',
    tagline: 'High-autonomy hands-free coding, tool execution & self-verification',
    description:
      'Optimized for active software development. Automatically accepts file diffs, enforces build protocols, discovers skills, and executes deep multi-step loops.',
    recommendedAgentMode: 'agent',
    preferredProviders: ['dgx-spark', 'abliteration', 'platform'],
    recommendedToggles: {
      buildModeEnabled: true,
      planModeEnabled: false,
      autoAcceptEdits: true,
      autoRunShell: false, // safer default; operators can toggle ON with warning
      verifyStrictProfile: true,
      selfDeepenEnabled: true,
      deepenCompleteness: true,
      skillsEnabled: true,
      projectRulesPinned: true,
      midRunInjectEnabled: true,
      coalesceReasoningToContent: true,
      completionFooterEnabled: true,
      mempalaceEnabled: true,
      mempalaceAutoRecall: true,
      mempalaceAutoSave: true,
      jobWorktreesEnabled: false,
      multiAgentEnabled: false,
      remoteHostEnabled: true,
      postEditDiagnostics: true,
    },
    recommendedNumbers: {
      maxAgentTurns: 30,
      selfDeepenPasses: 2,
    },
  },
  {
    id: 'architect_planner',
    name: 'Architect & Planner',
    icon: '🛡️',
    badge: 'Safe',
    tagline: 'Read-only exploration, strict plan-before-act, zero unapproved writes',
    description:
      'Locks the agent into Plan mode. Inspects the codebase, outlines files, and drafts verified specifications without touching or mutating workspace code.',
    recommendedAgentMode: 'plan',
    preferredProviders: ['featherless', 'custom', 'platform'],
    recommendedToggles: {
      planModeEnabled: true,
      buildModeEnabled: false,
      autoAcceptEdits: false,
      autoRunShell: false,
      verifyStrictProfile: false,
      selfDeepenEnabled: true,
      deepenCompleteness: false,
      skillsEnabled: true,
      projectRulesPinned: true,
      midRunInjectEnabled: true,
      coalesceReasoningToContent: true,
      completionFooterEnabled: true,
      mempalaceEnabled: true,
      mempalaceAutoRecall: true,
      mempalaceAutoSave: true,
      jobWorktreesEnabled: false,
      multiAgentEnabled: false,
      remoteHostEnabled: true,
      postEditDiagnostics: false,
    },
    recommendedNumbers: {
      maxAgentTurns: 20,
      selfDeepenPasses: 1,
    },
  },
  {
    id: 'strict_verifier',
    name: 'Strict Verifier',
    icon: '🎯',
    badge: 'Quality',
    tagline: 'Exhaustive verification, completeness checklists & proof before done',
    description:
      'Rigorous quality loop. Auto-injects verification skills, mandates 3-pass completeness reviews, and prevents the model from stopping until proof passes.',
    recommendedAgentMode: 'agent',
    preferredProviders: ['dgx-spark', 'abliteration'],
    recommendedToggles: {
      verifyStrictProfile: true,
      buildModeEnabled: true,
      planModeEnabled: false,
      autoAcceptEdits: true,
      autoRunShell: false,
      selfDeepenEnabled: true,
      deepenCompleteness: true,
      skillsEnabled: true,
      projectRulesPinned: true,
      midRunInjectEnabled: true,
      coalesceReasoningToContent: true,
      completionFooterEnabled: true,
      mempalaceEnabled: true,
      mempalaceAutoRecall: true,
      mempalaceAutoSave: true,
      jobWorktreesEnabled: false,
      multiAgentEnabled: false,
      remoteHostEnabled: true,
      postEditDiagnostics: true,
    },
    recommendedNumbers: {
      maxAgentTurns: 36,
      selfDeepenPasses: 3,
    },
  },
  {
    id: 'fast_chat',
    name: 'Fast Q&A & Research',
    icon: '⚡',
    badge: 'Fast',
    tagline: 'Low-latency conversational answers with verbatim memory recall',
    description:
      'Streamlined for interactive exploration and quick questions. Bypasses multi-turn self-deepening and build loops to save latency and token costs.',
    recommendedAgentMode: 'ask',
    preferredProviders: ['featherless', 'custom'],
    recommendedToggles: {
      planModeEnabled: false,
      buildModeEnabled: false,
      selfDeepenEnabled: false,
      deepenCompleteness: false,
      autoAcceptEdits: false,
      autoRunShell: false,
      verifyStrictProfile: false,
      skillsEnabled: true,
      projectRulesPinned: true,
      midRunInjectEnabled: true,
      coalesceReasoningToContent: true,
      completionFooterEnabled: false,
      mempalaceEnabled: true,
      mempalaceAutoRecall: true,
      mempalaceAutoSave: true,
      jobWorktreesEnabled: false,
      multiAgentEnabled: false,
      remoteHostEnabled: true,
      postEditDiagnostics: false,
    },
    recommendedNumbers: {
      maxAgentTurns: 12,
      selfDeepenPasses: 0,
    },
  },
  {
    id: 'multi_agent',
    name: 'Multi-Agent Swarm',
    icon: '🌐',
    badge: 'Experimental',
    tagline: 'Orchestrator + parallel coder/verifier roles on git worktrees',
    description:
      'Coordinates multiple sub-agents over .ablit/task.json blackboard. Isolates background Jobs in real git worktrees to prevent workspace collisions.',
    recommendedAgentMode: 'agent',
    preferredProviders: ['dgx-spark', 'abliteration'],
    recommendedToggles: {
      multiAgentEnabled: true,
      jobWorktreesEnabled: true,
      buildModeEnabled: true,
      planModeEnabled: false,
      autoAcceptEdits: true,
      autoRunShell: false,
      verifyStrictProfile: true,
      selfDeepenEnabled: true,
      deepenCompleteness: true,
      skillsEnabled: true,
      projectRulesPinned: true,
      midRunInjectEnabled: true,
      coalesceReasoningToContent: true,
      completionFooterEnabled: true,
      mempalaceEnabled: true,
      mempalaceAutoRecall: true,
      mempalaceAutoSave: true,
      remoteHostEnabled: true,
      postEditDiagnostics: true,
    },
    recommendedNumbers: {
      maxAgentTurns: 40,
      selfDeepenPasses: 2,
      maxConcurrentJobs: 2,
    },
  },
];

export type ToggleKey = keyof AgentSetupProfile['recommendedToggles'];

export const TRACKED_TOGGLE_KEYS: readonly ToggleKey[] = [
  'buildModeEnabled',
  'planModeEnabled',
  'autoAcceptEdits',
  'autoRunShell',
  'verifyStrictProfile',
  'selfDeepenEnabled',
  'deepenCompleteness',
  'skillsEnabled',
  'projectRulesPinned',
  'midRunInjectEnabled',
  'coalesceReasoningToContent',
  'completionFooterEnabled',
  'mempalaceEnabled',
  'mempalaceAutoRecall',
  'mempalaceAutoSave',
  'jobWorktreesEnabled',
  'multiAgentEnabled',
  'remoteHostEnabled',
  'postEditDiagnostics',
];

/** Extract boolean value for a tracked toggle from settings with safe defaults */
export function getSettingToggleValue(settings: ClientSettings, key: ToggleKey): boolean {
  switch (key) {
    case 'buildModeEnabled':
      return settings.buildModeEnabled !== false && !settings.planModeEnabled;
    case 'planModeEnabled':
      return settings.planModeEnabled === true;
    case 'autoAcceptEdits':
      return settings.autoAcceptEdits === true;
    case 'autoRunShell':
      return settings.autoRunShell === true;
    case 'verifyStrictProfile':
      return settings.verifyStrictProfile === true;
    case 'selfDeepenEnabled':
      return settings.selfDeepenEnabled !== false;
    case 'deepenCompleteness':
      return settings.deepenCompleteness !== false;
    case 'skillsEnabled':
      return settings.skillsEnabled !== false;
    case 'projectRulesPinned':
      return settings.projectRulesPinned !== false;
    case 'midRunInjectEnabled':
      return settings.midRunInjectEnabled !== false;
    case 'coalesceReasoningToContent':
      return settings.coalesceReasoningToContent !== false;
    case 'completionFooterEnabled':
      return settings.completionFooterEnabled !== false;
    case 'mempalaceEnabled':
      return settings.mempalaceEnabled !== false;
    case 'mempalaceAutoRecall':
      return settings.mempalaceAutoRecall !== false;
    case 'mempalaceAutoSave':
      return settings.mempalaceAutoSave !== false;
    case 'jobWorktreesEnabled':
      return settings.jobWorktreesEnabled === true;
    case 'multiAgentEnabled':
      return settings.multiAgentEnabled === true;
    case 'remoteHostEnabled':
      return settings.remoteHostEnabled !== false;
    case 'postEditDiagnostics':
      return settings.postEditDiagnostics === true;
    default:
      return false;
  }
}

export interface SetupMatch {
  setup: AgentSetupProfile;
  matchScore: number;
  totalKeys: number;
  matchingKeys: number;
  divergentKeys: ToggleKey[];
}

/** Analyze how closely the current client settings match each agent setup profile */
export function evaluateSetupMatches(settings: ClientSettings): SetupMatch[] {
  return AGENT_SETUP_PROFILES.map((setup) => {
    let matchCount = 0;
    const divergentKeys: ToggleKey[] = [];
    for (const key of TRACKED_TOGGLE_KEYS) {
      const current = getSettingToggleValue(settings, key);
      const recommended = setup.recommendedToggles[key];
      if (current === recommended) {
        matchCount++;
      } else {
        divergentKeys.push(key);
      }
    }
    const matchScore = Math.round((matchCount / TRACKED_TOGGLE_KEYS.length) * 100);
    return {
      setup,
      matchScore,
      totalKeys: TRACKED_TOGGLE_KEYS.length,
      matchingKeys: matchCount,
      divergentKeys,
    };
  }).sort((a, b) => b.matchScore - a.matchScore);
}

/** Detect the dominant agent setup, or return the closest one with divergence info */
export function detectActiveSetup(settings: ClientSettings): {
  activeSetup: AgentSetupProfile;
  isExactMatch: boolean;
  matchScore: number;
  divergentCount: number;
  divergentKeys: ToggleKey[];
} {
  const matches = evaluateSetupMatches(settings);
  const best = matches[0] ?? {
    setup: AGENT_SETUP_PROFILES[0],
    matchScore: 100,
    totalKeys: TRACKED_TOGGLE_KEYS.length,
    matchingKeys: TRACKED_TOGGLE_KEYS.length,
    divergentKeys: [],
  };
  return {
    activeSetup: best.setup,
    isExactMatch: best.matchScore === 100,
    matchScore: best.matchScore,
    divergentCount: best.divergentKeys.length,
    divergentKeys: best.divergentKeys,
  };
}

/** Apply all recommended toggles, agent mode, and numbers for a chosen agent setup */
export function applyAgentSetup(settings: ClientSettings, setupId: AgentSetupId): ClientSettings {
  const profile = AGENT_SETUP_PROFILES.find((p) => p.id === setupId) ?? AGENT_SETUP_PROFILES[0];
  const next: ClientSettings = {
    ...settings,
    ...profile.recommendedToggles,
    agentMode: profile.recommendedAgentMode,
  };
  if (profile.recommendedNumbers?.maxAgentTurns != null) {
    next.maxAgentTurns = profile.recommendedNumbers.maxAgentTurns;
  }
  if (profile.recommendedNumbers?.selfDeepenPasses != null) {
    next.selfDeepenPasses = profile.recommendedNumbers.selfDeepenPasses;
  }
  if (profile.recommendedNumbers?.maxConcurrentJobs != null) {
    next.maxConcurrentJobs = profile.recommendedNumbers.maxConcurrentJobs;
  }
  return next;
}

// ---------------------------------------------------------------------------
// AI Agent API & Inference Provider Alignment System
// ---------------------------------------------------------------------------

export interface ProviderSetupAlignment {
  provider: InferenceProvider;
  name: string;
  badge: string;
  recommendedSetupId: AgentSetupId;
  recommendedMode: AgentMode;
  tagline: string;
  description: string;
  hardwareProfile: string;
  tokenEconomics: string;
  recommendedNumbers: {
    maxAgentTurns: number;
    selfDeepenPasses: number;
    maxConcurrentJobs?: number;
  };
  toggleOverrides?: Partial<Record<ToggleKey, boolean>>;
  tips: readonly string[];
}

export const PROVIDER_SETUP_ALIGNMENTS: Record<InferenceProvider, ProviderSetupAlignment> = {
  'dgx-spark': {
    provider: 'dgx-spark',
    name: 'DGX Spark',
    badge: 'Local Supercluster',
    recommendedSetupId: 'autonomous_builder',
    recommendedMode: 'agent',
    tagline: 'High-throughput local vLLM, zero token fees, unlimited multi-turn loops',
    description:
      'Leverages your local Spark / GB10 cluster (:8000 via Vite proxy) with maximum turn caps, full strict verification passes, and git worktrees with zero marginal token costs.',
    hardwareProfile: 'Local GB10 / Spark Cluster (:8000)',
    tokenEconomics: 'Zero marginal token cost · Unlimited bandwidth',
    recommendedNumbers: {
      maxAgentTurns: 40,
      selfDeepenPasses: 3,
      maxConcurrentJobs: 2,
    },
    toggleOverrides: {
      verifyStrictProfile: true,
      selfDeepenEnabled: true,
      deepenCompleteness: true,
      completionFooterEnabled: true,
      remoteHostEnabled: true,
      jobWorktreesEnabled: true,
      postEditDiagnostics: true,
    },
    tips: [
      'Run long autonomous loops without worrying about per-token API spend',
      'Enable worktrees to run parallel agent jobs without git workspace conflicts',
      '3-pass strict verification catches subtle syntax or logic regressions before stopping',
    ],
  },
  featherless: {
    provider: 'featherless',
    name: 'Featherless (BYOK)',
    badge: 'Serverless Open-Weights',
    recommendedSetupId: 'architect_planner',
    recommendedMode: 'plan',
    tagline: 'Budget-conscious serverless open-weights with long-term memory recall',
    description:
      'Cloud BYOK inference with per-token billing and variable context limits. Optimized for concise prompts, MemPalace memory retrieval over context-stuffing, and controlled turn limits.',
    hardwareProfile: 'Cloud Serverless (api.featherless.ai)',
    tokenEconomics: 'Metered BYOK per-token billing · Latency-sensitive',
    recommendedNumbers: {
      maxAgentTurns: 20,
      selfDeepenPasses: 1,
      maxConcurrentJobs: 1,
    },
    toggleOverrides: {
      deepenCompleteness: false,
      coalesceReasoningToContent: true,
      mempalaceAutoRecall: true,
      mempalaceAutoSave: true,
      completionFooterEnabled: true,
      jobWorktreesEnabled: false,
      postEditDiagnostics: false,
    },
    tips: [
      'Use MemPalace memory recall to keep context windows small, fast, and cheap',
      'Plan mode drafts verified outlines first, preventing costly redundant edits',
      'Capped turn limit of 20 avoids runaway agent loops on metered API accounts',
    ],
  },
  platform: {
    provider: 'platform',
    name: 'Platform Gateway',
    badge: 'Managed Wallet',
    recommendedSetupId: 'autonomous_builder',
    recommendedMode: 'agent',
    tagline: 'Hosted SaaS gateway with device token wallet metering and completion footers',
    description:
      'Official hosted gateway at abliterated.app. Streamlined for reliable autonomous builds, wallet-conscious turn budgeting, and real-time completion status footers.',
    hardwareProfile: 'Managed Cloud Gateway (abliterated.app/api/v1)',
    tokenEconomics: 'Device Token Wallet · Metered per turn',
    recommendedNumbers: {
      maxAgentTurns: 24,
      selfDeepenPasses: 2,
      maxConcurrentJobs: 1,
    },
    toggleOverrides: {
      completionFooterEnabled: true,
      midRunInjectEnabled: true,
      autoAcceptEdits: true,
      verifyStrictProfile: true,
      postEditDiagnostics: true,
    },
    tips: [
      'Completion footer provides live feedback on tool runs and wallet consumption',
      'Mid-run steering injection lets you redirect the agent without killing the task',
      'Auto-accept edits ensures smooth autonomous progression across multi-file refactors',
    ],
  },
  abliteration: {
    provider: 'abliteration',
    name: 'Abliteration Cluster',
    badge: 'Native Uncensored',
    recommendedSetupId: 'autonomous_builder',
    recommendedMode: 'agent',
    tagline: 'Native uncensored cluster with native thought-locking and full tools',
    description:
      'Official cluster endpoint with specialized abliterated model templates. Tuned for deep autonomous reasoning, unconstrained tool use, and mid-run steerability.',
    hardwareProfile: 'Official Abliteration Cluster (api.abliteration.ai/v1)',
    tokenEconomics: 'Native Cluster Access · High Throughput',
    recommendedNumbers: {
      maxAgentTurns: 32,
      selfDeepenPasses: 2,
      maxConcurrentJobs: 1,
    },
    toggleOverrides: {
      verifyStrictProfile: true,
      deepenCompleteness: true,
      skillsEnabled: true,
      midRunInjectEnabled: true,
      coalesceReasoningToContent: true,
      completionFooterEnabled: true,
      postEditDiagnostics: true,
    },
    tips: [
      'Native thought-locking keeps reasoning isolated from workspace code writes',
      'Mid-run injection allows injecting instructions while the agent is executing',
      'Unconstrained tool calling executes complex multi-file edits reliably',
    ],
  },
  custom: {
    provider: 'custom',
    name: 'Custom (BYOK)',
    badge: 'Self-Hosted / Third-Party',
    recommendedSetupId: 'architect_planner',
    recommendedMode: 'plan',
    tagline: 'Defensive safeguards and adaptive turn caps for external endpoints',
    description:
      'Self-hosted Ollama, LMStudio, OpenRouter, or remote vLLM endpoints. Equipped with defensive safeguards (safe diff review, conservative turn limits, shell approval required).',
    hardwareProfile: 'User Endpoint (Ollama / LMStudio / OpenRouter / LAN)',
    tokenEconomics: 'Variable backend pricing & limits',
    recommendedNumbers: {
      maxAgentTurns: 16,
      selfDeepenPasses: 1,
      maxConcurrentJobs: 1,
    },
    toggleOverrides: {
      autoAcceptEdits: false,
      autoRunShell: false,
      deepenCompleteness: false,
      completionFooterEnabled: true,
      postEditDiagnostics: false,
    },
    tips: [
      'Auto-accept edits and shell are disabled for safety with untested models',
      'Start in Plan mode to inspect codebase before committing writes',
      'Conservative turn cap of 16 protects against infinite tool loops on external APIs',
    ],
  },
};

/** Get the official setup alignment configuration for a given inference provider */
export function getProviderSetupAlignment(provider: InferenceProvider): ProviderSetupAlignment {
  return PROVIDER_SETUP_ALIGNMENTS[provider] ?? PROVIDER_SETUP_ALIGNMENTS.abliteration;
}

/**
 * Align client settings for a specific AI agent API / inference provider.
 * Applies the optimal profile (or an operator-selected target profile), tuned turn/deepen numbers,
 * and provider-specific toggle overrides.
 */
export function alignSetupForProvider(
  settings: ClientSettings,
  provider: InferenceProvider,
  targetSetupId?: AgentSetupId,
): ClientSettings {
  const alignment = getProviderSetupAlignment(provider);
  const chosenSetupId = targetSetupId ?? alignment.recommendedSetupId;

  // 1. Apply base profile recommendations
  let next = applyAgentSetup(settings, chosenSetupId);

  // 2. Tune numbers specifically for this provider's economics & hardware profile
  next.maxAgentTurns = alignment.recommendedNumbers.maxAgentTurns;
  next.selfDeepenPasses = alignment.recommendedNumbers.selfDeepenPasses;
  if (alignment.recommendedNumbers.maxConcurrentJobs != null) {
    next.maxConcurrentJobs = alignment.recommendedNumbers.maxConcurrentJobs;
  }

  // 3. If applying the provider's natively recommended profile, set mode accordingly
  if (chosenSetupId === alignment.recommendedSetupId) {
    next.agentMode = alignment.recommendedMode;
    if (alignment.recommendedMode === 'plan') {
      next.planModeEnabled = true;
      next.buildModeEnabled = false;
    } else if (alignment.recommendedMode === 'agent') {
      next.planModeEnabled = false;
      next.buildModeEnabled = true;
    } else if (alignment.recommendedMode === 'ask') {
      next.planModeEnabled = false;
      next.buildModeEnabled = false;
    }
  }

  // 4. Apply provider toggle overrides
  if (alignment.toggleOverrides) {
    next = {
      ...next,
      ...alignment.toggleOverrides,
    };
  }

  return next;
}

export interface ProviderAlignmentStatus {
  isAligned: boolean;
  activeProvider: InferenceProvider;
  alignment: ProviderSetupAlignment;
  recommendedSetup: AgentSetupProfile;
  currentSetup: AgentSetupProfile;
  matchScore: number;
  divergentKeys: ToggleKey[];
  divergentNumbers: { key: string; current: number; recommended: number }[];
  summary: string;
}

/** Check whether current settings match the recommended setup & tunings for the active AI API */
export function checkProviderAlignment(
  settings: ClientSettings,
  provider: InferenceProvider,
): ProviderAlignmentStatus {
  const alignment = getProviderSetupAlignment(provider);
  const recommendedSetup =
    AGENT_SETUP_PROFILES.find((p) => p.id === alignment.recommendedSetupId) ??
    AGENT_SETUP_PROFILES[0];
  const activeAnalysis = detectActiveSetup(settings);
  const currentSetup = activeAnalysis.activeSetup;

  const isSetupMatch = currentSetup.id === alignment.recommendedSetupId;
  const divergentNumbers: { key: string; current: number; recommended: number }[] = [];

  if (
    settings.maxAgentTurns != null &&
    settings.maxAgentTurns !== alignment.recommendedNumbers.maxAgentTurns
  ) {
    divergentNumbers.push({
      key: 'maxAgentTurns',
      current: settings.maxAgentTurns,
      recommended: alignment.recommendedNumbers.maxAgentTurns,
    });
  }
  if (
    settings.selfDeepenPasses != null &&
    settings.selfDeepenPasses !== alignment.recommendedNumbers.selfDeepenPasses
  ) {
    divergentNumbers.push({
      key: 'selfDeepenPasses',
      current: settings.selfDeepenPasses,
      recommended: alignment.recommendedNumbers.selfDeepenPasses,
    });
  }

  // Target toggles = base recommended setup toggles merged with provider overrides
  const targetToggles: Record<ToggleKey, boolean> = {
    ...recommendedSetup.recommendedToggles,
    ...(alignment.toggleOverrides ?? {}),
  };

  let matchingToggles = 0;
  const divergentKeys: ToggleKey[] = [];
  for (const key of TRACKED_TOGGLE_KEYS) {
    const current = getSettingToggleValue(settings, key);
    const expected = targetToggles[key];
    if (current === expected) {
      matchingToggles++;
    } else {
      divergentKeys.push(key);
    }
  }

  const matchScore = Math.round((matchingToggles / TRACKED_TOGGLE_KEYS.length) * 100);
  const isAligned =
    isSetupMatch &&
    divergentKeys.length === 0 &&
    divergentNumbers.length === 0;

  let summary = '';
  if (isAligned) {
    summary = `Optimally tuned for ${alignment.name}`;
  } else if (!isSetupMatch) {
    summary = `Active profile is ${currentSetup.name}, but ${alignment.name} performs best with ${recommendedSetup.name}`;
  } else {
    summary = `Configured as ${recommendedSetup.name}, but fine-tuned numbers or overrides diverge from ${alignment.name} recommendations`;
  }

  return {
    isAligned,
    activeProvider: provider,
    alignment,
    recommendedSetup,
    currentSetup,
    matchScore,
    divergentKeys,
    divergentNumbers,
    summary,
  };
}

export type ToggleGuidance = {
  recommendedValue: boolean;
  isAligned: boolean;
  badgeLabel: string;
  tooltip: string;
};

/** Get contextual setup recommendation for a specific toggle switch, with optional provider awareness */
export function getToggleGuidance(
  key: ToggleKey,
  settings: ClientSettings,
  currentSetupId: AgentSetupId,
  provider?: InferenceProvider,
): ToggleGuidance {
  const profile = AGENT_SETUP_PROFILES.find((p) => p.id === currentSetupId) ?? AGENT_SETUP_PROFILES[0];
  let recommendedValue = profile.recommendedToggles[key];

  // If a provider has an explicit override, note that in the recommendation
  const alignment = provider ? getProviderSetupAlignment(provider) : undefined;
  const hasProviderOverride = alignment?.toggleOverrides?.[key] !== undefined;
  if (hasProviderOverride && alignment) {
    recommendedValue = alignment.toggleOverrides![key]!;
  }

  const currentValue = getSettingToggleValue(settings, key);
  const isAligned = currentValue === recommendedValue;

  let badgeLabel = '';
  let tooltip = '';

  if (isAligned) {
    badgeLabel = recommendedValue ? 'Recommended ON' : 'Recommended OFF';
    tooltip = hasProviderOverride && alignment
      ? `Matches the ${alignment.name} optimization (${recommendedValue ? 'ON' : 'OFF'})`
      : `Matches the recommended state for ${profile.name}`;
  } else {
    badgeLabel = hasProviderOverride && alignment
      ? `${alignment.name} recommends ${recommendedValue ? 'ON' : 'OFF'}`
      : `Setup recommends ${recommendedValue ? 'ON' : 'OFF'}`;
    tooltip = hasProviderOverride && alignment
      ? `Differs from the ${alignment.name} API optimization (${recommendedValue ? 'ON' : 'OFF'})`
      : `Differs from the ${profile.name} default (${recommendedValue ? 'ON' : 'OFF'})`;
  }

  return {
    recommendedValue,
    isAligned,
    badgeLabel,
    tooltip,
  };
}
