import { bridge } from './bridgeClient';
import type { McpServerConfig } from '../types';

export { EXAMPLE_FILESYSTEM_MCP, MCP_ONE_CLICK_CATALOG, catalogToConfig } from './mcpCatalog';

export type McpToolDef = {
  serverName: string;
  name: string;
  namespaced: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type OpenAiFunctionTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type SessionState = {
  config: McpServerConfig;
  tools: McpToolDef[];
  connected: boolean;
  error?: string;
};

const sessions = new Map<string, SessionState>();
const listeners = new Set<(tools: McpToolDef[]) => void>();

export function isMcpToolName(name: string): boolean {
  return name.startsWith('mcp__');
}

export function mcpNamespace(serverName: string, toolName: string): string {
  const safeServer = serverName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return 'mcp__' + safeServer + '__' + safeTool;
}

export function parseMcpToolName(namespaced: string): { server: string; tool: string } | null {
  if (!namespaced.startsWith('mcp__')) return null;
  const rest = namespaced.slice('mcp__'.length);
  const idx = rest.indexOf('__');
  if (idx <= 0) return null;
  return { server: rest.slice(0, idx), tool: rest.slice(idx + 2) };
}

function notify() {
  const tools = listConnectedMcpTools();
  listeners.forEach((cb) => cb(tools));
}

export function subscribeMcpTools(cb: (tools: McpToolDef[]) => void): () => void {
  listeners.add(cb);
  cb(listConnectedMcpTools());
  return () => listeners.delete(cb);
}

export function listConnectedMcpTools(): McpToolDef[] {
  const out: McpToolDef[] = [];
  for (const s of sessions.values()) {
    if (s.connected) out.push(...s.tools);
  }
  return out;
}

export function getMcpServerState(id: string): SessionState | undefined {
  return sessions.get(id);
}

export function mcpToolsToOpenAi(tools: McpToolDef[]): OpenAiFunctionTool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.namespaced,
      description: t.description
        ? `[MCP ${t.serverName}] ${t.description}`
        : `MCP tool ${t.name} from server ${t.serverName}`,
      parameters: (t.inputSchema && typeof t.inputSchema === 'object'
        ? t.inputSchema
        : { type: 'object', properties: {} }) as Record<string, unknown>,
    },
  }));
}

export async function syncMcpServers(configs: McpServerConfig[]): Promise<void> {
  const enabled = configs.filter((c) => c.enabled && c.command.trim());
  const keep = new Set(enabled.map((c) => c.id));

  for (const [id] of [...sessions.entries()]) {
    if (!keep.has(id)) {
      try {
        if (bridge.connected) await bridge.mcpDisconnect(id);
      } catch {
        /* ignore */
      }
      sessions.delete(id);
    }
  }

  if (!bridge.connected) {
    const ok = await bridge.waitUntilConnected(5000);
    if (!ok) {
      for (const c of enabled) {
        sessions.set(c.id, {
          config: c,
          tools: [],
          connected: false,
          error: "bridge disconnected — start it with: npm run bridge (ws://127.0.0.1:17322), then Refresh",
        });
      }
      notify();
      return;
    }
  }


  for (const c of enabled) {
    try {
      const listed = await bridge.mcpConnect({
        id: c.id,
        name: c.name,
        command: c.command,
        args: c.args || [],
        env: c.env,
      });
      const tools: McpToolDef[] = (listed.tools || []).map((t) => ({
        serverName: c.name,
        name: t.name,
        namespaced: mcpNamespace(c.name, t.name),
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      sessions.set(c.id, { config: c, tools, connected: true });
    } catch (e) {
      sessions.set(c.id, {
        config: c,
        tools: [],
        connected: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  notify();
}

export async function disconnectMcpServer(id: string): Promise<void> {
  try {
    if (bridge.connected) await bridge.mcpDisconnect(id);
  } catch {
    /* ignore */
  }
  const existing = sessions.get(id);
  if (existing) {
    sessions.set(id, {
      ...existing,
      tools: [],
      connected: false,
      error: undefined,
    });
  }
  notify();
}

export function getMcpServerStatuses(): Array<{
  id: string;
  name: string;
  connected: boolean;
  toolCount: number;
  error?: string;
}> {
  return [...sessions.values()].map((s) => ({
    id: s.config.id,
    name: s.config.name,
    connected: s.connected,
    toolCount: s.tools.length,
    error: s.error,
  }));
}

export async function executeMcpToolCall(
  namespaced: string,
  args: Record<string, unknown>,
): Promise<string> {
  let serverId: string | undefined;
  let toolName: string | undefined;
  for (const s of sessions.values()) {
    const hit = s.tools.find((t) => t.namespaced === namespaced);
    if (hit) {
      serverId = s.config.id;
      toolName = hit.name;
      break;
    }
  }
  if (!serverId || !toolName) {
    const parsed = parseMcpToolName(namespaced);
    if (!parsed) throw new Error(`invalid MCP tool name: ${namespaced}`);
    const sess = [...sessions.values()].find(
      (s) => s.config.name.replace(/[^a-zA-Z0-9_-]/g, "_") === parsed.server,
    );
    serverId = sess?.config.id;
    toolName = parsed.tool;
  }
  if (!serverId || !toolName) throw new Error(`MCP tool not connected: ${namespaced}`);
  if (!bridge.connected) throw new Error("bridge disconnected");
  return bridge.mcpCallTool(serverId, toolName, args);
}
