type MempalaceSettings = {
  mempalaceWing?: string;
  mempalacePalacePath?: string;
};

type McpRow = {
  id: string;
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  env?: Record<string, string>;
};

export const MEMPALACE_MCP_NAME = 'mempalace';

export const MEMPALACE_CATALOG_ENTRY = {
  id: 'mempalace',
  name: MEMPALACE_MCP_NAME,
  title: 'MemPalace',
  blurb: 'Local-first verbatim AI memory (wings, rooms, drawers). Official: mempalaceofficial.com',
  command: 'uvx',
  args: ['--from', 'mempalace', 'python', '-m', 'mempalace.mcp_server'],
  runner: 'uvx' as const,
};

export function mempalaceWingFor(settings: Pick<MempalaceSettings, 'mempalaceWing'>, workspaceRoot: string): string {
  const explicit = (settings.mempalaceWing || '').trim();
  if (explicit) return explicit;
  const base = workspaceRoot.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'workspace';
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'workspace';
}

export function mempalaceOpts(settings: MempalaceSettings, workspaceRoot: string) {
  return {
    palacePath: (settings.mempalacePalacePath || '').trim(),
    wing: mempalaceWingFor(settings, workspaceRoot),
  };
}

export function withMempalaceMcpServer(
  servers: McpRow[] | undefined,
  enabled: boolean,
  palacePath = '',
): McpRow[] {
  const list = Array.isArray(servers) ? [...servers] : [];
  const idx = list.findIndex((s) => (s.name || '').toLowerCase() === MEMPALACE_MCP_NAME);
  if (!enabled) {
    if (idx < 0) return list;
    const next = [...list];
    next[idx] = { ...next[idx], enabled: false };
    return next;
  }
  const env = palacePath.trim() ? { MEMPALACE_PALACE_PATH: palacePath.trim() } : undefined;
  if (idx >= 0) {
    const next = [...list];
    next[idx] = {
      ...next[idx],
      enabled: true,
      command: next[idx].command || MEMPALACE_CATALOG_ENTRY.command,
      args: next[idx].args?.length ? next[idx].args : [...MEMPALACE_CATALOG_ENTRY.args],
      env: { ...(next[idx].env || {}), ...(env || {}) },
    };
    return next;
  }
  const row: McpRow = {
    id: 'mcp_mempalace',
    name: MEMPALACE_MCP_NAME,
    command: MEMPALACE_CATALOG_ENTRY.command,
    args: [...MEMPALACE_CATALOG_ENTRY.args],
    enabled: true,
  };
  if (env) row.env = env;
  return [...list, row];
}

export function formatSessionMemory(userText: string, assistantText: string, meta?: { model?: string; thread?: string }) {
  const user = (userText || '').trim().slice(0, 8_000);
  const assistant = (assistantText || '').trim().slice(0, 12_000);
  if (!user && !assistant) return '';
  const lines = [
    `Abliterated session ${new Date().toISOString()}`,
    meta?.thread ? `Thread: ${meta.thread}` : '',
    meta?.model ? `Model: ${meta.model}` : '',
    '',
    '## User',
    user || '(empty)',
    '',
    '## Assistant',
    assistant || '(empty)',
  ];
  return lines.filter((l, i) => l !== '' || i === 0).join('\n');
}
