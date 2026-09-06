import { useEffect, useState, type ReactNode } from 'react';
import { bridge } from '../lib/bridgeClient';
import {
  EXAMPLE_FILESYSTEM_MCP,
  disconnectMcpServer,
  getMcpServerState,
  getMcpServerStatuses,
  syncMcpServers,
} from '../lib/mcpClient';
import {
  LICENSE_TEST_KEYS,
  PRICING_HINT,
  countEnabledMcp,
  getLicenseState,
  normalizeLicenseKey,
  type LicenseState,
} from '../lib/license';
import {
  formatTokenCount,
  loadBuiltinUsage,
  remainingBuiltinTokens,
} from '../lib/builtinTokens';
import { generatePairingCode, setSettings, uid, wipeAll } from '../lib/storage';
import { MEMPALACE_CATALOG_ENTRY, withMempalaceMcpServer } from '../lib/mempalace';
import { skillRootHints, toCatalogEntries, type SkillCatalogEntry } from '../lib/skills';
import type { ClientSettings, McpServerConfig } from '../types';

interface Props {
  settings: ClientSettings;
  onSettingsChange: (s: ClientSettings) => void;
  onWiped: () => void;
}

function BuiltinTokenMeter({ license }: { license: LicenseState }) {
  const usage = loadBuiltinUsage();
  const cap = license.features.maxIncludedTokens;
  const used = usage.used;
  const left = remainingBuiltinTokens(license, usage);
  const pct = !Number.isFinite(cap) || cap <= 0 ? 0 : Math.min(100, Math.round((used / cap) * 100));

  return (
    <div className="mt-2 rounded border border-border bg-background px-3 py-2">
      <div className="font-mono text-[10px] uppercase text-muted">Built-in model tokens this month</div>
      <div className="mt-1 font-mono text-[12px] text-zinc-200">
        {formatTokenCount(used)} used · {formatTokenCount(left)} left of {formatTokenCount(cap)}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-800">
        <div
          className={`h-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-sky-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 font-mono text-[10px] text-muted">
        Abliteration built-in unrestricted model only. Featherless.ai catalog models do not count.
      </p>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
  danger,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <section className={`section-card${danger ? ' border-red-950 bg-red-950/20' : ''}`}>
      <div>
        <div className={`section-card-title${danger ? ' text-red-300' : ''}`}>{title}</div>
        {hint ? <p className="section-card-hint">{hint}</p> : null}
      </div>
      <div className="section-card-body">{children}</div>
    </section>
  );
}

function SwitchRow({
  label,
  help,
  checked,
  onChange,
  danger,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  danger?: boolean;
}) {
  return (
    <div className={`switch-row${danger ? ' switch-row--danger' : ''}`}>
      <label className="switch-row-main">
        <span>{label}</span>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </label>
      {help ? <p className="switch-row-help">{help}</p> : null}
    </div>
  );
}

function FieldLabel({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block font-mono text-[10px] uppercase text-muted">
      {label}
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 font-mono text-[11px] normal-case tracking-normal text-muted">{hint}</p> : null}
    </label>
  );
}

function commandPreview(s: McpServerConfig): string {
  const args = (s.args || []).join(' ');
  const full = `${s.command || ''}${args ? ` ${args}` : ''}`.trim();
  return full || '(no command)';
}

export function SettingsScreen({ settings, onSettingsChange, onWiped }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [mcpTick, setMcpTick] = useState(0);
  const [mcpBusyId, setMcpBusyId] = useState<string | null>(null);
  const [mcpHint, setMcpHint] = useState('');
  const [licenseDraft, setLicenseDraft] = useState(settings.licenseKey || '');
  const [licenseMsg, setLicenseMsg] = useState('');
  const [skillRows, setSkillRows] = useState<SkillCatalogEntry[]>([]);
  const [skillsBusy, setSkillsBusy] = useState(false);
  const [mpHint, setMpHint] = useState('');
  const [mpBusy, setMpBusy] = useState<'which' | 'install' | 'init' | 'status' | null>(null);

  useEffect(() => {
    setLicenseDraft(settings.licenseKey || '');
  }, [settings.licenseKey]);

  const patch = (partial: Partial<ClientSettings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    onSettingsChange(next);
  };

  const persistLicense = (rawKey: string) => {
    const key = normalizeLicenseKey(rawKey);
    setLicenseDraft(key);
    const nextLicense = getLicenseState({ licenseKey: key });
    patch({
      licenseKey: key,
      maxConcurrentJobs: nextLicense.tier === 'admin' ? 16 : nextLicense.tier === 'free' ? 1 : 4,
      selfDeepenPasses: nextLicense.features.maxSelfDeepenPasses,
    });
    try {
      void window.ablitDesktop?.setLicense?.(key);
    } catch {
      /* browser / no preload */
    }
    return nextLicense;
  };


  const updateMcp = (id: string, partial: Partial<McpServerConfig>) => {
    const next = (settings.mcpServers || []).map((s) => (s.id === id ? { ...s, ...partial } : s));
    patch({ mcpServers: next });
  };

  const wipe = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    wipeAll();
    setConfirming(false);
    onWiped();
  };

  const refreshMcp = async () => {
    setMcpHint('');
    if (!bridge.connected) {
      const ok = await bridge.waitUntilConnected(5000);
      if (!ok) {
        setMcpHint('Bridge disconnected — start it with: npm run bridge (ws://127.0.0.1:17322), then Refresh');
        setMcpTick((n) => n + 1);
        return;
      }
    }
    await syncMcpServers(settings.mcpServers || []);
    setMcpTick((n) => n + 1);
  };

  const connectOne = async (s: McpServerConfig) => {
    setMcpHint('');
    if (!s.name.trim()) {
      setMcpHint('Name is required before Connect.');
      return;
    }
    if (!s.command.trim()) {
      setMcpHint('Command is required before Connect (e.g. npx).');
      return;
    }
    setMcpBusyId(s.id);
    try {
      if (!bridge.connected) {
        const ok = await bridge.waitUntilConnected(5000);
        if (!ok) {
          setMcpHint('Bridge disconnected — start it with: npm run bridge (ws://127.0.0.1:17322), then Refresh');
          return;
        }
      }
      const list = (settings.mcpServers || []).map((row) =>
        row.id === s.id ? { ...row, enabled: true } : row,
      );
      if (!s.enabled) {
        patch({ mcpServers: list });
      }
      await syncMcpServers(list);
      setMcpTick((n) => n + 1);
      const st = getMcpServerState(s.id);
      if (st?.connected) {
        setMcpHint(`Connected ${s.name}: ${st.tools.length} tool(s)`);
      } else {
        setMcpHint(st?.error || `Failed to connect ${s.name}`);
      }
    } finally {
      setMcpBusyId(null);
    }
  };

  const disconnectOne = async (id: string) => {
    setMcpBusyId(id);
    setMcpHint('');
    try {
      await disconnectMcpServer(id);
      setMcpTick((n) => n + 1);
    } finally {
      setMcpBusyId(null);
    }
  };

  const statuses = getMcpServerStatuses();
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const servers = settings.mcpServers || [];
  const appRoot = bridge.currentAppRoot;
  const wsRoot = bridge.validWorkspaceRoot || bridge.currentRoot || '';
  const roots = skillRootHints({ appRoot, workspaceRoot: wsRoot });
  const refreshSkills = async () => {
    setSkillsBusy(true);
    try {
      if (!bridge.connected || settings.skillsEnabled === false) {
        setSkillRows([]);
        return;
      }
      const skills = await bridge.listSkills();
      setSkillRows(toCatalogEntries(skills));
    } catch {
      setSkillRows([]);
    } finally {
      setSkillsBusy(false);
    }
  };

  useEffect(() => {
    void refreshSkills();
  }, [settings.skillsEnabled, appRoot, wsRoot]);

  const license = getLicenseState(settings);
  const enabledMcp = countEnabledMcp(servers);

  return (
    <div className="h-full overflow-auto p-4">
      <header className="page-header">
        <div className="page-header-title">Settings</div>
        <p className="page-header-sub">Agent loop, safety, pairing, and MCP — saved locally.</p>
      </header>

      <div className="grid max-w-2xl gap-4">
        <Section title="System prompt" hint="Default system prompt for new sessions.">
          <textarea
            value={settings.systemPrompt}
            onChange={(e) => patch({ systemPrompt: e.target.value })}
            rows={5}
            className="field resize-y"
          />
        </Section>

        <Section title="Agent loop" hint="Turn budget, deepen, mid-run inject, and completion chips.">
          <FieldLabel label="Max agent turns (1–50)" hint="Hard stop for tool/agent loops per run.">
            <input
              type="number"
              min={1}
              max={50}
              value={settings.maxAgentTurns ?? 24}
              onChange={(e) => {
                const n = Number(e.target.value);
                const clamped = Number.isFinite(n) ? Math.min(50, Math.max(1, Math.floor(n))) : 24;
                patch({ maxAgentTurns: clamped });
              }}
              className="field field-num"
            />
          </FieldLabel>


          <FieldLabel
            label={`Max concurrent Jobs (1–${Number.isFinite(license.features.maxConcurrentJobs) ? license.features.maxConcurrentJobs : 4})`}
            hint={
              license.isFree
                ? 'Free tier: single-flight Jobs. Pro unlocks up to 4 parallel.'
                : 'How many background Jobs may run at once.'
            }
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
                const max = Number.isFinite(license.features.maxConcurrentJobs)
                  ? license.features.maxConcurrentJobs
                  : 4;
                const clamped = Number.isFinite(n) ? Math.min(max, Math.max(1, Math.floor(n))) : 1;
                patch({ maxConcurrentJobs: clamped });
              }}
              className="field field-num"
            />
          </FieldLabel>

          <SwitchRow
            label="Self-deepen answers"
            checked={settings.selfDeepenEnabled !== false}
            onChange={(v) => patch({ selfDeepenEnabled: v })}
            help="After a text-only answer, nudge the model to expand thin/missing spots. Stops early on [ANSWER_COMPLETE]. Pair with Completeness below for the Abliterated-only checklist (does not call Grok)."
          />

          <SwitchRow
            label="Deepen for completeness (Abliterated-only)"
            checked={settings.deepenCompleteness !== false}
            onChange={(v) => patch({ deepenCompleteness: v })}
            help="When self-deepen runs (or Jobs enqueue with the Completeness chip), inject the completeness checklist from deepenComplete.ts. Chat header/composer toggle stays in sync. No Grok/censored CLI path."
          />

          <FieldLabel label="Self-deepen passes (0–5)" hint="0 turns deepen off even if the toggle is on.">
            <input
              type="number"
              min={0}
              max={5}
              value={settings.selfDeepenPasses ?? 2}
              onChange={(e) => {
                const n = Number(e.target.value);
                const clamped = Number.isFinite(n) ? Math.min(5, Math.max(0, Math.floor(n))) : 2;
                patch({ selfDeepenPasses: clamped });
              }}
              className="field field-num"
            />
          </FieldLabel>

          <SwitchRow
            label="Mid-run message inject"
            checked={settings.midRunInjectEnabled !== false}
            onChange={(v) => patch({ midRunInjectEnabled: v })}
            help="Send further messages while the agent is busy. It finishes the current step, then integrates your note."
          />

          <SwitchRow
            label="Job worktrees (experimental)"
            checked={settings.jobWorktreesEnabled === true}
            onChange={(v) => patch({ jobWorktreesEnabled: v })}
            help="When on, Jobs prepare .ablit/worktrees/<jobId> (git worktree when possible). Bridge still uses a shared ROOT — isolation stub until multi-root."
          />

          <SwitchRow
            label="Multi-agent fleets (experimental)"
            checked={settings.multiAgentEnabled === true}
            onChange={(v) => patch({ multiAgentEnabled: v })}
            help="Orchestrator + coder/tester/verifier over .ablit/task.json blackboard. Default off. Pair with Job worktrees for isolation."
          />

          <SwitchRow
            label="Completion footer chips"
            checked={settings.completionFooterEnabled !== false}
            onChange={(v) => patch({ completionFooterEnabled: v })}
            help="Finished answers with a Done/Continue footer show three one-click continue prompts."
          />

          <SwitchRow
            label="Use reasoning as answer when content is empty"
            checked={settings.coalesceReasoningToContent !== false}
            onChange={(v) => patch({ coalesceReasoningToContent: v })}
            help="R1-style models sometimes fill reasoning only. Promote that text into the main answer locally — no extra API call. Off = show reasoning panel only."
          />
        </Section>


        <Section
          title="Skills"
          hint="Reusable SKILL.md recipes. Workspace .ablit/skills and AGENTS.md auto-load into chat on session start."
        >
          <SwitchRow
            label="Enable skills"
            checked={settings.skillsEnabled !== false}
            onChange={(v) => patch({ skillsEnabled: v })}
            help="Inject the skills catalog. Workspace .ablit/skills bodies auto-load. AGENTS.md conventions load even when this is off."
          />
          <div className="mt-2 space-y-1 font-mono text-[11px] text-zinc-400">
            <div>Bundled: {roots.bundled}</div>
            <div>User: {roots.global}</div>
            <div>Workspace: {roots.workspace}</div>
            <div>
              Loaded: {skillRows.length} skill{skillRows.length === 1 ? '' : 's'}
              {skillsBusy ? ' (refreshing…)' : ''}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="chip" onClick={() => void refreshSkills()} disabled={skillsBusy}>
              Refresh
            </button>
            <span className="font-mono text-[10px] text-muted">
              Add skills under ~/.abliterated/skills/&lt;slug&gt;/SKILL.md or .ablit/skills/ in the workspace. See docs/SKILLS.md.
            </span>
          </div>
        </Section>

        <Section
          title="Web search"
          hint="Built-in web_search is keyless (Brave HTML, then Bing, then Wikipedia). Optional backends override when set."
        >
          <FieldLabel
            label="Brave Search API key"
            hint="Optional. If set, web_search uses api.search.brave.com first. Leave empty for keyless search."
          >
            <input
              type="password"
              autoComplete="off"
              value={settings.webSearchBraveKey}
              onChange={(e) => patch({ webSearchBraveKey: e.target.value })}
              placeholder="BSA..."
              className="field"
            />
          </FieldLabel>
          <FieldLabel
            label="SearxNG URL"
            hint="Optional. Example: http://127.0.0.1:8080 — must allow format=json."
          >
            <input
              value={settings.webSearchSearxUrl}
              onChange={(e) => patch({ webSearchSearxUrl: e.target.value })}
              placeholder="https://searx.example/search"
              className="field"
            />
          </FieldLabel>
        </Section>

        <Section title="Safety" hint="What the agent may write or execute on your machine.">
          <SwitchRow
            label="Remote host enabled"
            checked={settings.remoteHostEnabled}
            onChange={(v) => patch({ remoteHostEnabled: v })}
            help="Allow the localhost bridge / remote host features."
          />

          <SwitchRow
            label="Auto-accept file edits"
            checked={settings.autoAcceptEdits}
            onChange={(v) => patch({ autoAcceptEdits: v })}
            help="When a working directory is connected, agent code files already write there. This also applies diffs without an extra Apply click. Shell still needs Run unless Auto-run is on."
          />

          <SwitchRow
            label="Auto-run shell"
            danger
            checked={settings.autoRunShell}
            onChange={(v) => patch({ autoRunShell: v })}
            help="Danger: runs model shell tool calls on the localhost daemon without a Run click. Deadly commands are still refused."
          />
        </Section>

        <Section
          title="MemPalace"
          hint="Local-first verbatim memory (wings / rooms / drawers). Official CLI: uv tool install mempalace — docs at mempalaceofficial.com. First-class tools: memory_search, memory_save, memory_status, memory_wake."
        >
          <SwitchRow
            label="Enable MemPalace"
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
            help="When on, chat/jobs get wake-up context and memory_* tools. MCP server is added as mcp__mempalace__* if uvx is available."
          />
          <SwitchRow
            label="Auto-recall (wake-up)"
            checked={settings.mempalaceAutoRecall !== false}
            onChange={(v) => patch({ mempalaceAutoRecall: v })}
            help="Inject L0+L1 wake-up into the system prompt when the bridge is connected."
          />
          <SwitchRow
            label="Auto-save sessions"
            checked={settings.mempalaceAutoSave !== false}
            onChange={(v) => patch({ mempalaceAutoSave: v })}
            help="After each chat/job run, file the last user/assistant turn into the palace (wing = workspace name)."
          />
          <FieldLabel
            label="Palace path"
            hint="Empty = MemPalace default (~/.mempalace/palace). Sets MEMPALACE_PALACE_PATH for CLI and MCP."
          >
            <input
              value={settings.mempalacePalacePath}
              onChange={(e) => patch({ mempalacePalacePath: e.target.value })}
              placeholder="~/.mempalace/palace"
              className="field"
            />
          </FieldLabel>
          <FieldLabel
            label="Wing"
            hint="Empty = basename of the connected workspace. Used to scope search / save."
          >
            <input
              value={settings.mempalaceWing}
              onChange={(e) => patch({ mempalaceWing: e.target.value })}
              placeholder="workspace folder name"
              className="field"
            />
          </FieldLabel>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
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
              className="btn-primary h-7 px-2 text-[10px]"
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
              Install
            </button>
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
              disabled={mpBusy !== null}
              onClick={() => {
                setMpBusy('init');
                setMpHint('Initializing palace from the connected workspace…');
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
              Init workspace
            </button>
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
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
              className="btn-ghost h-7 px-2 text-[10px]"
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
                  `Added MCP ${MEMPALACE_CATALOG_ENTRY.command} ${MEMPALACE_CATALOG_ENTRY.args.join(' ')} — Connect it under MCP servers.`,
                );
              }}
            >
              Add MCP server
            </button>
          </div>
          {mpHint ? (
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border bg-background px-2 py-1.5 font-mono text-[10px] text-zinc-300">
              {mpHint}
            </pre>
          ) : null}
        </Section>

        <Section title="Inference / pairing" hint="Pairing code for the localhost bridge. Inference endpoints live under API.">
          <div className="rounded border border-border bg-background px-3 py-2">
            <div className="font-mono text-[10px] uppercase text-muted">Pairing code</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="font-mono text-lg tracking-[0.3em] text-zinc-100">{settings.pairingCode}</span>
              <button
                type="button"
                onClick={() => patch({ pairingCode: generatePairingCode() })}
                className="btn-ghost h-7 px-2 text-[10px]"
              >
                Regenerate
              </button>
            </div>
          </div>
        </Section>

        <Section
          title="MCP servers"
          hint="Stdio MCP via the localhost bridge. Tools appear as mcp__server__tool in chat/jobs. Orphan MCP procs are cleaned on Refresh/bridge restart."
        >
          <p className="font-mono text-[11px] text-muted">
            Example: <code className="text-zinc-400">npx -y @modelcontextprotocol/server-filesystem .</code>
          </p>

          {servers.length === 0 ? (
            <div className="rounded border border-dashed border-border bg-background px-3 py-4 text-center font-mono text-[11px] text-muted">
              No MCP servers
            </div>
          ) : (
            <div className="grid gap-2">
              {servers.map((s) => {
                const st = statusById.get(s.id);
                const connected = !!st?.connected;
                const busy = mcpBusyId === s.id;
                const missing = !s.name.trim() || !s.command.trim();
                return (
                  <div key={s.id} className="rounded border border-border bg-background p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={s.name}
                        onChange={(e) => updateMcp(s.id, { name: e.target.value })}
                        placeholder="name"
                        className="field field-sm py-0.5 text-[11px]"
                      />
                      <span
                        className={`status-badge${connected ? ' status-badge--ok' : st?.error ? ' status-badge--err' : ''}`}
                        data-mcp-tick={mcpTick}
                      >
                        {connected
                          ? `${st?.toolCount ?? 0} tools`
                          : st?.error
                            ? 'error'
                            : 'offline'}
                      </span>
                      <label className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-zinc-400">
                        enabled
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={(e) => {
                            const want = e.target.checked;
                            if (want && !s.enabled) {
                              const nextCount = enabledMcp + 1;
                              if (nextCount > license.features.maxMcpServers) {
                                setMcpHint(
                                  `Free tier allows ${license.features.maxMcpServers} MCP server — enabling anyway (soft). Upgrade for unlimited.`,
                                );
                              }
                            }
                            updateMcp(s.id, { enabled: want });
                          }}
                        />
                      </label>
                      {connected ? (
                        <button
                          type="button"
                          disabled={busy}
                          className="btn-ghost h-7 px-2 text-[10px]"
                          onClick={() => void disconnectOne(s.id)}
                        >
                          Disconnect
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy || missing}
                          className="btn-primary h-7 px-2 text-[10px]"
                          onClick={() => void connectOne(s)}
                          title={missing ? 'Name and command required' : 'Connect this server'}
                        >
                          Connect
                        </button>
                      )}
                      <button
                        type="button"
                        className="font-mono text-[10px] text-red-300 hover:text-red-200"
                        onClick={() => {
                          void disconnectMcpServer(s.id).then(() => {
                            patch({ mcpServers: servers.filter((x) => x.id !== s.id) });
                            setMcpTick((n) => n + 1);
                          });
                        }}
                      >
                        remove
                      </button>
                    </div>
                    <div className="mt-1.5 truncate font-mono text-[10px] text-zinc-500" title={commandPreview(s)}>
                      {commandPreview(s)}
                    </div>
                    <input
                      value={s.command}
                      onChange={(e) => updateMcp(s.id, { command: e.target.value })}
                      placeholder="command e.g. npx"
                      className="field mt-1.5 py-0.5 text-[11px]"
                    />
                    <input
                      value={(s.args || []).join(' ')}
                      onChange={(e) =>
                        updateMcp(s.id, {
                          args: e.target.value.trim() ? e.target.value.trim().split(/\s+/) : [],
                        })
                      }
                      placeholder="args space-separated"
                      className="field mt-1 py-0.5 text-[11px]"
                    />
                    {missing ? (
                      <p className="mt-1 font-mono text-[10px] text-amber-400/90">
                        Name and command required to connect.
                      </p>
                    ) : null}
                    {st?.error && !connected ? (
                      <p className="mt-1 font-mono text-[10px] text-red-300/90">{st.error}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
              onClick={() => {
                const row: McpServerConfig = {
                  id: uid('mcp'),
                  name: 'filesystem',
                  command: EXAMPLE_FILESYSTEM_MCP.command,
                  args: [...EXAMPLE_FILESYSTEM_MCP.args],
                  enabled: false,
                };
                patch({ mcpServers: [...servers, row] });
                setMcpHint('');
              }}
            >
              Add filesystem example
            </button>
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
              onClick={() => {
                const row: McpServerConfig = {
                  id: uid('mcp'),
                  name: 'server',
                  command: '',
                  args: [],
                  enabled: true,
                };
                patch({ mcpServers: [...servers, row] });
                setMcpHint('');
              }}
            >
              Add blank
            </button>
            <button type="button" className="btn-primary h-7 px-2 text-[10px]" onClick={() => void refreshMcp()}>
              Connect / refresh all
            </button>
          </div>

          {mcpHint ? <p className="font-mono text-[11px] text-amber-400">{mcpHint}</p> : null}

          <div className="font-mono text-[10px] text-muted" data-mcp-tick={mcpTick}>
            {statuses.length === 0
              ? 'No sessions yet — enable a server, then Connect (bridge required).'
              : statuses
                  .map((s) => `${s.name}: ${s.connected ? `${s.toolCount} tools` : s.error || 'offline'}`)
                  .join(' · ')}
          </div>
        </Section>

        <Section
          title="License / Plan"
          hint={`Starter $${PRICING_HINT.starterMonthly}/mo · Pro $${PRICING_HINT.proMonthly}/mo or $${PRICING_HINT.proYearly}/yr · Team $${PRICING_HINT.teamMonthlySeat}/mo seat.`}
        >
          <div className="rounded border border-border bg-background px-3 py-2">
            <div className="font-mono text-[10px] uppercase text-muted">Current plan</div>
            <div className="mt-1 font-mono text-lg text-zinc-100">{license.label}</div>
            {license.features.showWatermark ? (
              <p className="mt-1 font-mono text-[11px] text-amber-400/90">Free watermark on — upgrade to remove.</p>
            ) : (
              <p className="mt-1 font-mono text-[11px] text-emerald-400/90">No watermark · priority features unlocked.</p>
            )}
          </div>

          <ul className="mt-2 list-inside list-disc font-mono text-[11px] text-muted">
            <li>
              MCP servers:{" "}
              {Number.isFinite(license.features.maxMcpServers) ? license.features.maxMcpServers : "unlimited"} (enabled
              now: {enabledMcp})
            </li>
            <li>
              Jobs concurrency: up to{' '}
              {Number.isFinite(license.features.maxConcurrentJobs)
                ? license.features.maxConcurrentJobs
                : 'unlimited'}
            </li>
            <li>Plan mode: {license.features.planModeAllowed ? 'allowed' : '—'}</li>
            <li>Shared seats: {license.features.sharedSeats ? 'Team placeholder' : '—'}</li>
            <li>
              Built-in unrestricted model:{' '}
              {license.features.maxIncludedTokens === 0
                ? 'not included — use Featherless.ai'
                : `${formatTokenCount(license.features.maxIncludedTokens)} tokens/mo`}
            </li>
          </ul>
          {license.features.maxIncludedTokens > 0 ? (
            <BuiltinTokenMeter license={license} />
          ) : null}

          <FieldLabel label="License key" hint="Paste your ABLIT-* license key from checkout or redeem. IDE activates via license key (loginId support later).">
            <input
              value={licenseDraft}
              onChange={(e) => setLicenseDraft(e.target.value)}
              placeholder="ABLIT-STARTER-XXXX-XXXX / ABLIT-PRO-XXXX-XXXX"
              className="field font-mono text-[12px]"
              spellCheck={false}
              autoComplete="off"
            />
          </FieldLabel>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary h-7 px-3 text-[10px]"
              onClick={() => {
                const key = normalizeLicenseKey(licenseDraft);
                const next = persistLicense(key);
                setLicenseMsg(
                  key
                    ? `Activated ${next.label}${next.isFree && key ? " (unrecognized key → Free)" : ""}.`
                    : "Cleared — Free tier.",
                );
              }}
            >
              Activate
            </button>
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
              onClick={() => {
                persistLicense(LICENSE_TEST_KEYS.free);
                setLicenseMsg('Forced Free (ABLIT-FREE) to test gates. Paste your license key above to restore.');
              }}
            >
              Test Free gates
            </button>
          </div>
          {licenseMsg ? <p className="font-mono text-[11px] text-sky-300">{licenseMsg}</p> : null}
          <p className="font-mono text-[10px] text-muted">
            Offline stub only — real verification will be server-signed after checkout. See docs/PRODUCT.md.
          </p>
        </Section>

        <Section title="Documentation" hint="In-app guide served by Vite from public/docs while the DEV server runs.">
          <a
            href="/docs/"
            target="_blank"
            rel="noreferrer"
            className="btn-primary inline-flex"
          >
            App docs
          </a>
          <p className="mt-2 font-mono text-[11px] text-muted">
            Opens /docs/ in a new tab (http://127.0.0.1:5173/docs/). Raw markdown: /docs/APP.md
          </p>
        </Section>

        <Section title="Danger zone" hint="Wipe settings, threads, messages, jobs, and workspace from localStorage." danger>
          <button type="button" onClick={wipe} className="btn-danger">
            {confirming ? 'Click again to confirm wipe' : 'Wipe all'}
          </button>
        </Section>
      </div>
    </div>
  );
}
