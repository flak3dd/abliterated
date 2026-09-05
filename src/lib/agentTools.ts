import { bridge } from './bridgeClient';
import { generateImage, imageResultToMarkdown } from './imageGen';
import { saveGeneratedImage } from './imageLibrary';
import { isDeadlyCommand } from './grokLayer';
import { isMcpToolName } from './mcpClient';
import type { ClientSettings, ToolCallPayload, ToolCallStatus, ToolType } from '../types';

export function toolArgString(args: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

export function asStringList(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string' && v.trim()) return [v];
  return undefined;
}

export type AgentToolMode = 'interactive' | 'headless';

export type ExecuteAgentToolOpts = {
  enabledTools: readonly ToolType[];
  autoAcceptEdits: boolean;
  autoRunShell: boolean;
  settings: ClientSettings;
  workspaceRoot: string;
  mode: AgentToolMode;
  onGitMaybeChanged?: () => void;
  /** Prefix checkpoint_save labels so parallel runs stay attributable (e.g. job id). */
  checkpointNamespace?: string;
  /** Execute namespaced mcp__server__tool calls. */
  executeMcpTool?: (name: string, args: Record<string, unknown>) => Promise<string>;
};

export type ExecuteAgentToolResult = {
  content: string;
  status: ToolCallStatus;
  executed: boolean;
  tool: ToolCallPayload;
};

function ok(tool: ToolCallPayload, content: string): ExecuteAgentToolResult {
  const next = { ...tool, status: 'executed' as const, result: content };
  return { content, status: 'executed', executed: true, tool: next };
}

function err(tool: ToolCallPayload, content: string): ExecuteAgentToolResult {
  const next = { ...tool, status: 'error' as const, result: content };
  return { content, status: 'error', executed: true, tool: next };
}

function denied(tool: ToolCallPayload, content: string): ExecuteAgentToolResult {
  const next = { ...tool, status: 'denied' as const, result: content };
  return { content, status: 'denied', executed: false, tool: next };
}

function gated(tool: ToolCallPayload, content: string): ExecuteAgentToolResult {
  const next = { ...tool, status: 'allowed' as const };
  return { content, status: 'allowed', executed: false, tool: next };
}

function softSkip(tool: ToolCallPayload, reason: string): ExecuteAgentToolResult {
  const content = `skipped: ${reason}`;
  const next = { ...tool, status: 'executed' as const, result: content };
  return { content, status: 'executed', executed: true, tool: next };
}

function disconnected(
  tool: ToolCallPayload,
  fallback: string,
  autoAcceptEdits: boolean,
  mode: AgentToolMode,
): ExecuteAgentToolResult {
  if (mode === 'headless' || autoAcceptEdits) {
    return err(tool, 'bridge disconnected');
  }
  return gated(tool, fallback);
}

async function runShellCapture(command: string): Promise<{ out: string; code: number }> {
  let out = '';
  const code = await bridge.runCommand(command, (chunk) => {
    out += chunk;
  });
  return { out, code };
}

/**
 * Shared tool execution for ChatScreen (interactive) and Jobs runner (headless).
 * Headless soft-skips UI-gated tools so the agent loop can continue.
 */
export async function executeAgentTool(
  tool: ToolCallPayload,
  opts: ExecuteAgentToolOpts,
): Promise<ExecuteAgentToolResult> {
  const { mode, autoAcceptEdits, autoRunShell, settings, enabledTools } = opts;

  if (isMcpToolName(tool.name)) {
    if (!opts.executeMcpTool) {
      return err(tool, 'MCP not available');
    }
    try {
      const content = await opts.executeMcpTool(tool.name, tool.arguments);
      return ok(tool, content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(tool, msg);
    }
  }

  const name = tool.name as ToolType;
  const allowed = enabledTools.includes(name);
  if (!allowed) {
    return denied(tool, `tool ${tool.name} is not enabled`);
  }

  if (name === 'read_file') {
    const file = toolArgString(tool.arguments, ['path', 'file', 'target']);
    if (!file) return err(tool, 'missing path');
    if (!bridge.connected) return disconnected(tool, file, autoAcceptEdits, mode);
    try {
      return ok(tool, await bridge.readFile(file));
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (name === 'grep') {
    const pattern = toolArgString(tool.arguments, ['pattern']);
    if (!pattern) return err(tool, 'missing pattern');
    if (!bridge.connected) return disconnected(tool, pattern, autoAcceptEdits, mode);
    try {
      const pathArg = toolArgString(tool.arguments, ['path']);
      const globArg = toolArgString(tool.arguments, ['glob']);
      return ok(
        tool,
        await bridge.grep(pattern, { path: pathArg || undefined, glob: globArg || undefined }),
      );
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (name === 'glob') {
    const pattern = toolArgString(tool.arguments, ['pattern']);
    if (!pattern) return err(tool, 'missing pattern');
    if (!bridge.connected) return disconnected(tool, pattern, autoAcceptEdits, mode);
    try {
      return ok(tool, await bridge.glob(pattern));
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (name === 'list_dir') {
    const dirPath = toolArgString(tool.arguments, ['path', 'dir', 'directory']) || '.';
    if (!bridge.connected) return disconnected(tool, dirPath, autoAcceptEdits, mode);
    try {
      const entries = await bridge.listDir(dirPath);
      const content =
        entries.length === 0 ? '(empty)' : entries.map((e) => `${e.dir ? 'd' : 'f'}\t${e.path}`).join('\n');
      return ok(tool, content);
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (name === 'file_outline') {
    const file = toolArgString(tool.arguments, ['path', 'file', 'target']);
    if (!file) return err(tool, 'missing path');
    if (!bridge.connected) return disconnected(tool, file, autoAcceptEdits, mode);
    try {
      return ok(tool, await bridge.fileOutline(file));
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (name === 'semantic_search') {
    const query = toolArgString(tool.arguments, ['query', 'pattern', 'q']);
    if (!query) return err(tool, 'missing query');
    if (!bridge.connected) return disconnected(tool, query, autoAcceptEdits, mode);
    try {
      const pathArg = toolArgString(tool.arguments, ['path']);
      const globArg = toolArgString(tool.arguments, ['glob']);
      return ok(
        tool,
        await bridge.semanticSearch(query, { path: pathArg || undefined, glob: globArg || undefined }),
      );
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (name === 'git_status') {
    if (!bridge.connected) return disconnected(tool, 'git_status', autoAcceptEdits, mode);
    try {
      const gs = await bridge.gitStatus();
      return ok(tool, gs.text);
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (name === 'git_diff') {
    if (!bridge.connected) return disconnected(tool, 'git_diff', autoAcceptEdits, mode);
    try {
      const staged = tool.arguments.staged === true || toolArgString(tool.arguments, ['staged']) === 'true';
      const pathArg = toolArgString(tool.arguments, ['path', 'file']);
      return ok(tool, await bridge.gitDiff({ staged, path: pathArg || undefined }));
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (name === 'git_commit') {
    const commitMsg = toolArgString(tool.arguments, ['message', 'msg']);
    const paths = asStringList(tool.arguments.paths);
    const preview = commitMsg || JSON.stringify(tool.arguments, null, 2);
    if (!commitMsg.trim()) return err(tool, 'empty commit message');
    if (!autoAcceptEdits) {
      if (mode === 'headless') return softSkip(tool, 'git_commit needs Auto-accept edits (headless)');
      return gated(tool, preview);
    }
    if (!bridge.connected) return disconnected(tool, preview, autoAcceptEdits, mode);
    try {
      const content = await bridge.gitCommit(commitMsg, paths);
      opts.onGitMaybeChanged?.();
      return ok(tool, content);
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (name === 'create_pr') {
    const title = toolArgString(tool.arguments, ['title']);
    const body = toolArgString(tool.arguments, ['body', 'description']) || '';
    const base = toolArgString(tool.arguments, ['base', 'baseBranch']) || undefined;
    const preview = title || JSON.stringify(tool.arguments, null, 2);
    if (!title.trim()) return err(tool, 'empty PR title');
    if (!autoAcceptEdits) {
      if (mode === 'headless') return softSkip(tool, 'create_pr needs Auto-accept edits (headless)');
      return gated(tool, preview);
    }
    if (!bridge.connected) return disconnected(tool, preview, autoAcceptEdits, mode);
    try {
      const content = await bridge.createPr({ title, body, base });
      opts.onGitMaybeChanged?.();
      return ok(tool, content);
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (name === 'checkpoint_save') {
    if (!bridge.connected) return disconnected(tool, 'checkpoint_save', autoAcceptEdits, mode);
    try {
      const rawLabel = toolArgString(tool.arguments, ['label', 'name', 'message']) || 'checkpoint';
      const label = opts.checkpointNamespace ? `${opts.checkpointNamespace}: ${rawLabel}` : rawLabel;
      return ok(tool, await bridge.checkpointSave(label));
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (name === 'checkpoint_restore') {
    if (!bridge.connected) return disconnected(tool, 'checkpoint_restore', autoAcceptEdits, mode);
    const id = toolArgString(tool.arguments, ['id', 'checkpoint', 'name']);
    if (!id) return err(tool, 'missing checkpoint id');
    if (!autoAcceptEdits) {
      if (mode === 'headless') return softSkip(tool, 'checkpoint_restore needs Auto-accept edits (headless)');
      return gated(tool, id);
    }
    try {
      const content = await bridge.checkpointRestore(id);
      opts.onGitMaybeChanged?.();
      return ok(tool, content);
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (name === 'shell') {
    const command = toolArgString(tool.arguments, ['command', 'cmd', 'script']);
    const payload = command || JSON.stringify(tool.arguments, null, 2);
    if (autoRunShell && bridge.connected && command && !isDeadlyCommand(command)) {
      try {
        const { out, code } = await runShellCapture(command);
        const result = `${out}${out && !out.endsWith('\n') ? '\n' : ''}exit ${code}`;
        return ok(tool, result);
      } catch (e) {
        return err(tool, e instanceof Error ? e.message : String(e));
      }
    }
    if (mode === 'headless') {
      if (!command) return err(tool, 'missing command');
      if (isDeadlyCommand(command)) return err(tool, 'refused: deadly command');
      if (!autoRunShell) return softSkip(tool, 'shell requires Auto-run shell (headless)');
      if (!bridge.connected) return err(tool, 'bridge disconnected');
    }
    return gated(tool, payload);
  }

  if (name === 'generate_image') {
    const prompt = toolArgString(tool.arguments, ['prompt', 'text', 'description']);
    const size = toolArgString(tool.arguments, ['size']) || '1024x1024';
    if (!prompt) return err(tool, 'missing prompt');
    if (!settings.imageGenEnabled) {
      return err(tool, 'Image generation disabled. Enable in Images tab (spark-image/).');
    }
    try {
      const result = await generateImage({ settings, prompt, size });
      if (result.b64 || result.url) {
        try {
          await saveGeneratedImage({
            prompt,
            size,
            model: settings.imageModel || 'abliterated-flux-klein',
            b64: result.b64,
            url: result.url,
          });
        } catch {
          /* library save is best-effort for chat tool */
        }
      }
      return ok(tool, imageResultToMarkdown(result, prompt));
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (name === 'web_fetch') {
    const url = toolArgString(tool.arguments, ['url']);
    if (!url) return err(tool, 'missing url');
    try {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error('invalid url');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('only http(s) urls are allowed');
      }
      const host = parsed.hostname.toLowerCase();
      if (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '0.0.0.0' || host === '[::1]') {
        throw new Error('refused: local address');
      }
      const res = await fetch(parsed.toString(), { redirect: 'follow' });
      const text = await res.text();
      const clipped = text.length > 48_000 ? `${text.slice(0, 48_000)}\n/* truncated */` : text;
      return ok(tool, `HTTP ${res.status}\n${clipped}`);
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (mode === 'headless') {
    return softSkip(tool, `unsupported or gated tool ${tool.name}`);
  }
  return gated(tool, JSON.stringify(tool.arguments, null, 2));
}
