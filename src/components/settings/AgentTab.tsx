import { useState } from 'react';
import { Section, FieldLabel } from './SettingsShared';
import { ToggleSwitch } from '../ui/ToggleSwitch';
import {
  AGENT_SETUP_PROFILES,
  getToggleGuidance,
  type AgentSetupId,
  type detectActiveSetup,
  type checkProviderAlignment,
} from '../../lib/agentPresets';
import type { resolveActiveSettings } from '../../lib/activeEndpoint';
import type { ClientSettings, InferenceProvider } from '../../types';
import type { LicenseState } from '../../lib/license';

interface AgentTabProps {
  settings: ClientSettings;
  patch: (partial: Partial<ClientSettings>) => void;
  license: LicenseState;
  selectedSetupId: AgentSetupId;
  onSelectSetup: (id: AgentSetupId) => void;
  setupAnalysis: ReturnType<typeof detectActiveSetup>;
  toast: string;
  activeProvider: InferenceProvider;
  providerStatus: ReturnType<typeof checkProviderAlignment>;
  onAlignToProvider: (provider: InferenceProvider) => void;
  activeEndpoint: ReturnType<typeof resolveActiveSettings>;
}

export function AgentTab({
  settings,
  patch,
  license,
  selectedSetupId,
  onSelectSetup,
  setupAnalysis,
  toast,
  activeProvider,
  providerStatus,
  onAlignToProvider,
  activeEndpoint,
}: AgentTabProps) {
  const [showTips, setShowTips] = useState(false);
  const activeProfile = setupAnalysis.activeSetup;
  const alignment = providerStatus.alignment;
  const planModeOn = settings.planModeEnabled === true;
  const buildModeOn = settings.buildModeEnabled !== false && !planModeOn;

  const providerIcon =
    activeProvider === 'dgx-spark'
      ? '⚡'
      : activeProvider === 'featherless'
      ? '🪶'
      : activeProvider === 'platform'
      ? '🏛️'
      : activeProvider === 'custom'
      ? '🔌'
      : '🔮';

  return (
    <div className="space-y-4">
      {/* 0. Master Agent Invariant Protection Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-emerald-500/40 bg-emerald-950/20 px-4 py-2.5 font-mono text-[11px] shadow-sm backdrop-blur">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-[1px] bg-emerald-400 animate-pulse" />
          <span className="font-bold text-emerald-200">AI Agent Runtime Invariants Active</span>
          <span className="text-zinc-500">·</span>
          <span className="text-zinc-300">Protected against invalid configs, dead endpoints & tool starvation</span>
        </div>
        <span className="rounded-[2px] border border-emerald-600/50 bg-emerald-900/40 px-2 py-0.5 text-[10px] font-bold text-emerald-300 uppercase tracking-wider">
          Auto-Healing ON
        </span>
      </div>

      {/* 1. Setup & Workflow Profiles Selector */}
      <div className="rounded-[4px] border border-zinc-800/90 bg-zinc-950/80 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base">⚡</span>
              <span className="font-mono text-[13px] font-bold tracking-tight text-white">
                Agent Setup & Workflow Profiles
              </span>
            </div>
            <p className="mt-0.5 font-mono text-[11px] text-zinc-400">
              Select an operational profile to automatically configure switches, or customize below.
            </p>
          </div>

          {/* Live Match Badge */}
          <div className="flex items-center gap-2">
            {setupAnalysis.isExactMatch ? (
              <span className="inline-flex items-center gap-1.5 rounded-[3px] border border-emerald-800/70 bg-emerald-950/60 px-2.5 py-1 font-mono text-[11px] font-semibold text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-[1px] bg-emerald-400 animate-pulse" />
                {activeProfile.name} (100% Aligned)
              </span>
            ) : (
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-[3px] border border-amber-800/70 bg-amber-950/60 px-2.5 py-1 font-mono text-[11px] font-semibold text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-[1px] bg-amber-400" />
                  {activeProfile.name} ({setupAnalysis.matchScore}% · {setupAnalysis.divergentCount} Divergent)
                </span>
                <button
                  type="button"
                  onClick={() => onSelectSetup(selectedSetupId)}
                  className="rounded-[2px] border border-amber-600/50 bg-amber-500/15 px-2.5 py-1 font-mono text-[10px] font-bold text-amber-200 transition-colors hover:bg-amber-500/25 hover:text-white"
                  title={`Reset all toggles to the official ${activeProfile.name} defaults`}
                >
                  Re-align All
                </button>
              </div>
            )}
          </div>
        </div>

        {/* AI Agent API Alignment Bar */}
        <div className="mt-3 overflow-hidden rounded-[4px] border border-zinc-800/90 bg-zinc-950 p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] border border-zinc-700/80 bg-zinc-900 shadow-inner">
                <span className="text-lg">{providerIcon}</span>
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[12px] font-bold tracking-tight text-white">
                    {alignment.name}
                  </span>
                  <span className="rounded-[2px] border border-zinc-700/80 bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-zinc-300">
                    {alignment.badge}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-400">
                    · {activeEndpoint.label} · {alignment.hardwareProfile}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-400">
                  {alignment.tagline}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {providerStatus.isAligned ? (
                <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-emerald-500/60 bg-emerald-950/70 px-2.5 py-1 font-mono text-[11px] font-bold text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-[1px] bg-emerald-400 animate-pulse" />
                  ✓ Optimal for {alignment.name}
                </span>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-[2px] border border-amber-600/60 bg-amber-950/70 px-2 py-1 font-mono text-[10px] font-bold text-amber-300">
                    <span className="h-1.5 w-1.5 rounded-[1px] bg-amber-400" />
                    API Divergent ({providerStatus.matchScore}%)
                  </span>
                  <button
                    type="button"
                    onClick={() => onAlignToProvider(activeProvider)}
                    className="inline-flex items-center gap-1.5 rounded-[3px] border border-emerald-500/60 bg-emerald-950/80 px-3 py-1 font-mono text-[11px] font-bold text-emerald-300 hover:bg-emerald-900/60 transition-colors"
                    title={`Align toggles, agent mode, and turn limits to official ${alignment.name} profile`}
                  >
                    <span>⚡</span>
                    <span>Optimize for {alignment.name}</span>
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowTips((prev) => !prev)}
                className="rounded border border-zinc-700/60 bg-zinc-800/60 px-2 py-1 font-mono text-[10px] text-zinc-400 hover:text-zinc-200"
                title="Toggle API tuning tips"
              >
                {showTips ? 'Hide Tips' : 'Tuning Tips'}
              </button>
            </div>
          </div>

          {/* Spec & Economics Line */}
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-800/80 pt-2 font-mono text-[10px] text-zinc-400">
            <span className="text-zinc-500 font-semibold uppercase tracking-wider">Economics:</span>
            <span className="text-zinc-300">{alignment.tokenEconomics}</span>
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-500 font-semibold uppercase tracking-wider">Optimal Profile:</span>
            <span className="text-emerald-400 font-semibold">{providerStatus.recommendedSetup.name}</span>
            <span className="text-zinc-400">({alignment.recommendedMode} mode)</span>
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-500 font-semibold uppercase tracking-wider">Turn Budget:</span>
            <span className="text-zinc-300">{alignment.recommendedNumbers.maxAgentTurns} turns · {alignment.recommendedNumbers.selfDeepenPasses} passes</span>
          </div>

          {showTips ? (
            <div className="mt-2.5 rounded-lg border border-zinc-800 bg-zinc-950/80 p-2.5 animate-in fade-in duration-150">
              <div className="font-mono text-[10px] font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                💡 {alignment.name} Pro-Tips:
              </div>
              <ul className="grid gap-1 font-mono text-[10px] text-zinc-400">
                {alignment.tips.map((tip, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-emerald-400">•</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {toast ? (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-emerald-700/60 bg-emerald-950/80 px-3 py-1.5 font-mono text-[11px] text-emerald-200 animate-in fade-in duration-150">
            <span>✓</span>
            <span>{toast}</span>
          </div>
        ) : null}

        {/* Setup Profile Cards */}
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          {AGENT_SETUP_PROFILES.map((p) => {
            const isSelected = p.id === activeProfile.id;
            const isExact = isSelected && setupAnalysis.isExactMatch;
            const isOptimalForActiveApi = p.id === alignment.recommendedSetupId;

            return (
              <div
                key={p.id}
                onClick={() => onSelectSetup(p.id)}
                className={`group relative flex cursor-pointer flex-col justify-between rounded-[3px] border p-3 transition-all duration-200 ${
                  isOptimalForActiveApi && isSelected
                    ? 'border-emerald-500/80 bg-emerald-950/30 ring-1 ring-emerald-500/50'
                    : isSelected
                    ? 'border-emerald-500/70 bg-emerald-950/25 ring-1 ring-emerald-500/40'
                    : isOptimalForActiveApi
                    ? 'border-emerald-800/60 bg-zinc-900/50 hover:border-emerald-600/70 hover:bg-zinc-900/80'
                    : 'border-zinc-800/80 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-900/80'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xl">{p.icon}</span>
                    <div className="flex items-center gap-1">
                      {isOptimalForActiveApi ? (
                        <span className="rounded-[2px] bg-emerald-500/20 border border-emerald-500/50 px-1.5 py-0.2 font-mono text-[8px] font-bold text-emerald-300 uppercase tracking-wider">
                          ★ Optimal
                        </span>
                      ) : null}
                      <span
                        className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${
                          isSelected
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-zinc-800/90 text-zinc-400 border border-zinc-700/60'
                        }`}
                      >
                        {p.badge}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 font-mono text-[12px] font-bold text-white group-hover:text-emerald-300 transition-colors">
                    {p.name}
                  </div>

                  <p className="mt-1 font-mono text-[10px] leading-snug text-zinc-400 line-clamp-2">
                    {p.tagline}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <span className="rounded border border-zinc-700/60 bg-zinc-800/80 px-1 py-0.2 font-mono text-[8.5px] font-semibold text-zinc-300 uppercase">
                      {p.recommendedAgentMode}
                    </span>
                    {p.preferredProviders.map((prov) => (
                      <span
                        key={prov}
                        className={`rounded border px-1 py-0.2 font-mono text-[8.5px] ${
                          prov === activeProvider
                            ? 'border-emerald-500/60 bg-emerald-950/60 text-emerald-300 font-bold'
                            : 'border-zinc-800 bg-zinc-900/60 text-zinc-500'
                        }`}
                      >
                        {prov === 'dgx-spark' ? 'Spark' : prov === 'featherless' ? 'Feather' : prov === 'platform' ? 'Platform' : prov === 'abliteration' ? 'Cluster' : 'Custom'}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-zinc-800/60">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectSetup(p.id);
                    }}
                    className={`w-full py-1 text-center font-mono text-[10px] font-bold rounded transition-colors ${
                      isExact
                        ? 'bg-emerald-600 text-white shadow-[0_0_10px_rgba(16,185,129,0.4)]'
                        : isSelected
                          ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30'
                          : isOptimalForActiveApi
                          ? 'bg-emerald-900/40 text-emerald-200 border border-emerald-600/50 hover:bg-emerald-800/50'
                          : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                    }`}
                  >
                    {isExact ? '✓ Active' : isSelected ? '● Active (Custom)' : isOptimalForActiveApi ? 'Apply Optimal' : 'Apply Setup'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Divergent Toggles Alert (if any) */}
      {setupAnalysis.divergentCount > 0 ? (
        <div className="rounded-[4px] border border-amber-800/60 bg-amber-950/20 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-amber-400">⚠️</span>
              <span className="font-mono text-[12px] font-bold text-amber-200">
                {setupAnalysis.divergentCount} switch{setupAnalysis.divergentCount === 1 ? '' : 'es'} customized away from {setupAnalysis.activeSetup.name}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onSelectSetup(setupAnalysis.activeSetup.id)}
              className="btn-primary h-7 px-3 font-mono text-[11px]"
            >
              Re-align All to {setupAnalysis.activeSetup.name}
            </button>
          </div>
        </div>
      ) : null}

      {/* 3. Core Workflow & Execution Switches */}
      <Section
        title="Agent Workflow & Execution"
        hint="Turn budget, execution protocols, deepen loops, and reasoning behavior."
      >
        <div className="grid gap-2.5">
          <ToggleSwitch
            label="Build mode (Scaffold -> Build -> Verify)"
            help="After reasoning, maps ToDo steps, scaffolds required structure first, then implements. Write tools are unlocked."
            checked={buildModeOn}
            onChange={(v) => {
              patch({
                buildModeEnabled: v,
                planModeEnabled: v ? false : settings.planModeEnabled,
              });
            }}
            disabled={planModeOn}
            disabledReason="Disabled while Plan mode is active. Plan mode is strictly read-only."
            guidance={getToggleGuidance('buildModeEnabled', settings, selectedSetupId)}
            onAlign={() => {
              patch({
                buildModeEnabled: true,
                planModeEnabled: false,
              });
            }}
          />

          <ToggleSwitch
            label="Plan mode (Read-only specification)"
            help="Zero code writes or terminal mutations. The agent audits and drafts plans. Operator approval required to unlock writes."
            checked={planModeOn}
            onChange={(v) => {
              patch({
                planModeEnabled: v,
                buildModeEnabled: v ? false : true,
              });
            }}
            guidance={getToggleGuidance('planModeEnabled', settings, selectedSetupId)}
            onAlign={() => {
              const rec = getToggleGuidance('planModeEnabled', settings, selectedSetupId).recommendedValue;
              patch({
                planModeEnabled: rec,
                buildModeEnabled: rec ? false : true,
              });
            }}
          />

          <ToggleSwitch
            label="Self-deepen answers"
            checked={settings.selfDeepenEnabled !== false}
            onChange={(v) => patch({ selfDeepenEnabled: v })}
            help="After a text answer, nudge the model to expand thin spots. Stops early on [ANSWER_COMPLETE]."
            guidance={getToggleGuidance('selfDeepenEnabled', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                selfDeepenEnabled: getToggleGuidance('selfDeepenEnabled', settings, selectedSetupId).recommendedValue,
              })
            }
          />

          <ToggleSwitch
            label="Deepen for completeness (Abliterated-only)"
            checked={settings.deepenCompleteness !== false}
            onChange={(v) => patch({ deepenCompleteness: v })}
            disabled={settings.selfDeepenEnabled === false}
            disabledReason="Requires 'Self-deepen answers' to be enabled above."
            help="Injects the comprehensive completeness checklist into deepen passes."
            guidance={getToggleGuidance('deepenCompleteness', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                deepenCompleteness: getToggleGuidance('deepenCompleteness', settings, selectedSetupId).recommendedValue,
              })
            }
          />

          <ToggleSwitch
            label="Use reasoning as answer when content is empty"
            checked={settings.coalesceReasoningToContent !== false}
            onChange={(v) => patch({ coalesceReasoningToContent: v })}
            help="R1-style models sometimes fill reasoning only. Promote that text into the main answer locally — zero extra API costs."
            guidance={getToggleGuidance('coalesceReasoningToContent', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                coalesceReasoningToContent: getToggleGuidance('coalesceReasoningToContent', settings, selectedSetupId).recommendedValue,
              })
            }
          />

          <ToggleSwitch
            label="Mid-run message inject (Barge-in)"
            checked={settings.midRunInjectEnabled !== false}
            onChange={(v) => patch({ midRunInjectEnabled: v })}
            help="Send messages while the agent is busy. It finishes the current step, then integrates your instruction."
            guidance={getToggleGuidance('midRunInjectEnabled', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                midRunInjectEnabled: getToggleGuidance('midRunInjectEnabled', settings, selectedSetupId).recommendedValue,
              })
            }
          />

          <ToggleSwitch
            label="Completion footer continue chips"
            checked={settings.completionFooterEnabled !== false}
            onChange={(v) => patch({ completionFooterEnabled: v })}
            help="Finished answers display three one-click continuation prompts."
            guidance={getToggleGuidance('completionFooterEnabled', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                completionFooterEnabled: getToggleGuidance('completionFooterEnabled', settings, selectedSetupId).recommendedValue,
              })
            }
          />
        </div>

        {/* Numerical limits */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 border-t border-zinc-800/80 pt-3">
          <FieldLabel label="Max agent turns (4–50)" hint="Hard stop for tool loops (min 4 ensures complete inspect-act-verify loop).">
            <input
              type="number"
              min={4}
              max={50}
              value={settings.maxAgentTurns ?? 24}
              onChange={(e) => {
                const n = Number(e.target.value);
                const clamped = Number.isFinite(n) ? Math.min(50, Math.max(4, Math.floor(n))) : 24;
                patch({ maxAgentTurns: clamped });
              }}
              onBlur={() => {
                if (!settings.maxAgentTurns || settings.maxAgentTurns < 4) {
                  patch({ maxAgentTurns: 24 });
                }
              }}
              className="field field-num w-full"
            />
          </FieldLabel>

          <FieldLabel
            label={`Max concurrent Jobs (1–${Number.isFinite(license.features.maxConcurrentJobs) ? license.features.maxConcurrentJobs : 4})`}
            hint={license.isFree ? 'Free tier: 1 job. Pro: up to 4. Admin: up to 16.' : 'Parallel background Jobs limit.'}
          >
            <input
              type="number"
              min={1}
              max={Number.isFinite(license.features.maxConcurrentJobs) ? license.features.maxConcurrentJobs : 16}
              value={Math.min(
                settings.maxConcurrentJobs ?? 1,
                Number.isFinite(license.features.maxConcurrentJobs) ? license.features.maxConcurrentJobs : 16,
              )}
              onChange={(e) => {
                const n = Number(e.target.value);
                const max = Number.isFinite(license.features.maxConcurrentJobs) ? license.features.maxConcurrentJobs : 4;
                const clamped = Number.isFinite(n) ? Math.min(max, Math.max(1, Math.floor(n))) : 1;
                patch({ maxConcurrentJobs: clamped });
              }}
              className="field field-num w-full"
            />
          </FieldLabel>

          <FieldLabel label="Self-deepen passes (0–5)" hint="0 disables deepen even if toggle is ON.">
            <input
              type="number"
              min={0}
              max={5}
              disabled={settings.selfDeepenEnabled === false}
              value={settings.selfDeepenEnabled === false ? 0 : settings.selfDeepenPasses ?? 2}
              onChange={(e) => {
                const n = Number(e.target.value);
                const clamped = Number.isFinite(n) ? Math.min(5, Math.max(0, Math.floor(n))) : 2;
                patch({ selfDeepenPasses: clamped });
              }}
              className="field field-num w-full"
            />
          </FieldLabel>
        </div>
      </Section>

      {/* 4. Advanced & Fleet Orchestration */}
      <Section
        title="Advanced & Fleet Orchestration (Experimental)"
        hint="Strict quality loops, isolated branch worktrees, and multi-agent teams."
      >
        <div className="grid gap-2.5">
          <ToggleSwitch
            label="Verify-strict quality loop profile"
            checked={settings.verifyStrictProfile === true}
            onChange={(v) =>
              patch(
                v
                  ? {
                      ...settings,
                      verifyStrictProfile: true,
                      buildModeEnabled: true,
                      skillsEnabled: true,
                      deepenCompleteness: true,
                      selfDeepenEnabled: true,
                      planModeEnabled: false,
                    }
                  : { verifyStrictProfile: false },
              )
            }
            help="Preset: Build mode + skills + deepen completeness. Auto-injects verify-strict skill on Build/Jobs and Chat."
            guidance={getToggleGuidance('verifyStrictProfile', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                verifyStrictProfile: getToggleGuidance('verifyStrictProfile', settings, selectedSetupId, activeProvider).recommendedValue,
              })
            }
          />

          <ToggleSwitch
            label="Post-edit diagnostics & self-healing"
            checked={settings.postEditDiagnostics === true}
            onChange={(v) => patch({ postEditDiagnostics: v })}
            help="Runs typecheck (tsc -b) or linter after code writes and injects error messages for autonomous self-healing."
            guidance={getToggleGuidance('postEditDiagnostics', settings, selectedSetupId, activeProvider)}
            onAlign={() =>
              patch({
                postEditDiagnostics: getToggleGuidance('postEditDiagnostics', settings, selectedSetupId, activeProvider).recommendedValue,
              })
            }
          />

          <ToggleSwitch
            label="Job git worktrees (isolated branch environments)"
            checked={settings.jobWorktreesEnabled === true}
            onChange={(v) => patch({ jobWorktreesEnabled: v })}
            help="When on, Jobs create a real git worktree under .ablit/worktrees/<jobId> and scope the bridge to that isolated tree."
            guidance={getToggleGuidance('jobWorktreesEnabled', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                jobWorktreesEnabled: getToggleGuidance('jobWorktreesEnabled', settings, selectedSetupId).recommendedValue,
              })
            }
          />

          <ToggleSwitch
            label="Multi-agent fleets (orchestrator + workers)"
            checked={settings.multiAgentEnabled === true}
            onChange={(v) => patch({ multiAgentEnabled: v })}
            help="Orchestrator + coder/tester/verifier over .ablit/task.json blackboard."
            guidance={getToggleGuidance('multiAgentEnabled', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                multiAgentEnabled: getToggleGuidance('multiAgentEnabled', settings, selectedSetupId).recommendedValue,
              })
            }
          />
        </div>
      </Section>
    </div>
  );
}
