import type { McpServerConfig } from '../types';

/** One-click stdio MCP: npx -y or uvx, no API key. Connects via the localhost bridge. */
export type McpCatalogEntry = {
  /** Stable catalog id (not the runtime server id). */
  id: string;
  /** MCP server name written into settings. */
  name: string;
  title: string;
  blurb: string;
  command: string;
  args: string[];
  /** How the process is launched. uvx needs `uv` on PATH. */
  runner: 'npx' | 'uvx';
};

export const MCP_ONE_CLICK_CATALOG: readonly McpCatalogEntry[] = [
  {
    id: 'filesystem',
    name: 'filesystem',
    title: 'Filesystem',
    blurb: 'Read/write/search under the workspace root.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    runner: 'npx',
  },
  {
    id: 'memory',
    name: 'memory',
    title: 'Memory',
    blurb: 'Local knowledge-graph memory across sessions.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    runner: 'npx',
  },
  {
    id: 'sequential-thinking',
    name: 'sequential-thinking',
    title: 'Sequential thinking',
    blurb: 'Structured multi-step reasoning tool.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    runner: 'npx',
  },
  {
    id: 'everything',
    name: 'everything',
    title: 'Everything',
    blurb: 'Official MCP testbed (tools, resources, prompts).',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    runner: 'npx',
  },
  {
    id: 'playwright',
    name: 'playwright',
    title: 'Playwright',
    blurb: 'Browser automation (npx pulls Chromium on first run).',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    runner: 'npx',
  },
  {
    id: 'fetch',
    name: 'fetch',
    title: 'Fetch',
    blurb: 'Fetch a URL and convert the page for the model.',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    runner: 'uvx',
  },
  {
    id: 'git',
    name: 'git',
    title: 'Git',
    blurb: 'Status, diff, log, and staging for the workspace repo.',
    command: 'uvx',
    args: ['mcp-server-git', '--repository', '.'],
    runner: 'uvx',
  },
  {
    id: 'time',
    name: 'time',
    title: 'Time',
    blurb: 'Current time and timezone conversion.',
    command: 'uvx',
    args: ['mcp-server-time'],
    runner: 'uvx',
  },
];

export function catalogToConfig(entry: McpCatalogEntry, id: string): McpServerConfig {
  return {
    id,
    name: entry.name,
    command: entry.command,
    args: [...entry.args],
    enabled: true,
  };
}

export function findCatalogEntryByName(name: string): McpCatalogEntry | undefined {
  const key = name.trim().toLowerCase();
  return MCP_ONE_CLICK_CATALOG.find((e) => e.name.toLowerCase() === key);
}

/** @deprecated Use MCP_ONE_CLICK_CATALOG filesystem entry. */
export const EXAMPLE_FILESYSTEM_MCP: Omit<McpServerConfig, 'id'> = {
  name: 'filesystem',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
  enabled: false,
};
