import { ToggleSwitch } from '../ui/ToggleSwitch';
import type { SettingsTabId } from './SettingsNav';
import type { ClientSettings } from '../../types';
import type { AgentSetupId } from '../../lib/agentPresets';
import { getToggleGuidance } from '../../lib/agentPresets';

interface SearchItem {
  id: string;
  category: SettingsTabId;
  categoryLabel: string;
  title: string;
  description: string;
  type: 'toggle' | 'nav';
  toggleKey?: keyof ClientSettings;
  danger?: boolean;
}

const SEARCHABLE_SETTINGS: SearchItem[] = [
  // Agent & Behavior
  {
    id: 'buildMode',
    category: 'agent',
    categoryLabel: 'Agent & Loops',
    title: 'Build mode (Scaffold -> Build -> Verify)',
    description: 'After reasoning, plan ToDo steps, scaffold structure, then implement. Writes unlocked.',
    type: 'toggle',
    toggleKey: 'buildModeEnabled',
  },
  {
    id: 'planMode',
    category: 'agent',
    categoryLabel: 'Agent & Loops',
    title: 'Plan mode (Read-only specification)',
    description: 'Zero code file writes. Explores and drafts plans without mutation.',
    type: 'toggle',
    toggleKey: 'planModeEnabled',
  },
  {
    id: 'selfDeepen',
    category: 'agent',
    categoryLabel: 'Agent & Loops',
    title: 'Self-deepen answers',
    description: 'Nudge the model to expand thin/missing spots after initial answer.',
    type: 'toggle',
    toggleKey: 'selfDeepenEnabled',
  },
  {
    id: 'deepenCompleteness',
    category: 'agent',
    categoryLabel: 'Agent & Loops',
    title: 'Deepen for completeness (Abliterated-only)',
    description: 'Inject completeness checklist into self-deepen loops.',
    type: 'toggle',
    toggleKey: 'deepenCompleteness',
  },
  {
    id: 'coalesceReasoning',
    category: 'agent',
    categoryLabel: 'Agent & Loops',
    title: 'Use reasoning as answer when content is empty',
    description: 'Promotes R1-style reasoning into main response text when content field is empty.',
    type: 'toggle',
    toggleKey: 'coalesceReasoningToContent',
  },
  {
    id: 'midRunInject',
    category: 'agent',
    categoryLabel: 'Agent & Loops',
    title: 'Mid-run message inject (Barge-in)',
    description: 'Send messages while the agent is busy to steer ongoing work.',
    type: 'toggle',
    toggleKey: 'midRunInjectEnabled',
  },
  {
    id: 'completionFooter',
    category: 'agent',
    categoryLabel: 'Agent & Loops',
    title: 'Completion footer continue chips',
    description: 'Finished answers display three one-click continuation prompts.',
    type: 'toggle',
    toggleKey: 'completionFooterEnabled',
  },
  {
    id: 'maxTurns',
    category: 'agent',
    categoryLabel: 'Agent & Loops',
    title: 'Max agent turns (Turn budget)',
    description: 'Hard stop limit for tool loop turns per invocation (1–50).',
    type: 'nav',
  },
  {
    id: 'maxJobs',
    category: 'agent',
    categoryLabel: 'Agent & Loops',
    title: 'Concurrent background Jobs limit',
    description: 'How many background Jobs can execute in parallel.',
    type: 'nav',
  },
  {
    id: 'verifyStrict',
    category: 'agent',
    categoryLabel: 'Agent & Loops',
    title: 'Verify-strict quality loop profile',
    description: 'Build mode + skills + deepen completeness auto-injected.',
    type: 'toggle',
    toggleKey: 'verifyStrictProfile',
  },
  {
    id: 'postEditDiag',
    category: 'agent',
    categoryLabel: 'Agent & Loops',
    title: 'Post-edit diagnostics & self-healing',
    description: 'Auto-runs typecheck or linter and injects diagnostics for autonomous self-healing.',
    type: 'toggle',
    toggleKey: 'postEditDiagnostics',
  },
  {
    id: 'jobWorktrees',
    category: 'agent',
    categoryLabel: 'Agent & Loops',
    title: 'Job git worktrees (isolated branches)',
    description: 'Jobs create isolated git worktrees under .ablit/worktrees/<jobId>.',
    type: 'toggle',
    toggleKey: 'jobWorktreesEnabled',
  },
  {
    id: 'multiAgent',
    category: 'agent',
    categoryLabel: 'Agent & Loops',
    title: 'Multi-agent fleets (orchestrator + workers)',
    description: 'Orchestrator and worker agents over .ablit/task.json blackboard.',
    type: 'toggle',
    toggleKey: 'multiAgentEnabled',
  },

  // Safety & Machine
  {
    id: 'remoteHost',
    category: 'safety',
    categoryLabel: 'Safety & Machine',
    title: 'Remote host & bridge connection',
    description: 'Allow localhost WebSocket daemon (ws://127.0.0.1:17322) to inspect files, git, processes.',
    type: 'toggle',
    toggleKey: 'remoteHostEnabled',
  },
  {
    id: 'autoAcceptEdits',
    category: 'safety',
    categoryLabel: 'Safety & Machine',
    title: 'Auto-accept file edits',
    description: 'Automatically applies diffs into connected workspace without extra Apply click.',
    type: 'toggle',
    toggleKey: 'autoAcceptEdits',
  },
  {
    id: 'autoRunShell',
    category: 'safety',
    categoryLabel: 'Safety & Machine',
    title: 'Auto-run shell commands',
    description: 'Runs model shell tool calls on localhost daemon without manual Run click.',
    type: 'toggle',
    toggleKey: 'autoRunShell',
    danger: true,
  },
  {
    id: 'pairingCode',
    category: 'safety',
    categoryLabel: 'Safety & Machine',
    title: 'Bridge pairing code',
    description: 'Pairing code used for local bridge daemon authentication.',
    type: 'nav',
  },

  // Memory & Rules
  {
    id: 'mempalace',
    category: 'memory',
    categoryLabel: 'Memory & Rules',
    title: 'MemPalace long-term memory',
    description: 'Local-first verbatim memory (wings / rooms / drawers) with memory_* tools.',
    type: 'toggle',
    toggleKey: 'mempalaceEnabled',
  },
  {
    id: 'mempalaceAutoRecall',
    category: 'memory',
    categoryLabel: 'Memory & Rules',
    title: 'MemPalace auto-recall wake-up context',
    description: 'Inject L0+L1 wake-up memory into the system prompt when the bridge is connected.',
    type: 'toggle',
    toggleKey: 'mempalaceAutoRecall',
  },
  {
    id: 'mempalaceAutoSave',
    category: 'memory',
    categoryLabel: 'Memory & Rules',
    title: 'MemPalace auto-save completed sessions',
    description: 'After each run, files the last user/assistant turn into the palace.',
    type: 'toggle',
    toggleKey: 'mempalaceAutoSave',
  },
  {
    id: 'mempalaceSelfLearning',
    category: 'memory',
    categoryLabel: 'Memory & Rules',
    title: 'MemPalace self-learning (distill lessons from outcomes)',
    description: 'After each run, evaluate outcome signals and distill structured lessons or anti-patterns into dedicated palace rooms.',
    type: 'toggle',
    toggleKey: 'mempalaceSelfLearning',
  },
  {
    id: 'mempalaceAntiPatternMining',
    category: 'memory',
    categoryLabel: 'Memory & Rules',
    title: 'MemPalace anti-pattern mining (learn from failures)',
    description: 'Automatically mine failure patterns and store them as DO NOT REPEAT warnings in the palace.',
    type: 'toggle',
    toggleKey: 'mempalaceAntiPatternMining',
  },
  {
    id: 'mempalaceSalienceDecay',
    category: 'memory',
    categoryLabel: 'Memory & Rules',
    title: 'MemPalace salience decay (prioritise recent memories)',
    description: 'Apply salience weighting to prioritize recently reinforced memories and naturally deprioritize obsolete ones.',
    type: 'toggle',
    toggleKey: 'mempalaceSalienceDecay',
  },
  {
    id: 'projectRules',
    category: 'memory',
    categoryLabel: 'Memory & Rules',
    title: 'Project steering rules (.ablit/rules.md)',
    description: 'Repo steering conventions and always-do instructions pinned into system prompt.',
    type: 'nav',
  },

  // Tools & MCP
  {
    id: 'webSearch',
    category: 'tools',
    categoryLabel: 'Tools, MCP & Skills',
    title: 'Web search configuration (Brave Search / SearXNG)',
    description: 'Configure Brave Search API key or custom SearXNG instance URL.',
    type: 'nav',
  },
  {
    id: 'mcpServers',
    category: 'tools',
    categoryLabel: 'Tools, MCP & Skills',
    title: 'MCP Servers catalog & configuration',
    description: 'Manage Model Context Protocol servers (Filesystem, Brave, GitHub, Postgres, custom stdio).',
    type: 'nav',
  },
  {
    id: 'skills',
    category: 'tools',
    categoryLabel: 'Tools, MCP & Skills',
    title: 'Custom Skills & SKILL.md recipes',
    description: 'Discover and inject bundled, user, and workspace skill recipes.',
    type: 'toggle',
    toggleKey: 'skillsEnabled',
  },

  // Billing & License
  {
    id: 'licenseKey',
    category: 'billing',
    categoryLabel: 'Billing & License',
    title: 'License Key (ABLIT-*) & activation',
    description: 'Activate Pro or Admin license key to unlock unlimited features.',
    type: 'nav',
  },
  {
    id: 'tokenWallet',
    category: 'billing',
    categoryLabel: 'Billing & License',
    title: 'Built-in token wallet & usage meter',
    description: 'Included and prepaid token wallet for abliterated models.',
    type: 'nav',
  },
  {
    id: 'stripeBilling',
    category: 'billing',
    categoryLabel: 'Billing & License',
    title: 'Card billing & subscriptions (Stripe)',
    description: 'Subscribe to Starter, Pro, or Team monthly/yearly plans with card.',
    type: 'nav',
  },
  {
    id: 'solanaBilling',
    category: 'billing',
    categoryLabel: 'Billing & License',
    title: 'Solana USDC plan checkout',
    description: 'Pay for subscriptions using Solana USDC with direct wallet link.',
    type: 'nav',
  },
  {
    id: 'cryptoCredits',
    category: 'billing',
    categoryLabel: 'Billing & License',
    title: 'Prepaid crypto credit packs',
    description: 'Buy 5M, 20M, or 50M model credit packs with Solana, Ethereum, Bitcoin, or TRON.',
    type: 'nav',
  },

  // Account & Identity
  {
    id: 'accountProfile',
    category: 'account',
    categoryLabel: 'Account & Identity',
    title: 'Account Profile & Status',
    description: 'View active profile, email address, loginId, and device binding.',
    type: 'nav',
  },
  {
    id: 'accountLogin',
    category: 'account',
    categoryLabel: 'Account & Identity',
    title: 'Sign In / Sign Up',
    description: 'Log in or create an abliterated account with email and password.',
    type: 'nav',
  },

  // System
  {
    id: 'desktopUpdates',
    category: 'system',
    categoryLabel: 'System & Danger Zone',
    title: 'Desktop app updates',
    description: 'Check GitHub releases for 1.0.2-beta and newer Electron desktop versions.',
    type: 'nav',
  },
  {
    id: 'docs',
    category: 'system',
    categoryLabel: 'System & Danger Zone',
    title: 'Application documentation & guides',
    description: 'In-app Vite guides and product specifications (/docs/).',
    type: 'nav',
  },
  {
    id: 'dangerZone',
    category: 'system',
    categoryLabel: 'System & Danger Zone',
    title: 'Danger Zone (Wipe local data)',
    description: 'Reset settings, chat threads, messages, and jobs from browser localStorage.',
    type: 'nav',
  },
];

interface SearchResultsProps {
  query: string;
  settings: ClientSettings;
  patch: (partial: Partial<ClientSettings>) => void;
  selectedSetupId: AgentSetupId;
  onNavigateToTab: (tab: SettingsTabId) => void;
}

export function SettingsSearchResults({
  query,
  settings,
  patch,
  selectedSetupId,
  onNavigateToTab,
}: SearchResultsProps) {
  const q = query.trim().toLowerCase();
  const matches = SEARCHABLE_SETTINGS.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.categoryLabel.toLowerCase().includes(q),
  );

  if (matches.length === 0) {
    return (
      <div className="rounded-[4px] border border-dashed border-zinc-800 p-8 text-center">
        <div className="text-2xl">🔍</div>
        <div className="mt-2 font-mono text-sm font-semibold text-zinc-300">
          No settings found matching "{query}"
        </div>
        <p className="mt-1 font-mono text-[11px] text-muted">
          Try searching for keywords like <code className="text-zinc-400">shell</code>, <code className="text-zinc-400">mcp</code>, <code className="text-zinc-400">license</code>, <code className="text-zinc-400">memory</code>, or <code className="text-zinc-400">tokens</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-zinc-400">
          Found <strong className="text-zinc-200">{matches.length}</strong> matching setting{matches.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="space-y-2">
        {matches.map((item) => {
          if (item.type === 'toggle' && item.toggleKey) {
            const key = item.toggleKey;
            const val = Boolean(settings[key]);
            const guidance = getToggleGuidance(key as any, settings, selectedSetupId);
            return (
              <div key={item.id} className="relative">
                <div className="mb-1 flex items-center justify-between">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.2 font-mono text-[9px] uppercase tracking-wider text-zinc-400">
                    {item.categoryLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigateToTab(item.category)}
                    className="font-mono text-[10px] text-sky-400 hover:text-sky-300"
                  >
                    View in {item.categoryLabel} →
                  </button>
                </div>
                <ToggleSwitch
                  label={item.title}
                  help={item.description}
                  checked={val}
                  onChange={(v) => patch({ [key]: v } as any)}
                  danger={item.danger}
                  guidance={guidance}
                  onAlign={() => patch({ [key]: guidance.recommendedValue } as any)}
                />
              </div>
            );
          }

          return (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[3px] border border-zinc-800 bg-zinc-950/60 p-3 hover:border-zinc-700"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.2 font-mono text-[9px] uppercase tracking-wider text-zinc-400">
                    {item.categoryLabel}
                  </span>
                  <span className="font-mono text-[12px] font-bold text-zinc-200">{item.title}</span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-zinc-400">{item.description}</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateToTab(item.category)}
                className="btn-ghost h-7 px-3 font-mono text-[11px] text-sky-300"
              >
                Go to Setting →
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
