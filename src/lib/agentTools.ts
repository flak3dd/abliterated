import { bridge } from './bridgeClient';
import { workspaceGate } from './workspaceGuard';
import { generateImage, imageResultToMarkdown } from './imageGen';
import { saveGeneratedImage } from './imageLibrary';
import { isDeadlyCommand } from './grokLayer';
import { isMcpToolName } from './mcpClient';
import {
  applyTodoToolArgs,
  canonicalizeToolName,
  formatTodoBlock,
  type TodoItem,
} from './agentHelpers';
import { formatSkillFile, similarSkillExists, slugifySkillId, toCatalogEntries } from './skills';
import { runWebSearch } from './webSearch';
import {
  TASK_GRAPH_PATH,
  applyTaskUpdateArgs,
  emptyTaskGraph,
  formatTaskGraphPrompt,
  parseTaskGraph,
  stringifyTaskGraph,
} from './taskGraph';
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
  /** Current session ToDo items (for todo merge). */
  todoItems?: TodoItem[];
  /** Persist ToDo checklist after a successful todo tool call. */
  onTodos?: (items: TodoItem[]) => void;
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

  const canonical = canonicalizeToolName(tool.name);
  const name = canonical as ToolType;
  if (canonical !== tool.name) {
    tool = { ...tool, name: canonical };
  }
  const allowed = enabledTools.includes(name) || name === 'todo' || name === 'task_read' || name === 'task_update';
  if (!allowed) {
    return denied(tool, `tool ${tool.name} is not enabled`);
  }

  const workspaceGateHit = workspaceGate(opts.workspaceRoot || bridge.currentRoot, bridge.currentAppRoot);
  const needsWorkspace =
    name === 'read_file' ||
    name === 'write_file' ||
    name === 'grep' ||
    name === 'glob' ||
    name === 'list_dir' ||
    name === 'file_outline' ||
    name === 'semantic_search' ||
    name === 'git_status' ||
    name === 'git_diff' ||
    name === 'git_commit' ||
    name === 'create_pr' ||
    name === 'checkpoint_save' ||
    name === 'checkpoint_restore' ||
    name === 'shell' ||
    name === 'verify' ||
    name === 'task_read' ||
    name === 'task_update';
  if (needsWorkspace && !workspaceGateHit.ok) {
    return err(tool, workspaceGateHit.message);
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

  if (name === 'write_file') {
    const file = toolArgString(tool.arguments, ['path', 'file', 'target']);
    const content = toolArgString(tool.arguments, ['content', 'text', 'body']);
    if (!file) return err(tool, 'missing path');
    if (content === '' && tool.arguments.content == null && tool.arguments.text == null && tool.arguments.body == null) {
      return err(tool, 'missing content');
    }
    const preview = file + '\n---\n' + content.slice(0, 4000);
    if (!autoAcceptEdits) {
      if (mode === 'headless') return softSkip(tool, 'write_file needs Auto-accept edits (headless)');
      return gated(tool, preview);
    }
    if (!bridge.connected) return disconnected(tool, preview, autoAcceptEdits, mode);
    try {
      await bridge.writeFile(file, content);
      return ok(tool, 'wrote ' + file + ' (' + content.length + ' chars)');
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

  if (name === 'verify') {
    const command = toolArgString(tool.arguments, ['command', 'cmd', 'script']);
    const payload = command || JSON.stringify(tool.arguments, null, 2);
    if (!command) return err(tool, 'missing command');
    if (isDeadlyCommand(command)) return err(tool, 'refused: deadly command');
    if (autoRunShell && bridge.connected) {
      try {
        const { out, code } = await runShellCapture(command);
        const result = `[verify] exit ${code}\n${out}${out && !out.endsWith('\n') ? '\n' : ''}`;
        return ok(tool, result);
      } catch (e) {
        return err(tool, e instanceof Error ? e.message : String(e));
      }
    }
    if (mode === 'headless') {
      if (!autoRunShell) return softSkip(tool, 'verify requires Auto-run shell (headless)');
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

  if (name === 'todo') {
    const next = applyTodoToolArgs(opts.todoItems || [], tool.arguments || {});
    if (!next.length) {
      return err(tool, 'todo: missing items (pass items/todos as strings or {text, done})');
    }
    opts.onTodos?.(next);
    return ok(tool, formatTodoBlock(next));
  }

  if (name === 'task_read') {
    if (!bridge.connected) return disconnected(tool, TASK_GRAPH_PATH, autoAcceptEdits, mode);
    try {
      const raw = await bridge.readFile(TASK_GRAPH_PATH);
      const graph = parseTaskGraph(raw) || emptyTaskGraph();
      return ok(tool, JSON.stringify(graph, null, 2));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found|enoent|no such file/i.test(msg)) {
        return ok(tool, JSON.stringify(emptyTaskGraph(), null, 2) + '\n(no file yet)');
      }
      return err(tool, msg);
    }
  }

  if (name === 'task_update') {
    if (!bridge.connected) return disconnected(tool, TASK_GRAPH_PATH, autoAcceptEdits, mode);
    try {
      let base = emptyTaskGraph();
      try {
        const raw = await bridge.readFile(TASK_GRAPH_PATH);
        base = parseTaskGraph(raw) || emptyTaskGraph();
      } catch {
        base = emptyTaskGraph();
      }
      const next = applyTaskUpdateArgs(base, tool.arguments || {});
      await bridge.writeFile(TASK_GRAPH_PATH, stringifyTaskGraph(next));
      return ok(tool, formatTaskGraphPrompt(next) || JSON.stringify(next, null, 2));
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }


  if (name === 'list_skills') {
    if (settings.skillsEnabled === false) return err(tool, 'skills disabled');
    if (!bridge.connected) return disconnected(tool, 'list_skills', autoAcceptEdits, mode);
    try {
      const skills = await bridge.listSkills();
      return ok(tool, JSON.stringify(skills.map((s) => ({ id: s.id, name: s.name, description: s.description, source: s.source })), null, 2));
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (name === 'read_skill') {
    if (settings.skillsEnabled === false) return err(tool, 'skills disabled');
    const skillId = toolArgString(tool.arguments, ['skill_id', 'id', 'slug', 'name']);
    if (!skillId) return err(tool, 'missing skill_id');
    if (!bridge.connected) return disconnected(tool, skillId, autoAcceptEdits, mode);
    try {
      const skill = await bridge.readSkill(skillId);
      const header = `# ${skill.name}\n\n_id: ${skill.id}_\n\n`;
      return ok(tool, `${header}${skill.body || ''}`);
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (name === 'suggest_skill') {
    if (settings.skillsEnabled === false) return err(tool, 'skills disabled');
    const nameArg = toolArgString(tool.arguments, ['name', 'title']);
    const desc = toolArgString(tool.arguments, ['description', 'when']);
    const body = toolArgString(tool.arguments, ['body', 'steps', 'content']) || '';
    const reason = toolArgString(tool.arguments, ['reason', 'why']) || '';
    if (!nameArg.trim()) return err(tool, 'missing name');
    if (!desc.trim()) return err(tool, 'missing description');
    let existingNote = '';
    if (bridge.connected) {
      try {
        const skills = await bridge.listSkills();
        const hit = similarSkillExists(toCatalogEntries(skills), nameArg, desc);
        if (hit) {
          existingNote = ` Similar skill already exists: ${hit.id} (${hit.name}). Do not write a duplicate.`;
        }
      } catch {
        /* ignore catalog miss */
      }
    }
    const proposal = {
      action: 'suggest_skill',
      name: nameArg.trim(),
      description: desc.trim(),
      body: body.trim() || '# Steps\n1. ...',
      reason: reason.trim() || undefined,
      id: slugifySkillId(nameArg),
      message:
        'Proposal only — not saved. Ask the user to confirm, then call write_skill.' + existingNote,
    };
    return ok(tool, JSON.stringify(proposal, null, 2));
  }

  if (name === 'write_skill') {
    if (settings.skillsEnabled === false) return err(tool, 'skills disabled');
    const nameArg = toolArgString(tool.arguments, ['name', 'title']);
    const desc = toolArgString(tool.arguments, ['description', 'when']);
    const body = toolArgString(tool.arguments, ['body', 'steps', 'content']);
    const scopeRaw = toolArgString(tool.arguments, ['scope']).toLowerCase();
    const scope = scopeRaw === 'user' || scopeRaw === 'global' ? 'user' : 'workspace';
    if (!nameArg.trim()) return err(tool, 'missing name');
    if (!desc.trim()) return err(tool, 'missing description');
    if (!body.trim()) return err(tool, 'missing body');
    try {
      formatSkillFile(nameArg, desc, body);
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
    // Conversational confirm happens before the model calls write_skill; execute when enabled.
    if (!bridge.connected) return disconnected(tool, nameArg, autoAcceptEdits, mode);
    try {
      const saved = await bridge.writeSkill({ name: nameArg, description: desc, body, scope });
      return ok(tool, JSON.stringify({ ok: true, id: saved.id, path: saved.path, source: saved.source }, null, 2));
    } catch (e) {
      return err(tool, e instanceof Error ? e.message : String(e));
    }
  }

  if (name === 'web_search') {
    const query = toolArgString(tool.arguments, ['query', 'q', 'search']);
    if (!query) return err(tool, 'missing query');
    const countRaw = tool.arguments.count ?? tool.arguments.limit ?? tool.arguments.n;
    const count = typeof countRaw === 'number' || typeof countRaw === 'string' ? Number(countRaw) : undefined;
    try {
      const text = await runWebSearch({
        query,
        count: Number.isFinite(count) ? count : undefined,
        braveKey: settings.webSearchBraveKey,
        searxUrl: settings.webSearchSearxUrl,
      });
      return ok(tool, text);
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
