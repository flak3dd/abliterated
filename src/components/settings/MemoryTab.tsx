import { useEffect, useState } from 'react';
import { Section } from './SettingsShared';
import { ToggleSwitch } from '../ui/ToggleSwitch';
import { bridge } from '../../lib/bridgeClient';
import { getWorkspace } from '../../lib/storage';
import { loadProjectRules, saveProjectRules } from '../../lib/projectRules';
import { getToggleGuidance, type AgentSetupId } from '../../lib/agentPresets';
import { MEMPALACE_CATALOG_ENTRY, withMempalaceMcpServer } from '../../lib/mempalace';
import type { ClientSettings } from '../../types';

export interface MemoryTabProps {
  settings: ClientSettings;
  patch: (partial: Partial<ClientSettings>) => void;
  selectedSetupId: AgentSetupId;
  mpHint: string;
  setMpHint: React.Dispatch<React.SetStateAction<string>>;
  mpBusy: 'which' | 'install' | 'init' | 'status' | null;
  setMpBusy: React.Dispatch<React.SetStateAction<'which' | 'install' | 'init' | 'status' | null>>;
  wsRoot?: string;
}

export function MemoryTab({
  settings,
  patch,
  selectedSetupId,
  mpHint,
  setMpHint,
  mpBusy,
  setMpBusy,
  wsRoot,
}: MemoryTabProps) {
  // Project rules state
  const [rulesText, setRulesText] = useState('');
  const [rulesNote, setRulesNote] = useState('');
  const [rulesBusy, setRulesBusy] = useState(false);
  const pinned = settings.projectRulesPinned !== false;
  const [ws, setWs] = useState(() => getWorkspace().rootPath);

  useEffect(() => {
    const syncWs = () => setWs(getWorkspace().rootPath || bridge.validWorkspaceRoot);
    syncWs();
    const offRoot = bridge.onRootChange(() => syncWs());
    const offStatus = bridge.onStatusChange(() => syncWs());
    return () => {
      offRoot();
      offStatus();
    };
  }, []);

  useEffect(() => {
    const load = () => {
      if (!bridge.connected || !ws) {
        setRulesText('');
        return;
      }
      void loadProjectRules().then(setRulesText);
    };
    load();
    return bridge.onStatusChange(() => load());
  }, [ws]);

  return (
    <div className="space-y-4">
      {/* 1. MemPalace Long-Term Memory */}
      <Section
        title="MemPalace Long-Term Memory"
        hint="Local-first verbatim memory (wings / rooms / drawers). Integrated CLI and tools."
      >
        <div className="grid gap-2">
          <ToggleSwitch
            label="Enable MemPalace long-term memory"
            checked={settings.mempalaceEnabled !== false}
            onChange={(v) =>
              patch({
                mempalaceEnabled: v,
                mcpServers: withMempalaceMcpServer(
                  settings.mcpServers,
                  v,
                  settings.mempalacePalacePath,
                ),
              })
            }
            help="When on, chat/jobs get wake-up context and memory_* tools."
            guidance={getToggleGuidance('mempalaceEnabled', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                mempalaceEnabled: getToggleGuidance('mempalaceEnabled', settings, selectedSetupId).recommendedValue,
              })
            }
          />

          <ToggleSwitch
            label="Auto-recall wake-up context"
            checked={settings.mempalaceAutoRecall !== false}
            onChange={(v) => patch({ mempalaceAutoRecall: v })}
            disabled={settings.mempalaceEnabled === false}
            disabledReason="Requires MemPalace to be enabled above."
            help="Inject L0+L1 wake-up memory into the system prompt when the bridge is connected."
            guidance={getToggleGuidance('mempalaceAutoRecall', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                mempalaceAutoRecall: getToggleGuidance('mempalaceAutoRecall', settings, selectedSetupId).recommendedValue,
              })
            }
          />

          <ToggleSwitch
            label="Auto-save completed sessions"
            checked={settings.mempalaceAutoSave !== false}
            onChange={(v) => patch({ mempalaceAutoSave: v })}
            disabled={settings.mempalaceEnabled === false}
            disabledReason="Requires MemPalace to be enabled above."
            help="After each run, files the last user/assistant turn into the palace (wing = workspace)."
            guidance={getToggleGuidance('mempalaceAutoSave', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                mempalaceAutoSave: getToggleGuidance('mempalaceAutoSave', settings, selectedSetupId).recommendedValue,
              })
            }
          />

          <ToggleSwitch
            label="Self-learning (distill lessons from outcomes)"
            checked={settings.mempalaceSelfLearning !== false}
            onChange={(v) => patch({ mempalaceSelfLearning: v })}
            disabled={settings.mempalaceEnabled === false}
            disabledReason="Requires MemPalace to be enabled above."
            help="After each run, evaluate outcome signals (RunProof, retries, stop reason) and distill structured lessons or anti-patterns into dedicated palace rooms."
            guidance={getToggleGuidance('mempalaceSelfLearning', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                mempalaceSelfLearning: getToggleGuidance('mempalaceSelfLearning', settings, selectedSetupId).recommendedValue,
              })
            }
          />

          <ToggleSwitch
            label="Anti-pattern mining (learn from failures)"
            checked={settings.mempalaceAntiPatternMining !== false}
            onChange={(v) => patch({ mempalaceAntiPatternMining: v })}
            disabled={settings.mempalaceEnabled === false || settings.mempalaceSelfLearning === false}
            disabledReason="Requires Self-Learning to be enabled."
            help="When runs fail or require retries, automatically mine the failure pattern and store it as a 'DO NOT REPEAT' anti-pattern warning in the palace."
            guidance={getToggleGuidance('mempalaceAntiPatternMining', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                mempalaceAntiPatternMining: getToggleGuidance('mempalaceAntiPatternMining', settings, selectedSetupId).recommendedValue,
              })
            }
          />

          <ToggleSwitch
            label="Salience decay (prioritise recent memories)"
            checked={settings.mempalaceSalienceDecay !== false}
            onChange={(v) => patch({ mempalaceSalienceDecay: v })}
            disabled={settings.mempalaceEnabled === false}
            disabledReason="Requires MemPalace to be enabled above."
            help="Apply salience weighting to prioritize recently reinforced memories and naturally deprioritize obsolete ones."
            guidance={getToggleGuidance('mempalaceSalienceDecay', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                mempalaceSalienceDecay: getToggleGuidance('mempalaceSalienceDecay', settings, selectedSetupId).recommendedValue,
              })
            }
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block font-mono text-[10px] uppercase text-muted">
            <span className="font-semibold text-zinc-300">Palace path</span>
            <input
              value={settings.mempalacePalacePath}
              onChange={(e) => patch({ mempalacePalacePath: e.target.value })}
              placeholder="~/.mempalace/palace"
              className="field mt-1 w-full font-mono text-[11px]"
            />
          </label>
          <label className="block font-mono text-[10px] uppercase text-muted">
            <span className="font-semibold text-zinc-300">Wing</span>
            <input
              value={settings.mempalaceWing}
              onChange={(e) => patch({ mempalaceWing: e.target.value })}
              placeholder="workspace folder name"
              className="field mt-1 w-full font-mono text-[11px]"
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-ghost h-7 px-2.5 text-[10px]"
            disabled={mpBusy !== null}
            onClick={() => {
              setMpBusy('which');
              setMpHint('');
              void bridge
                .waitUntilConnected(4000)
                .then((ok) => {
                  if (!ok) throw new Error('Bridge disconnected — npm run bridge');
                  return bridge.mempalaceWhich();
                })
                .then((w) => setMpHint(w.ok ? `CLI: ${w.display}` : w.error || w.text || 'not found'))
                .catch((e) => setMpHint(e instanceof Error ? e.message : String(e)))
                .finally(() => setMpBusy(null));
            }}
          >
            Detect CLI
          </button>
          <button
            type="button"
            className="btn-primary h-7 px-2.5 text-[10px]"
            disabled={mpBusy !== null}
            onClick={() => {
              setMpBusy('install');
              setMpHint('Installing via uv tool install mempalace…');
              void bridge
                .waitUntilConnected(4000)
                .then((ok) => {
                  if (!ok) throw new Error('Bridge disconnected — npm run bridge');
                  return bridge.mempalaceInstall();
                })
                .then((t) => setMpHint(t || 'installed'))
                .catch((e) => setMpHint(e instanceof Error ? e.message : String(e)))
                .finally(() => setMpBusy(null));
            }}
          >
            Install CLI
          </button>
          <button
            type="button"
            className="btn-ghost h-7 px-2.5 text-[10px]"
            disabled={mpBusy !== null}
            onClick={() => {
              setMpBusy('init');
              setMpHint('Initializing palace from workspace…');
              void bridge
                .waitUntilConnected(4000)
                .then((ok) => {
                  if (!ok) throw new Error('Bridge disconnected — npm run bridge');
                  return bridge.mempalaceInit(wsRoot || undefined, {
                    palacePath: settings.mempalacePalacePath,
                  });
                })
                .then((t) => setMpHint(t || 'initialized'))
                .catch((e) => setMpHint(e instanceof Error ? e.message : String(e)))
                .finally(() => setMpBusy(null));
            }}
          >
            Init Workspace
          </button>
          <button
            type="button"
            className="btn-ghost h-7 px-2.5 text-[10px]"
            disabled={mpBusy !== null}
            onClick={() => {
              setMpBusy('status');
              setMpHint('');
              void bridge
                .waitUntilConnected(4000)
                .then((ok) => {
                  if (!ok) throw new Error('Bridge disconnected — npm run bridge');
                  return bridge.mempalaceStatus({
                    palacePath: settings.mempalacePalacePath,
                    wing: settings.mempalaceWing,
                  });
                })
                .then((t) => setMpHint(t || '(empty)'))
                .catch((e) => setMpHint(e instanceof Error ? e.message : String(e)))
                .finally(() => setMpBusy(null));
            }}
          >
            Status
          </button>
          <button
            type="button"
            className="btn-ghost h-7 px-2.5 text-[10px]"
            onClick={() => {
              patch({
                mempalaceEnabled: true,
                mcpServers: withMempalaceMcpServer(
                  settings.mcpServers,
                  true,
                  settings.mempalacePalacePath,
                ),
              });
              setMpHint(
                `Added MCP ${MEMPALACE_CATALOG_ENTRY.command} ${MEMPALACE_CATALOG_ENTRY.args.join(' ')} — Connect it under Tools & MCP.`,
              );
            }}
          >
            Add MCP Server
          </button>
        </div>
        {mpHint ? (
          <pre className="mt-2.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-[3px] border border-zinc-800 bg-zinc-950/80 px-3 py-2 font-mono text-[10px] text-sky-300">
            {mpHint}
          </pre>
        ) : null}
      </Section>

      {/* 2. Repository Steering Rules (.ablit/rules.md) */}
      <Section
        title="Repository Steering Rules (.ablit/rules.md)"
        hint="Always-do list and hard conventions auto-injected into the agent system prompt."
      >
        {!ws ? (
          <div className="rounded-[4px] border border-dashed border-zinc-800 p-4 text-center font-mono text-[11px] text-muted">
            Connect a workspace to configure repo-specific rules.
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              className="field min-h-[160px] font-mono text-[12px] leading-relaxed"
              value={rulesText}
              onChange={(e) => setRulesText(e.target.value)}
              placeholder={'# Repository Rules\n- Always use relative paths inside workspace.\n- Never write placeholder code or stubs.\n- Verify changes with tests before completing turn.\n'}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800/80 pt-2.5">
              <label className="flex items-center gap-2 font-mono text-[11px] text-zinc-300">
                <input
                  type="checkbox"
                  checked={pinned}
                  onChange={(e) => patch({ projectRulesPinned: e.target.checked })}
                  className="rounded border-zinc-700 bg-zinc-900 accent-emerald-500"
                />
                Pin rules into agent steering prompt
              </label>

              <button
                type="button"
                className="btn-primary h-7 px-3 text-[11px]"
                disabled={rulesBusy || !bridge.connected}
                onClick={() => {
                  setRulesBusy(true);
                  setRulesNote('');
                  void saveProjectRules(rulesText)
                    .then(() => setRulesNote('Saved to .ablit/rules.md'))
                    .catch((e) => setRulesNote(e instanceof Error ? e.message : String(e)))
                    .finally(() => setRulesBusy(false));
                }}
              >
                {rulesBusy ? 'Saving…' : 'Save Rules'}
              </button>
            </div>

            {rulesNote ? (
              <p className="font-mono text-[11px] text-emerald-400">{rulesNote}</p>
            ) : null}
          </div>
        )}
      </Section>
    </div>
  );
}
