import { Section } from './SettingsShared';
import { ToggleSwitch } from '../ui/ToggleSwitch';
import { getToggleGuidance, type AgentSetupId } from '../../lib/agentPresets';
import { generatePairingCode } from '../../lib/storage';
import type { ClientSettings } from '../../types';

interface SafetyTabProps {
  settings: ClientSettings;
  patch: (partial: Partial<ClientSettings>) => void;
  selectedSetupId: AgentSetupId;
}

export function SafetyTab({ settings, patch, selectedSetupId }: SafetyTabProps) {
  const planModeOn = settings.planModeEnabled === true;

  return (
    <div className="space-y-4">
      {/* 1. Machine Permissions */}
      <Section
        title="Safety & Machine Permissions"
        hint="What the agent may write, execute, or access on your local machine."
      >
        <div className="grid gap-2.5">
          <ToggleSwitch
            label="Remote host & bridge connection (Agent Core)"
            checked={settings.remoteHostEnabled !== false}
            onChange={(v) => {
              if (!v) {
                // Safety guard: don't brick the agent; educate operator on gating
                patch({ remoteHostEnabled: true });
                return;
              }
              patch({ remoteHostEnabled: v });
            }}
            help="Connects to localhost WebSocket daemon (ws://127.0.0.1:17322). Required for AI agent file tools, grep, and outline. Tool execution is safely gated via Auto-accept diffs and Auto-run shell below."
            guidance={getToggleGuidance('remoteHostEnabled', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                remoteHostEnabled: true,
              })
            }
          />

          <ToggleSwitch
            label="Auto-accept file edits"
            checked={settings.autoAcceptEdits}
            onChange={(v) => patch({ autoAcceptEdits: v })}
            disabled={planModeOn}
            disabledReason="File edits cannot be auto-accepted while Plan mode is active (writes prohibited)."
            help="When a working directory is connected, this automatically applies diffs without waiting for an extra Apply click."
            guidance={getToggleGuidance('autoAcceptEdits', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                autoAcceptEdits: getToggleGuidance('autoAcceptEdits', settings, selectedSetupId).recommendedValue,
              })
            }
          />

          <ToggleSwitch
            label="Auto-run shell commands"
            danger
            checked={settings.autoRunShell}
            onChange={(v) => patch({ autoRunShell: v })}
            disabled={planModeOn || settings.remoteHostEnabled === false}
            disabledReason={
              planModeOn
                ? 'Shell execution is strictly barred in Plan mode.'
                : 'Requires Remote host & bridge to be enabled above.'
            }
            help="HIGH CAUTION: Runs model shell tool calls on the localhost daemon without requiring a manual Run click. Dangerous commands are still refused."
            guidance={getToggleGuidance('autoRunShell', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                autoRunShell: getToggleGuidance('autoRunShell', settings, selectedSetupId).recommendedValue,
              })
            }
          />
        </div>
      </Section>

      {/* 2. Inference / Pairing Code */}
      <Section
        title="Inference & Pairing Code"
        hint="Pairing code for the localhost bridge. Inference endpoints live under API."
      >
        <div className="rounded-[3px] border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase text-muted">Active Pairing Code</span>
            <button
              type="button"
              onClick={() => patch({ pairingCode: generatePairingCode() })}
              className="btn-ghost h-6 px-2 text-[10px]"
            >
              Regenerate
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="font-mono text-xl font-bold tracking-[0.3em] text-white">
              {settings.pairingCode || '—'}
            </span>
            <span className="font-mono text-[11px] text-zinc-400">
              ws://127.0.0.1:17322
            </span>
          </div>
        </div>
      </Section>
    </div>
  );
}
