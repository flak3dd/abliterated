import type { ClientSettings } from '../types';

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

/** Apply all recommended toggles and numbers for a chosen agent setup */
export function applyAgentSetup(settings: ClientSettings, setupId: AgentSetupId): ClientSettings {
  const profile = AGENT_SETUP_PROFILES.find((p) => p.id === setupId) ?? AGENT_SETUP_PROFILES[0];
  const next: ClientSettings = {
    ...settings,
    ...profile.recommendedToggles,
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

export type ToggleGuidance = {
  recommendedValue: boolean;
  isAligned: boolean;
  badgeLabel: string;
  tooltip: string;
};

/** Get contextual setup recommendation for a specific toggle switch */
export function getToggleGuidance(
  key: ToggleKey,
  settings: ClientSettings,
  currentSetupId: AgentSetupId,
): ToggleGuidance {
  const profile = AGENT_SETUP_PROFILES.find((p) => p.id === currentSetupId) ?? AGENT_SETUP_PROFILES[0];
  const recommendedValue = profile.recommendedToggles[key];
  const currentValue = getSettingToggleValue(settings, key);
  const isAligned = currentValue === recommendedValue;

  let badgeLabel = '';
  let tooltip = '';

  if (isAligned) {
    badgeLabel = recommendedValue ? 'Recommended ON' : 'Recommended OFF';
    tooltip = `Matches the recommended state for ${profile.name}`;
  } else {
    badgeLabel = recommendedValue ? 'Setup recommends ON' : 'Setup recommends OFF';
    tooltip = `Differs from the ${profile.name} default (${recommendedValue ? 'ON' : 'OFF'})`;
  }

  return {
    recommendedValue,
    isAligned,
    badgeLabel,
    tooltip,
  };
}
