export type ParsedFakeTool = { name: string; arguments: Record<string, unknown> };

/** Safe read-only tools we may synthesize from theater text. */
const SAFE_ALLOWLIST = new Set([
  'list_dir',
  'glob',
  'grep',
  'read_file',
  'file_outline',
  'semantic_search',
  'git_status',
  'git_diff',
  'web_fetch',
  'web_search',
  'list_skills',
  'read_skill',
  'suggest_skill',
]);

/** Write / gated / MCP — never auto-parse into executable tool calls. */
const NEVER_PARSE = new Set([
  'shell',
  'git_commit',
  'create_pr',
  'checkpoint_save',
  'checkpoint_restore',
  'generate_image',
  'write_file',
  'apply_diff',
  'delete_file',
  'edit_file',
  'write_skill',
]);

const DISCOVERY_SHELL = /\b(ls|tree|cat|find|dir|ll)\b/;
const MAX_FAKE_TOOLS = 6;
const FENCE_OPEN = String.fromCharCode(96,96,96);
const FENCE_RE = new RegExp(FENCE_OPEN + '([a-zA-Z0-9_-]*)\\s*\\n?([\\s\\S]*?)' + FENCE_OPEN, 'g');
const FENCE_LANGS = new Set(['', 'bash', 'shell', 'sh', 'zsh', 'console', 'text']);

function unquote(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith('`') && t.endsWith('`'))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function stripInlineComment(line: string): string {
  return line.replace(/(^|\s)#.*$/, '$1').replace(/(^|\s)\/\/\s.*$/, '$1').trim();
}

function keyOf(t: ParsedFakeTool): string {
  return `${t.name}\0${JSON.stringify(t.arguments)}`;
}

function parseOneLine(rawLine: string): ParsedFakeTool | null {
  let line = stripInlineComment(rawLine);
  if (!line || line.startsWith('#')) return null;
  line = line.replace(/^\$\s+/, '').replace(/^>\s+/, '').trim();
  if (!line) return null;

  const callParen = line.match(
    /^([a-z_][a-z0-9_]*)\s*\(\s*(?:([`"']?)([^\`"')]*?)\2)?\s*\)\s*$/i,
  );
  if (callParen) {
    const name = callParen[1].toLowerCase();
    if (NEVER_PARSE.has(name) || !SAFE_ALLOWLIST.has(name)) return null;
    const arg = (callParen[3] || '').trim();
    return mapTool(name, arg ? [arg] : []);
  }

  const parts = line.match(/^([a-z_][a-z0-9_]*)(?:\s+(.+))?$/i);
  if (!parts) return null;
  const name = parts[1].toLowerCase();
  if (NEVER_PARSE.has(name) || !SAFE_ALLOWLIST.has(name)) return null;
  const rest = (parts[2] || '').trim();
  const args = rest ? tokenizeArgs(rest) : [];
  return mapTool(name, args);
}

function tokenizeArgs(rest: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out.map(unquote).filter(Boolean);
}

function mapTool(name: string, args: string[]): ParsedFakeTool | null {
  switch (name) {
    case 'list_dir': {
      const path = args[0] && args[0] !== '.' ? args[0] : '.';
      return { name: 'list_dir', arguments: { path } };
    }
    case 'git_status':
      return { name: 'git_status', arguments: {} };
    case 'git_diff': {
      const arguments_: Record<string, unknown> = {};
      for (const a of args) {
        if (a === '--staged' || a === 'staged' || a === '--cached') arguments_.staged = true;
        else if (!arguments_.path) arguments_.path = a;
      }
      return { name: 'git_diff', arguments: arguments_ };
    }
    case 'glob': {
      const pattern = args[0];
      if (!pattern) return null;
      return { name: 'glob', arguments: { pattern } };
    }
    case 'grep': {
      if (!args.length) return null;
      if (args.length === 1) return { name: 'grep', arguments: { pattern: args[0] } };
      const a0 = args[0];
      const a1 = args[1];
      if (/[\\/]|\.\w{1,8}$/.test(a0) && !/[\\/]/.test(a1)) {
        return { name: 'grep', arguments: { path: a0, pattern: a1 } };
      }
      return { name: 'grep', arguments: { pattern: a0, path: a1 } };
    }
    case 'read_file': {
      const path = args[0];
      if (!path) return null;
      return { name: 'read_file', arguments: { path } };
    }
    case 'file_outline': {
      const path = args[0];
      if (!path) return null;
      return { name: 'file_outline', arguments: { path } };
    }
    case 'semantic_search': {
      const query = args.join(' ').trim();
      if (!query) return null;
      return { name: 'semantic_search', arguments: { query } };
    }
    case 'web_fetch': {
      const url = args[0];
      if (!url || !/^https?:\/\//i.test(url)) return null;
      return { name: 'web_fetch', arguments: { url } };
    }
    case 'web_search': {
      const query = args.join(' ').trim();
      if (!query) return null;
      return { name: 'web_search', arguments: { query } };
    }
    default:
      return null;
  }
}

function extractFenceBodies(content: string): string[] {
  const bodies: string[] = [];
  const re = new RegExp(FENCE_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const lang = (m[1] || '').toLowerCase();
    if (!FENCE_LANGS.has(lang)) continue;
    bodies.push(m[2] || '');
  }
  return bodies;
}

function contentWithoutFences(content: string): string {
  return content.replace(new RegExp(FENCE_RE.source, 'g'), '\n');
}

function collectFromText(text: string, into: ParsedFakeTool[], seen: Set<string>): void {
  for (const raw of text.split(/\n/)) {
    if (into.length >= MAX_FAKE_TOOLS) return;
    const parsed = parseOneLine(raw);
    if (!parsed) continue;
    const k = keyOf(parsed);
    if (seen.has(k)) continue;
    seen.add(k);
    into.push(parsed);
  }
}

/** True if content looks like tool theater in markdown (bash/shell fences or bare tool lines). */
export function looksLikeFakeToolTheater(content: string): boolean {
  if (!content || !content.trim()) return false;
  const fences = extractFenceBodies(content);
  const promptRe = new RegExp('^\\' + String.fromCharCode(36) + '\\s+');
  for (const body of fences) {
    if (DISCOVERY_SHELL.test(body)) return true;
    for (const raw of body.split(/\n/)) {
      const line = stripInlineComment(raw).replace(promptRe, '').trim();
      if (!line) continue;
      const nameMatch = line.match(/^([a-z_][a-z0-9_]*)\b/i);
      if (!nameMatch) continue;
      const name = nameMatch[1].toLowerCase();
      if (SAFE_ALLOWLIST.has(name) || NEVER_PARSE.has(name)) return true;
    }
  }
  const outside = contentWithoutFences(content);
  for (const raw of outside.split(/\n/)) {
    const line = stripInlineComment(raw).replace(promptRe, '').trim();
    if (!line) continue;
    const nameMatch = line.match(/^([a-z_][a-z0-9_]*)(?:\s|\(|$)/i);
    if (!nameMatch) continue;
    const name = nameMatch[1].toLowerCase();
    if (SAFE_ALLOWLIST.has(name) || NEVER_PARSE.has(name)) return true;
  }
  return false;
}

/** Parse safe read-only fake invocations from assistant content. Never return write/gated tools. */
export function parseFakeToolCalls(content: string): ParsedFakeTool[] {
  if (!content || !content.trim()) return [];
  const out: ParsedFakeTool[] = [];
  const seen = new Set<string>();

  for (const body of extractFenceBodies(content)) {
    collectFromText(body, out, seen);
    if (out.length >= MAX_FAKE_TOOLS) break;
  }

  if (out.length < MAX_FAKE_TOOLS) {
    collectFromText(contentWithoutFences(content), out, seen);
  }

  return out.slice(0, MAX_FAKE_TOOLS);
}


/** Short system/user nudge for retry when theater is present but nothing safe to parse. */
export function buildFakeToolNudge(): string {
  return (
    'Tool recovery: Your last reply put IDE tool names inside markdown fences or bare lines. ' +
    'Those do not execute. Emit real OpenAI function tool_calls via the API tools channel. ' +
    'Use the API tools channel instead.'
  );
}
