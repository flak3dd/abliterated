import { useState } from 'react';
import { Section, FieldLabel } from './SettingsShared';
import { ToggleSwitch } from '../ui/ToggleSwitch';
import {
  featuredMcpCatalog,
  catalogMatch,
  catalogToConfig,
  getMcpServerState,
  syncMcpServers,
} from '../../lib/mcpClient';
import { getToggleGuidance, type AgentSetupId } from '../../lib/agentPresets';
import { uid } from '../../lib/storage';
import type { SkillCatalogEntry } from '../../lib/skills';
import type { ClientSettings, McpServerConfig } from '../../types';
import type { LicenseState } from '../../lib/license';

export interface ToolsTabProps {
  settings: ClientSettings;
  patch: (partial: Partial<ClientSettings>) => void;
  license: LicenseState;
  servers: McpServerConfig[];
  statusById: Map<string, any>;
  statuses: any[];
  enabledMcp: number;
  mcpTick: number;
  setMcpTick: React.Dispatch<React.SetStateAction<number>>;
  mcpBusyId: string | null;
  setMcpBusyId: React.Dispatch<React.SetStateAction<string | null>>;
  mcpHint: string;
  setMcpHint: React.Dispatch<React.SetStateAction<string>>;
  disconnectOne: (id: string) => Promise<void>;
  connectOne: (server: McpServerConfig) => Promise<void>;
  updateMcp: (id: string, partial: Partial<McpServerConfig>) => void;
  roots: { bundled: string; global: string; workspace: string };
  skillRows: SkillCatalogEntry[];
  skillsBusy: boolean;
  refreshSkills: () => Promise<void>;
  selectedSetupId: AgentSetupId;
}

export function ToolsTab({
  settings,
  patch,
  license,
  servers,
  statusById,
  statuses,
  enabledMcp,
  mcpTick,
  setMcpTick,
  mcpBusyId,
  setMcpBusyId,
  mcpHint,
  setMcpHint,
  disconnectOne,
  connectOne,
  updateMcp,
  roots,
  skillRows,
  skillsBusy,
  refreshSkills,
  selectedSetupId,
}: ToolsTabProps) {
  const [customName, setCustomName] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const [customArgs, setCustomArgs] = useState('');

  const handleAddCustomMcp = () => {
    if (!customName.trim() || !customCommand.trim()) return;
    const args = customArgs.trim() ? customArgs.trim().split(/\s+/) : [];
    const newCfg: McpServerConfig = {
      id: uid('mcp'),
      name: customName.trim(),
      command: customCommand.trim(),
      args,
      enabled: true,
    };
    const list = [...servers, newCfg];
    patch({ mcpServers: list });
    setCustomName('');
    setCustomCommand('');
    setCustomArgs('');
    setMcpHint(`Added MCP server ${newCfg.name}`);
    void syncMcpServers(list).then(() => setMcpTick((n) => n + 1));
  };

  return (
    <div className="space-y-4">
      {/* 1. Web Search Integration */}
      <Section
        title="Web Search Integration"
        hint="Live internet search access for the agent loop via Brave Search API or self-hosted SearXNG."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FieldLabel label="Brave Search API Key" hint="Optional. Get free tier key from brave.com/search/api.">
            <input
              type="password"
              value={settings.webSearchBraveKey || ''}
              onChange={(e) => patch({ webSearchBraveKey: e.target.value })}
              placeholder="BSA-…"
              className="field font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
          </FieldLabel>

          <FieldLabel label="SearXNG Instance URL" hint="Optional private metasearch URL (e.g. http://localhost:8888).">
            <input
              type="text"
              value={settings.webSearchSearxUrl || ''}
              onChange={(e) => patch({ webSearchSearxUrl: e.target.value })}
              placeholder="https://searx.be / http://127.0.0.1:8888"
              className="field font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
            />
          </FieldLabel>
        </div>
      </Section>

      {/* 2. MCP Servers */}
      <Section
        title="Model Context Protocol (MCP)"
        hint="Stdio MCP servers via the localhost bridge. Tools appear as mcp__server__tool in chat and jobs."
      >
        {/* Featured catalog */}
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase text-muted">Featured Catalog</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {featuredMcpCatalog().map((entry) => {
              const hit = catalogMatch(servers, entry);
              const st = hit ? getMcpServerState(hit.id) : undefined;
              const on = Boolean(hit?.enabled);
              return (
                <div key={entry.id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-[12px] font-bold text-zinc-200">{entry.title}</div>
                      <p className="mt-0.5 font-mono text-[10px] text-muted">{entry.blurb}</p>
                    </div>
                    <button
                      type="button"
                      className={on ? 'btn-primary h-6 px-2 text-[10px]' : 'btn-ghost h-6 px-2 text-[10px]'}
                      onClick={() => {
                        if (hit) {
                          if (hit.enabled) {
                            updateMcp(hit.id, { enabled: false });
                            void disconnectOne(hit.id);
                            setMcpHint(`Disabled ${entry.title}`);
                          } else {
                            void connectOne({ ...hit, enabled: true });
                          }
                        } else {
                          const cfg = catalogToConfig(entry, uid('mcp'));
                          const list = [...servers, cfg];
                          patch({ mcpServers: list });
                          setMcpBusyId(cfg.id);
                          setMcpHint(`Connecting ${entry.title}…`);
                          void syncMcpServers(list)
                            .then(() => {
                              setMcpTick((n) => n + 1);
                              const stNow = getMcpServerState(cfg.id);
                              setMcpHint(
                                stNow?.connected
                                  ? `Connected ${entry.title}: ${stNow.tools.length} tool(s)`
                                  : stNow?.error || `Added ${entry.title}`,
                              );
                            })
                            .catch((e) =>
                              setMcpHint(e instanceof Error ? e.message : String(e)),
                            )
                            .finally(() => setMcpBusyId(null));
                        }
                      }}
                    >
                      {on ? 'Enabled' : 'Add'}
                    </button>
                  </div>
                  {st?.connected && st.tools.length ? (
                    <p
                      className="mt-1 truncate font-mono text-[10px] text-emerald-300/90"
                      title={st.tools.map((t) => t.name).join(', ')}
                    >
                      {st.tools.length} tools · {st.tools.map((t) => t.name).slice(0, 6).join(', ')}
                    </p>
                  ) : (
                    <p className="mt-1 truncate font-mono text-[10px] text-zinc-600">
                      {entry.command} {entry.args.join(' ')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Configured MCP Servers */}
        <div className="mt-4 border-t border-zinc-800/80 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase text-muted">
              Configured Servers ({servers.length} configured · {enabledMcp} active)
            </span>
            <button
              type="button"
              className="btn-ghost h-6 px-2 text-[10px]"
              onClick={() => {
                setMcpHint('Syncing MCP servers…');
                void syncMcpServers(servers).then(() => {
                  setMcpTick((n) => n + 1);
                  setMcpHint('MCP servers synced.');
                });
              }}
            >
              Sync All
            </button>
          </div>

          {servers.length === 0 ? (
            <div className="rounded border border-dashed border-zinc-800 p-4 text-center font-mono text-[11px] text-muted">
              No custom MCP servers configured. Pick from the catalog above or add below.
            </div>
          ) : (
            <div className="space-y-2">
              {servers.map((s) => {
                const st = statusById.get(s.id);
                const connected = !!st?.connected;
                const busy = mcpBusyId === s.id;
                return (
                  <div key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <input
                          value={s.name}
                          onChange={(e) => updateMcp(s.id, { name: e.target.value })}
                          placeholder="server name"
                          className="field field-sm py-0.5 font-mono text-[11px]"
                        />
                        <span
                          className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-bold uppercase ${
                            connected
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : st?.error
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                          }`}
                          data-mcp-tick={mcpTick}
                        >
                          {connected ? `${st?.toolCount ?? 0} tools` : st?.error ? 'error' : 'offline'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-400">
                          <input
                            type="checkbox"
                            checked={s.enabled}
                            disabled={busy}
                            onChange={(e) => {
                              const want = e.target.checked;
                              if (want && !s.enabled) {
                                if (enabledMcp + 1 > license.features.maxMcpServers) {
                                  setMcpHint(`License tier ${license.label} is capped at ${license.features.maxMcpServers} MCP server(s).`);
                                  return;
                                }
                                updateMcp(s.id, { enabled: true });
                                void connectOne({ ...s, enabled: true });
                              } else {
                                updateMcp(s.id, { enabled: false });
                                void disconnectOne(s.id);
                              }
                            }}
                          />
                          Enabled
                        </label>
                        <button
                          type="button"
                          className="btn-ghost h-6 px-2 text-[10px] text-rose-400 hover:bg-rose-950/40"
                          disabled={busy}
                          onClick={() => {
                            void disconnectOne(s.id);
                            patch({ mcpServers: servers.filter((x) => x.id !== s.id) });
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="mt-1.5 font-mono text-[10px] text-zinc-500 truncate">
                      <code>{s.command} {(s.args || []).join(' ')}</code>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add custom MCP row */}
          <div className="mt-3 rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-2.5">
            <div className="font-mono text-[10px] uppercase text-muted mb-1.5">Add Custom Stdio MCP Server</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Name (e.g. filesystem)"
                className="field field-sm text-[11px]"
              />
              <input
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                placeholder="Command (e.g. npx)"
                className="field field-sm text-[11px]"
              />
              <input
                value={customArgs}
                onChange={(e) => setCustomArgs(e.target.value)}
                placeholder="Args (e.g. -y @mcp/server .)"
                className="field field-sm text-[11px]"
              />
              <button
                type="button"
                className="btn-primary h-7 text-[11px]"
                disabled={!customName.trim() || !customCommand.trim()}
                onClick={handleAddCustomMcp}
              >
                + Add Server
              </button>
            </div>
          </div>

          <div className="mt-2 font-mono text-[10px] text-muted">
            {statuses.length === 0
              ? 'No sessions yet — enable a server, then Sync (bridge required).'
              : statuses
                  .map((s) => `${s.name}: ${s.connected ? `${s.toolCount} tools` : s.error || 'offline'}`)
                  .join(' · ')}
          </div>

          {mcpHint ? (
            <p className="mt-2 font-mono text-[11px] text-sky-300">{mcpHint}</p>
          ) : null}
        </div>
      </Section>

      {/* 3. Skills Catalog */}
      <Section
        title="Skills & Tool Recipes"
        hint="Reusable SKILL.md recipes and project conventions auto-loaded into chat and jobs."
      >
        <div className="grid gap-2">
          <ToggleSwitch
            label="Discover & inject SKILL.md recipes"
            checked={settings.skillsEnabled !== false}
            onChange={(v) => patch({ skillsEnabled: v })}
            help="Injects skills catalog into prompt. Workspace .ablit/skills bodies auto-load."
            guidance={getToggleGuidance('skillsEnabled', settings, selectedSetupId)}
            onAlign={() =>
              patch({
                skillsEnabled: getToggleGuidance('skillsEnabled', settings, selectedSetupId).recommendedValue,
              })
            }
          />
        </div>

        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 font-mono text-[11px] text-zinc-400">
          <div className="font-semibold text-zinc-300">Discovered Skill Locations:</div>
          <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-3">
            <div>Bundled: <span className="text-zinc-200">{roots.bundled}</span></div>
            <div>User: <span className="text-zinc-200">{roots.global}</span></div>
            <div>Workspace: <span className="text-zinc-200">{roots.workspace}</span></div>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-zinc-800/80 pt-2">
            <span>
              Loaded: <strong className="text-emerald-400">{skillRows.length}</strong> skill{skillRows.length === 1 ? '' : 's'}
              {skillsBusy ? ' (refreshing…)' : ''}
            </span>
            <button type="button" className="chip" onClick={() => void refreshSkills()} disabled={skillsBusy}>
              {skillsBusy ? 'Refreshing…' : 'Refresh Skills'}
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}
