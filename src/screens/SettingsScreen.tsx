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
  ADMIN_LICENSE_KEY,
  LICENSE_TEST_KEYS,
  PRICING_HINT,
  adminCredentials,
  countEnabledMcp,
  getLicenseState,
  normalizeLicenseKey,
  verifyAdminLogin,
} from '../lib/license';
import { generatePairingCode, setSettings, uid, wipeAll } from '../lib/storage';
import type { ClientSettings, McpServerConfig } from '../types';

interface Props {
  settings: ClientSettings;
  onSettingsChange: (s: ClientSettings) => void;
  onWiped: () => void;
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
  const creds = adminCredentials();
  const [adminUser, setAdminUser] = useState(creds.username);
  const [adminPass, setAdminPass] = useState('');
  const [adminMsg, setAdminMsg] = useState('');
  const [adminErr, setAdminErr] = useState('');

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

  const signInAdmin = () => {
    setAdminErr('');
    setAdminMsg('');
    if (!verifyAdminLogin(adminUser, adminPass)) {
      setAdminErr(
        `Invalid username or password. Use ${creds.username} / ${creds.password}, or paste ABLIT-ADMIN in the password field.`,
      );
      return;
    }
    const next = persistLicense(ADMIN_LICENSE_KEY);
    setAdminPass('');
    setAdminMsg(
      `Signed in as admin — ${next.label}. This unlocks local IDE gates only. Cloud chat still needs an API key on the API tab (Abliteration token or Featherless key).`,
    );
    setLicenseMsg(`Activated ${next.label}.`);
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

          <SwitchRow
            label="Plan mode active"
            checked={settings.planModeEnabled === true}
            onChange={(v) =>
              patch({ planModeEnabled: v, buildModeEnabled: v ? false : settings.buildModeEnabled !== false })
            }
            help="When on, chat is read-only explore → checklist until you Approve plan. Write/shell/MCP stay locked. Turns Build mode off."
          />

          <SwitchRow
            label="Build mode active"
            checked={settings.buildModeEnabled !== false && settings.planModeEnabled !== true}
            onChange={(v) => patch({ buildModeEnabled: v, planModeEnabled: v ? false : settings.planModeEnabled })}
            help="After reasoning, emit a ToDo list in content. If new file/folder structure is needed, scaffold it first, then work the ToDos."
          />

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
            help="After a text-only answer, nudge the model to expand thin spots. Stops early on [ANSWER_COMPLETE]."
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
            help="Apply Abliterated diffs and fenced files via the localhost bridge — no Apply click. Independent of auto-run shell."
          />

          <SwitchRow
            label="Auto-run shell"
            danger
            checked={settings.autoRunShell}
            onChange={(v) => patch({ autoRunShell: v })}
            help="Danger: runs model shell tool calls on the localhost daemon without a Run click. Deadly commands are still refused."
          />
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
          hint={`Freemium stub — Pro $${PRICING_HINT.proMonthly}/mo or $${PRICING_HINT.proYearly}/yr · Team $${PRICING_HINT.teamMonthlySeat}/mo seat (suggested).`}
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
            <li>Plan mode: allowed</li>
            <li>Shared seats: {license.features.sharedSeats ? 'Team placeholder' : '—'}</li>
          </ul>

          <div className="rounded border border-emerald-900/50 bg-emerald-950/20 px-3 py-2">
            <div className="font-mono text-[10px] uppercase text-emerald-400/90">Development admin</div>
            <p className="mt-1 font-mono text-[11px] text-muted">
              Full usage while developing. User <span className="text-zinc-200">{creds.username}</span> / password{' '}
              <span className="text-zinc-200">{creds.password}</span>
              {import.meta.env.DEV ? ' · Vite DEV auto-unlocks Admin when no key is set.' : ''}.
            </p>
            <form
              className="mt-2 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                signInAdmin();
              }}
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={adminUser}
                  onChange={(e) => setAdminUser(e.target.value)}
                  placeholder="username"
                  autoComplete="off"
                  name="ablit-admin-user"
                  className="field font-mono text-[12px]"
                />
                <input
                  type="password"
                  value={adminPass}
                  onChange={(e) => setAdminPass(e.target.value)}
                  placeholder="password"
                  autoComplete="off"
                  name="ablit-admin-pass"
                  className="field font-mono text-[12px]"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="btn-primary h-7 px-3 text-[10px]">
                  Sign in as admin
                </button>
                <button
                  type="button"
                  className="btn-ghost h-7 px-2 text-[10px]"
                  onClick={() => {
                    setAdminErr('');
                    const next = persistLicense(ADMIN_LICENSE_KEY);
                    setAdminMsg(`Applied ${ADMIN_LICENSE_KEY} — ${next.label}.`);
                    setLicenseMsg(`Activated ${next.label}.`);
                  }}
                >
                  Unlock admin key
                </button>
              </div>
            </form>
            {adminErr ? <p className="mt-1 font-mono text-[11px] text-rose-400">{adminErr}</p> : null}
            {adminMsg ? <p className="mt-1 font-mono text-[11px] text-emerald-300">{adminMsg}</p> : null}
          </div>

          <FieldLabel label="License key" hint="ABLIT-ADMIN · ABLIT-DEV-UNLOCK · ABLIT-PRO-XXXX-XXXX · ABLIT-FREE to test gates">
            <input
              value={licenseDraft}
              onChange={(e) => setLicenseDraft(e.target.value)}
              placeholder="ABLIT-PRO-XXXX-XXXX"
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
                const next = persistLicense(LICENSE_TEST_KEYS.admin);
                setAdminErr('');
                setAdminMsg(`Applied ${LICENSE_TEST_KEYS.admin} — ${next.label}.`);
                setLicenseMsg(`Activated ${next.label}.`);
              }}
            >
              Apply admin key
            </button>
            <button
              type="button"
              className="btn-ghost h-7 px-2 text-[10px]"
              onClick={() => {
                persistLicense(LICENSE_TEST_KEYS.free);
                setAdminMsg('');
                setLicenseMsg('Forced Free (ABLIT-FREE) to test gates. Sign in as admin to restore.');
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
