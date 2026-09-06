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
const JSON_FENCE_LANGS = new Set(['json', 'javascript', 'js']);

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


function asArgsObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { raw };
    }
    return { raw };
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  return {};
}

function toolFromJsonEntry(entry: unknown): ParsedFakeTool | null {
  if (!entry || typeof entry !== 'object') return null;
  const o = entry as Record<string, unknown>;
  const fn = (o.function && typeof o.function === 'object' ? (o.function as Record<string, unknown>) : null);
  const nameRaw =
    (typeof o.name === 'string' && o.name) ||
    (fn && typeof fn.name === 'string' && fn.name) ||
    (typeof o.tool === 'string' && o.tool) ||
    '';
  const name = nameRaw.trim().toLowerCase();
  if (!name || NEVER_PARSE.has(name) || !SAFE_ALLOWLIST.has(name)) return null;
  const argsRaw = o.arguments ?? o.args ?? o.parameters ?? (fn ? fn.arguments ?? fn.parameters : undefined);
  const arguments_ = asArgsObject(argsRaw);
  // Normalize common arg shapes for allowlisted tools.
  if (name === 'list_dir' && !arguments_.path) arguments_.path = '.';
  if (name === 'git_status') return { name, arguments: {} };
  if ((name === 'read_file' || name === 'file_outline') && typeof arguments_.path !== 'string') return null;
  if (name === 'glob' && typeof arguments_.pattern !== 'string') return null;
  if (name === 'grep' && typeof arguments_.pattern !== 'string') return null;
  if ((name === 'semantic_search' || name === 'web_search') && typeof arguments_.query !== 'string') {
    const q = typeof arguments_.pattern === 'string' ? arguments_.pattern : typeof arguments_.q === 'string' ? arguments_.q : '';
    if (!q) return null;
    return { name, arguments: { query: q } };
  }
  if (name === 'web_fetch' && typeof arguments_.url !== 'string') return null;
  return { name, arguments: arguments_ };
}

function extractJsonFenceBodies(content: string): string[] {
  const bodies: string[] = [];
  const re = new RegExp(FENCE_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const lang = (m[1] || '').toLowerCase();
    if (!JSON_FENCE_LANGS.has(lang)) continue;
    bodies.push(m[2] || '');
  }
  return bodies;
}

/** True when content has a markdown JSON fence that looks like OpenAI-style tool_calls. */
export function looksLikeJsonToolCallFence(content: string): boolean {
  if (!content || !content.trim()) return false;
  for (const body of extractJsonFenceBodies(content)) {
    if (/"tool_calls"\s*:/i.test(body)) return true;
    if (/"name"\s*:\s*"[a-z_][a-z0-9_]*"/i.test(body) && /"arguments"\s*:/i.test(body)) return true;
  }
  // Bare JSON blob (no fence) that is mostly a tool_calls payload.
  const trimmed = content.trim();
  if (
    (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
    /"tool_calls"\s*:/i.test(trimmed) &&
    trimmed.length < 8000
  ) {
    return true;
  }
  return false;
}

function collectFromJsonBlob(blob: string, into: ParsedFakeTool[], seen: Set<string>): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(blob);
  } catch {
    // Try to extract a {...} / [...] slice if prose wraps JSON.
    const startObj = blob.indexOf('{');
    const startArr = blob.indexOf('[');
    let start = -1;
    if (startObj < 0) start = startArr;
    else if (startArr < 0) start = startObj;
    else start = Math.min(startObj, startArr);
    if (start < 0) return;
    const slice = blob.slice(start);
    try {
      parsed = JSON.parse(slice);
    } catch {
      return;
    }
  }
  const entries: unknown[] = [];
  if (Array.isArray(parsed)) {
    entries.push(...parsed);
  } else if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    if (Array.isArray(o.tool_calls)) entries.push(...o.tool_calls);
    else if (Array.isArray(o.tools)) entries.push(...o.tools);
    else if (typeof o.name === 'string') entries.push(o);
  }
  for (const entry of entries) {
    if (into.length >= MAX_FAKE_TOOLS) return;
    const tool = toolFromJsonEntry(entry);
    if (!tool) continue;
    const k = keyOf(tool);
    if (seen.has(k)) continue;
    seen.add(k);
    into.push(tool);
  }
}

/** Parse read-only-ish tools from markdown-fenced (or bare) JSON tool_calls payloads. */
export function parseJsonToolCallFence(content: string): ParsedFakeTool[] {
  if (!content || !content.trim()) return [];
  const out: ParsedFakeTool[] = [];
  const seen = new Set<string>();
  for (const body of extractJsonFenceBodies(content)) {
    collectFromJsonBlob(body, out, seen);
    if (out.length >= MAX_FAKE_TOOLS) break;
  }
  if (out.length < MAX_FAKE_TOOLS && looksLikeJsonToolCallFence(content)) {
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      collectFromJsonBlob(trimmed, out, seen);
    }
  }
  return out.slice(0, MAX_FAKE_TOOLS);
}

/** True if content looks like tool theater in markdown (bash/shell fences or bare tool lines). */
export function looksLikeFakeToolTheater(content: string): boolean {
  if (!content || !content.trim()) return false;
  if (looksLikeJsonToolCallFence(content)) return true;
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

  // Prefer JSON-fenced tool_calls (Qwen/theater) — parse into real allowlisted calls.
  for (const t of parseJsonToolCallFence(content)) {
    const k = keyOf(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= MAX_FAKE_TOOLS) return out;
  }

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
    'Tool recovery (one retry): Your last reply showed tools as markdown/JSON theater. ' +
    'Those do not execute. Call the real function tools now (API tools channel), or answer without fake tool JSON. ' +
    'Do not paste ```json tool_calls again.'
  );
}
