import { hunkToPatch, parseUnifiedDiff } from './diffParser';
import { bridge } from './bridgeClient';

export type GrokEdit = {
  file: string;
  kind: 'patch' | 'write';
  patch?: string;
  content?: string;
};

export type GrokApplyResult = {
  file: string;
  kind: 'patch' | 'write';
  status: 'pending' | 'ok' | 'error';
  error?: string;
};

const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console']);
const DIFF_LANGS = new Set(['diff', 'patch', 'udiff']);
const FILE_HINT_RE = /^(?:\/\/|#|--|;)\s*(?:file:\s*)?(.+\S)\s*$/i;
/** Canonical whole-file marker: first line // <relative/path> even in non-JS. */
const SLASH_PATH_RE = /^\/\/\s*(?:file:\s*)?(\S(?:.*\S)?)\s*$/;
const APPLY_WINDOW_MS = 30_000;
const recentApply = new Map<string, number>();

export function normalizeGrokPath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^[ab]\//, '');
}

export function looksLikeDiff(code: string): boolean {
  const head = code.trimStart();
  return (
    head.startsWith('diff ') ||
    head.startsWith('--- ') ||
    head.startsWith('+++ ') ||
    head.startsWith('@@ ')
  );
}

export function looksLikeFilePath(raw: string): boolean {
  const s = raw.trim().replace(/^['"]|['"]$/g, '');
  if (!s) return false;
  if (s.includes('://')) return false;
  if (s.startsWith('!')) return false;
  if (SHELL_LANGS.has(s.toLowerCase()) || DIFF_LANGS.has(s.toLowerCase())) return false;
  if (/\s/.test(s) && !s.includes('/')) return false;
  if (/\s/.test(s)) return false;
  return s.includes('/') || /\.\w{1,10}$/.test(s);
}

/**
 * Client-side path jail. Treat as escape:
 * - Unix absolute that is not under workspace root
 * - Windows drive `^[A-Za-z]:\`
 * - UNC `\\` / `//`
 * - `..` segments that leave root
 *
 * parseGrokEdits('/etc/passwd' fence, '/workspace') → dropped
 * parseGrokEdits('src/../../etc/passwd', '/workspace') → dropped
 * isPathInsideRoot('src/foo.ts', '/workspace') → true
 */
export function isPathInsideRoot(file: string, root?: string): boolean {
  const raw = (file || '').trim();
  if (!raw) return false;
  const windowsAbs = /^[A-Za-z]:[\\/]/.test(raw);
  const unc = raw.startsWith('\\\\') || raw.startsWith('//');
  const unixAbs = raw.startsWith('/') && !windowsAbs;
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');

  if (unc) return false;

  if (windowsAbs || unixAbs) {
    const fr = root?.trim();
    if (!fr) return false;
    const fileN = norm(raw);
    const rootN = norm(fr);
    if (!rootN) return false;
    if (fileN === rootN) return true;
    if (!fileN.startsWith(rootN + '/')) return false;
    return !segmentLeavesRoot(fileN.slice(rootN.length + 1));
  }

  return !segmentLeavesRoot(norm(raw).replace(/^\.\//, ''));
}

function segmentLeavesRoot(rel: string): boolean {
  const parts = rel.split('/');
  let depth = 0;
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') {
      depth -= 1;
      if (depth < 0) return true;
    } else {
      depth += 1;
    }
  }
  return false;
}

export function isDeadlyCommand(command: string): boolean {
  const c = command.toLowerCase();
  const compact = c.replace(/\s+/g, ' ').trim();
  if (compact.includes('no-preserve-root')) return true;
  if (/mkfs(\.| )/.test(compact)) return true;
  if (/:\(\)\s*\{\s*:\|:/.test(command.replace(/\s+/g, ''))) return true;
  if (/\bdd\b/.test(compact) && compact.includes('of=/dev/')) return true;
  const rmRf = /\brm\s+(-[a-z]*r[a-z]*f|[a-z]*f[a-z]*r|-\S*\s+-\S*)\b/.test(compact);
  if (rmRf && /(\s\/\s|\s\/$| \/ \*| \/\*| \/home| \/etc| \/usr| \/var)/.test(` ${compact} `)) return true;
  if (/\brm\b/.test(compact) && compact.includes(' -rf ') && / (\*|\/)( |$)/.test(` ${compact} `)) return true;
  if (compact.includes('chmod -r 777 /') || compact.includes('chown -r ')) {
    if (compact.endsWith(' /') || compact.includes(' / ')) return true;
  }
  return false;
}

export function wasRecentlyApplied(file: string): boolean {
  const key = normalizeGrokPath(file);
  const prev = recentApply.get(key);
  return prev != null && Date.now() - prev < APPLY_WINDOW_MS;
}

export function noteFileApplied(file: string): void {
  recentApply.set(normalizeGrokPath(file), Date.now());
}

function parseFenceHeader(header: string): { lang: string; path: string } {
  const raw = header.trim();
  if (!raw) return { lang: '', path: '' };
  const colon = raw.match(/^([\w.+-]+)\s*:\s*(.+)$/);
  if (colon && looksLikeFilePath(colon[2])) {
    return { lang: colon[1].toLowerCase(), path: colon[2].trim() };
  }
  const parts = raw.split(/\s+/);
  const first = parts[0] || '';
  const rest = parts.slice(1).join(' ');
  if (rest && looksLikeFilePath(rest)) return { lang: first.toLowerCase(), path: rest };
  if (looksLikeFilePath(first) && parts.length === 1) return { lang: '', path: first };
  return { lang: first.toLowerCase(), path: '' };
}

function addPatch(patchesByFile: Map<string, string[]>, file: string, patch: string) {
  const key = file || 'workspace/patch.ts';
  const list = patchesByFile.get(key) ?? [];
  list.push(patch);
  patchesByFile.set(key, list);
}

function ingestDiff(code: string, defaultFile: string, patchesByFile: Map<string, string[]>) {
  const hunks = parseUnifiedDiff(code, defaultFile || 'workspace/patch.ts');
  for (const hunk of hunks) {
    addPatch(patchesByFile, hunk.file, hunkToPatch(hunk));
  }
}

function collectUnfencedDiffs(text: string, fenceSpans: Array<{ start: number; end: number }>): string[] {
  const parts: string[] = [];
  let i = 0;
  const spans = [...fenceSpans].sort((a, b) => a.start - b.start);
  for (const s of spans) {
    if (s.start > i) parts.push(text.slice(i, s.start));
    i = s.end;
  }
  if (i < text.length) parts.push(text.slice(i));

  const diffs: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (looksLikeDiff(trimmed)) {
      diffs.push(trimmed);
      continue;
    }
    const idx = trimmed.search(/(?:^|\n)(?:diff --git |--- )/);
    if (idx >= 0) {
      const slice = trimmed.slice(idx).replace(/^\n/, '');
      if (looksLikeDiff(slice)) diffs.push(slice);
    }
  }
  return diffs;
}

function lineBeforeFence(text: string, index: number): string {
  const before = text.slice(0, index);
  const m = before.match(/(?:^|\n)([^\n]+)\n[ \t]*$/);
  return m ? m[1].trim() : '';
}

function commentPathFromBody(code: string): { path: string; body: string } {
  const lines = code.split('\n');
  const first = lines[0] ?? '';
  const slash = first.match(SLASH_PATH_RE);
  const slashPath = slash?.[1]?.trim() ?? '';
  if (slashPath && looksLikeFilePath(slashPath)) {
    return { path: slashPath, body: lines.slice(1).join('\n') };
  }
  const hint = first.match(FILE_HINT_RE);
  const hinted = hint?.[1]?.trim() ?? '';
  if (hinted && looksLikeFilePath(hinted)) {
    return { path: hinted, body: lines.slice(1).join('\n') };
  }
  return { path: '', body: code };
}

function filterEscapes(edits: GrokEdit[], root?: string): GrokEdit[] {
  return edits.filter((e) => isPathInsideRoot(e.file, root));
}

/**
 * Parse model output into file edits.
 *
 * Protocol: ```bash is the runnable fence (also parse shell/sh/zsh/console).
 * Whole-file first line is // <relative/path> even in non-JS.
 * Diffs use --- a/<path> +++ b/<path>; multiple files may share one ```diff fence.
 * Absolute paths outside the workspace are dropped.
 * Comment-path example (audit `// src/ping.ts` inside ```ts):
 * ```ts
 * // src/ping.ts
 * export const ping = 1
 * ```
 * → write src/ping.ts (hint line stripped)
 *
 * Line-before-fence:
 * src/foo.ts
 * ```ts
 * ...
 * ```
 *
 * Path-escape drop (root=/workspace):
 * ```ts /etc/passwd
 * root:x
 * ```
 * → omitted from the returned list (applyGrokEdits also records `path escape blocked`)
 */
export function parseGrokEdits(text: string, root?: string): GrokEdit[] {
  const patchesByFile = new Map<string, string[]>();
  const writes: GrokEdit[] = [];
  const fenceSpans: Array<{ start: number; end: number }> = [];
  const fenceRe = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let pendingPath = '';

  while ((match = fenceRe.exec(text)) !== null) {
    fenceSpans.push({ start: match.index, end: match.index + match[0].length });
    const { lang, path: headerPath } = parseFenceHeader(match[1] || '');
    const code = match[2].replace(/\n$/, '');
    const isShell = SHELL_LANGS.has(lang);
    if (isShell) {
      pendingPath = '';
      continue;
    }

    const beforeRaw = lineBeforeFence(text, match.index);
    const beforePath = beforeRaw && looksLikeFilePath(beforeRaw) ? beforeRaw : '';
    const hinted = commentPathFromBody(code);
    const filePath = headerPath || hinted.path || beforePath || pendingPath;
    const body = hinted.path ? hinted.body : code;
    const isDiff = DIFF_LANGS.has(lang) || looksLikeDiff(body) || looksLikeDiff(code);

    if (filePath && !body.trim() && !DIFF_LANGS.has(lang) && !looksLikeDiff(code)) {
      pendingPath = filePath;
      continue;
    }

    if (isDiff) {
      ingestDiff(looksLikeDiff(body) ? body : code, filePath, patchesByFile);
      pendingPath = '';
      continue;
    }

    if (filePath && looksLikeFilePath(filePath)) {
      writes.push({ file: normalizeGrokPath(filePath), kind: 'write', content: body });
    }
    pendingPath = '';
  }

  for (const chunk of collectUnfencedDiffs(text, fenceSpans)) {
    ingestDiff(chunk, pendingPath || 'workspace/patch.ts', patchesByFile);
  }

  const covered = new Set([...patchesByFile.keys()].map(normalizeGrokPath));
  const patchEdits: GrokEdit[] = [];
  for (const [file, patches] of patchesByFile) {
    patchEdits.push({ file, kind: 'patch', patch: patches.join('\n') });
  }
  const writeEdits = writes.filter((w) => !covered.has(normalizeGrokPath(w.file)));
  return filterEscapes([...patchEdits, ...writeEdits], root);
}

export async function applyGrokEdits(
  edits: GrokEdit[],
  opts: { autoAccept: boolean; root?: string },
): Promise<GrokApplyResult[]> {
  const root = opts.root || bridge.currentRoot;
  const results: GrokApplyResult[] = [];

  for (const edit of edits) {
    if (!isPathInsideRoot(edit.file, root)) {
      results.push({ file: edit.file, kind: edit.kind, status: 'error', error: 'path escape blocked' });
      continue;
    }
    if (!opts.autoAccept) {
      results.push({ file: edit.file, kind: edit.kind, status: 'pending' });
      continue;
    }
    if (!bridge.connected) {
      results.push({ file: edit.file, kind: edit.kind, status: 'error', error: 'bridge disconnected' });
      continue;
    }
    try {
      if (edit.kind === 'patch') {
        const ok = await bridge.applyPatch(edit.file, edit.patch || '');
        if (ok) noteFileApplied(edit.file);
        results.push(
          ok
            ? { file: edit.file, kind: edit.kind, status: 'ok' }
            : { file: edit.file, kind: edit.kind, status: 'error', error: 'apply failed' },
        );
      } else {
        const ok = await bridge.writeFile(edit.file, edit.content || '');
        if (ok) noteFileApplied(edit.file);
        results.push(
          ok
            ? { file: edit.file, kind: edit.kind, status: 'ok' }
            : { file: edit.file, kind: edit.kind, status: 'error', error: 'write failed' },
        );
      }
    } catch (err) {
      results.push({
        file: edit.file,
        kind: edit.kind,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

export function formatGrokStatus(
  results: GrokApplyResult[] | undefined,
  autoAccept: boolean,
  connected: boolean,
): string {
  const mode = autoAccept ? 'auto-accept on' : 'auto-accept off';
  const bits = [`Grok Bot · ${mode}`];
  if (!connected) bits.push('bridge down');
  if (!results || results.length === 0) return bits.join(' · ');
  const applied = results.filter((r) => r.status === 'ok').map((r) => r.file);
  const pending = results.filter((r) => r.status === 'pending');
  const errors = results.filter((r) => r.status === 'error');
  if (applied.length) bits.push(`applied ${applied.join(', ')}`);
  if (pending.length) bits.push(`pending ${pending.length} edits`);
  if (errors.length && connected) {
    const disc = errors.some((e) => e.error === 'bridge disconnected');
    const escape = errors.some((e) => e.error === 'path escape blocked');
    bits.push(disc ? 'bridge down' : escape ? 'path escape blocked' : `error ${errors[0].file}`);
  } else if (errors.length && !connected) {
    /* already noted */
  }
  return bits.join(' · ');
}
