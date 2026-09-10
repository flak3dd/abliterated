import type { LicenseState } from '../../lib/license';

export type SettingsTabId =
  | 'agent'
  | 'safety'
  | 'memory'
  | 'tools'
  | 'billing'
  | 'account'
  | 'system';

export interface SettingsTabItem {
  id: SettingsTabId;
  label: string;
  description: string;
  icon: string;
  badge?: string | number;
  badgeColor?: string;
}

interface SettingsNavProps {
  currentTab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  license: LicenseState;
  enabledMcpCount: number;
  divergentCount: number;
  bridgeConnected: boolean;
}

export function getSettingsTabs(
  license: LicenseState,
  enabledMcpCount: number,
  divergentCount: number,
  bridgeConnected: boolean,
): SettingsTabItem[] {
  return [
    {
      id: 'agent',
      label: 'Agent & Loops',
      description: 'Profiles, build/plan modes, turn budgets, and model tuning',
      icon: '🤖',
      badge: divergentCount > 0 ? `${divergentCount} custom` : undefined,
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    },
    {
      id: 'safety',
      label: 'Safety & Machine',
      description: 'Host permissions, auto-accept diffs, shell execution, pairing',
      icon: '🛡️',
      badge: bridgeConnected ? 'Bridge OK' : 'Offline',
      badgeColor: bridgeConnected
        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
        : 'bg-zinc-800 text-zinc-400 border-zinc-700',
    },
    {
      id: 'memory',
      label: 'Memory & Rules',
      description: 'MemPalace, workspace context, and repository steering rules',
      icon: '🧠',
    },
    {
      id: 'tools',
      label: 'Tools, MCP & Skills',
      description: 'Web search, Model Context Protocol servers, and skills',
      icon: '🔌',
      badge: enabledMcpCount > 0 ? `${enabledMcpCount} MCP` : undefined,
      badgeColor: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    },
    {
      id: 'billing',
      label: 'Billing & License',
      description: 'Token wallet, license key, Stripe subscriptions, crypto credits',
      icon: '💳',
      badge: license.label,
      badgeColor: license.isFree
        ? 'bg-zinc-800 text-zinc-300 border-zinc-700'
        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    },
    {
      id: 'account',
      label: 'Account & Identity',
      description: 'Account profile, email login, and device binding',
      icon: '👤',
    },
    {
      id: 'system',
      label: 'System & Danger Zone',
      description: 'Desktop updates, documentation, cache, and reset',
      icon: '⚙️',
    },
  ];
}

export function SettingsHeader({
  searchQuery,
  onSearchChange,
  license,
}: {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  license: LicenseState;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="font-mono text-xl font-bold tracking-tight text-white">Settings</h1>
          <span
            className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
              license.tier === 'admin'
                ? 'border-purple-500/60 bg-purple-950/40 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.2)]'
                : license.tier === 'pro'
                ? 'border-sky-500/60 bg-sky-950/40 text-sky-300 shadow-[0_0_12px_rgba(14,165,233,0.2)]'
                : 'border-zinc-700 bg-zinc-900 text-zinc-400'
            }`}
          >
            {license.label}
          </span>
        </div>
        <p className="mt-0.5 font-mono text-[11px] text-zinc-400">
          Agent workflows, security controls, integrations, and preferences.
        </p>
      </div>

      {/* Universal Search Box */}
      <div className="relative w-full sm:w-80">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-zinc-500">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search settings (e.g. shell, mcp, license)..."
          className="field h-8 w-full pl-8 pr-7 font-mono text-[11px]"
        />
        {searchQuery ? (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-zinc-400 hover:text-zinc-200"
            title="Clear search"
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsNavSidebar({
  currentTab,
  onTabChange,
  tabs,
}: {
  currentTab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
  tabs: SettingsTabItem[];
}) {
  return (
    <nav className="flex flex-row md:flex-col gap-1.5 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0">
      {tabs.map((tab) => {
        const isActive = currentTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={`group flex items-center justify-between rounded-xl px-3 py-2 text-left font-mono transition-all shrink-0 md:shrink ${
              isActive
                ? 'bg-zinc-100 font-bold text-zinc-950 shadow-md ring-1 ring-white/50'
                : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200 border border-zinc-800/60'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-base shrink-0">{tab.icon}</span>
              <div className="min-w-0">
                <div className="text-[12px] truncate">{tab.label}</div>
                <div
                  className={`text-[9.5px] truncate hidden md:block ${
                    isActive ? 'text-zinc-700 font-normal' : 'text-zinc-400'
                  }`}
                >
                  {tab.description}
                </div>
              </div>
            </div>

            {tab.badge ? (
              <span
                className={`ml-2 shrink-0 rounded-full border px-1.5 py-0.2 font-mono text-[9px] font-semibold transition-colors ${
                  isActive
                    ? 'border-zinc-400 bg-zinc-200 text-zinc-900'
                    : tab.badgeColor || 'border-zinc-700 bg-zinc-800 text-zinc-400'
                }`}
              >
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

export function SettingsNav({
  currentTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  license,
  enabledMcpCount,
  divergentCount,
  bridgeConnected,
}: SettingsNavProps) {
  const tabs = getSettingsTabs(license, enabledMcpCount, divergentCount, bridgeConnected);
  return (
    <div className="space-y-4">
      <SettingsHeader
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        license={license}
      />
      <SettingsNavSidebar
        currentTab={currentTab}
        onTabChange={onTabChange}
        tabs={tabs}
      />
    </div>
  );
}

