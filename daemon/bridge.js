#!/usr/bin/env node
/**
 * Abliterated local bridge.
 * Binds 127.0.0.1:17322 only. Confirm-gating lives in the UI.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { applyUnified, decodeBuffer, detectEol, encodeFileText, restoreEol } from './fsutil.js';
import { outlineFromText, MAX_OUTLINE_LINES, MAX_READ_FOR_OUTLINE } from './outline.js';
import { semanticSearch } from './semantic.js';
import { isInsideRoot as isInsideRootPath, matchGlob, skipDirentName, skipSearchName, toRel as toRelPath, walkFiles } from './search.js';
import { appRootRefuseMessage, isInsideAppRoot, resolveAppRoot } from './appRoot.js';
import * as mcp from './mcp.js';
import * as skills from './skills.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.ABLIT_PORT || 17322);
const APP_ROOT = resolveAppRoot();
let ROOT = path.resolve(process.env.ABLIT_ROOT || process.cwd());
const MAX_READ_BYTES = 8 * 1024 * 1024;
const MAX_GREP_MATCHES = 200;
const MAX_GREP_LINE = 200;
const MAX_GLOB_MATCHES = 500;
/** @type {Map<string, { encoding: string, eol: string, bom: boolean }>} */
const fileMeta = new Map();

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function sendHello(ws, runId) {
  const payload = {
    type: 'hello',
    root: ROOT,
    port: PORT,
    appRoot: APP_ROOT,
    workspaceOk: !isInsideAppRoot(APP_ROOT, ROOT),
  };
  if (runId) payload.runId = runId;
  send(ws, payload);
}

function assertNotAppInstall(target, action = 'path') {
  if (isInsideAppRoot(APP_ROOT, target)) {
    throw new Error(appRootRefuseMessage(action));
  }
}

function assertWorkspaceNotInstall(action = 'operation') {
  assertNotAppInstall(ROOT, action);
}

function isInsideRoot(target) {
  return isInsideRootPath(ROOT, target);
}

function toRel(abs) {
  return toRelPath(ROOT, abs);
}

function isDeadly(command) {
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

function isForbiddenGitMessage(message) {
  const m = String(message);
  const compact = m.toLowerCase().replace(/\s+/g, ' ');
  if (compact.includes('git config')) return true;
  if (compact.includes('core.hookspath')) return true;
  if (/\.git\/hooks/.test(compact)) return true;
  if (/GIT_(?:SEQUENCE_)?EDITOR/.test(m)) return true;
  if (compact.includes('update-index --')) return true;
  return false;
}

function resolveInside(relOrAbs) {
  if (!isInsideRoot(relOrAbs)) throw new Error('path escapes workspace root');
  const abs = path.resolve(ROOT, relOrAbs);
  if (!isInsideRoot(abs)) throw new Error('path escapes workspace root');
  return abs;
}

function handleExec(ws, msg) {
  const runId = msg.runId;
  const command = String(msg.command || '');
  if (!command.trim()) {
    send(ws, { runId, type: 'stderr', data: 'empty command\n' });
    send(ws, { runId, type: 'exit', code: 2 });
    return;
  }
  if (isDeadly(command)) {
    send(ws, { runId, type: 'stderr', data: 'refused: deadly command blocked by local daemon\n' });
    send(ws, { runId, type: 'exit', code: 126 });
    return;
  }
  try {
    assertWorkspaceNotInstall('exec');
  } catch (err) {
    send(ws, { runId, type: 'stderr', data: `${err instanceof Error ? err.message : String(err)}\n` });
    send(ws, { runId, type: 'exit', code: 126 });
    return;
  }
  const child = spawn(command, {
    cwd: ROOT,
    shell: true,
    env: { ...process.env, ABLIT_ROOT: ROOT },
  });
  child.stdout.on('data', (buf) => send(ws, { runId, type: 'stdout', data: buf.toString() }));
  child.stderr.on('data', (buf) => send(ws, { runId, type: 'stderr', data: buf.toString() }));
  child.on('error', (err) => {
    send(ws, { runId, type: 'stderr', data: String(err.message) + '\n' });
    send(ws, { runId, type: 'exit', code: 1 });
  });
  child.on('close', (code) => send(ws, { runId, type: 'exit', code: code ?? 1 }));
}

function gitEnv() {
  const env = { ...process.env, ABLIT_ROOT: ROOT, GIT_TERMINAL_PROMPT: '0' };
  delete env.GIT_EDITOR;
  delete env.GIT_SEQUENCE_EDITOR;
  delete env.GIT_ASKPASS;
  return env;
}

function runGit(args) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd: ROOT, env: gitEnv() });
    let out = '';
    let err = '';
    child.stdout.on('data', (buf) => {
      out += buf.toString();
    });
    child.stderr.on('data', (buf) => {
      err += buf.toString();
    });
    child.on('error', (e) => {
      resolve({ code: 1, out, err: (err ? `${err}\n` : '') + String(e.message) });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, out, err });
    });
  });
}

function parsePorcelain(text) {
  const lines = String(text || '').split('\n');
  let branch = '';
  const first = (lines[0] || '').trim();
  if (first.startsWith('## ')) {
    let rest = first.slice(3);
    rest = rest.split('...')[0];
    rest = rest.replace(/\s*\[.*$/, '').trim();
    if (rest === 'HEAD (no branch)') branch = 'HEAD';
    else branch = rest;
  }
  const body = lines.slice(1).filter((l) => l.length > 0);
  return {
    branch,
    dirty: body.length > 0,
    porcelain: body.join('\n'),
  };
}

async function readDisk(abs) {
  const buf = await readFile(abs);
  const decoded = decodeBuffer(buf);
  const eol = detectEol(decoded.text);
  fileMeta.set(abs, { encoding: decoded.encoding, eol, bom: decoded.bom });
  return { ...decoded, eol };
}

async function writeDisk(abs, text, encoding, eol, bom) {
  const restored = restoreEol(text, eol || '\n');
  await writeFile(abs, encodeFileText(restored, encoding || 'utf8', Boolean(bom)));
  fileMeta.set(abs, { encoding: encoding || 'utf8', eol: eol || '\n', bom: Boolean(bom) });
}

async function handlePatch(ws, msg) {
  const runId = msg.runId;
  const file = String(msg.file || '');
  const patch = String(msg.patch || '');
  try {
    if (!file) throw new Error('missing file');
    assertWorkspaceNotInstall('patch');
    const abs = resolveInside(file);
    assertNotAppInstall(abs, 'patch');
    await mkdir(path.dirname(abs), { recursive: true });
    let original = '';
    let encoding = 'utf8';
    let eol = '\n';
    let bom = false;
    try {
      const disk = await readDisk(abs);
      original = disk.text;
      encoding = disk.encoding;
      eol = disk.eol;
      bom = disk.bom;
    } catch {
      const prev = fileMeta.get(abs);
      if (prev) {
        encoding = prev.encoding;
        eol = prev.eol;
        bom = prev.bom;
      }
      original = '';
    }
    const next = applyUnified(original, patch);
    await writeDisk(abs, next, encoding, eol, bom);
    send(ws, { runId, status: 'ok' });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleWrite(ws, msg) {
  const runId = msg.runId;
  const file = String(msg.file || '');
  const content = String(msg.content ?? '');
  try {
    if (!file) throw new Error('missing file');
    assertWorkspaceNotInstall('write');
    const abs = resolveInside(file);
    assertNotAppInstall(abs, 'write');
    await mkdir(path.dirname(abs), { recursive: true });
    const prev = fileMeta.get(abs);
    const encoding = String(msg.encoding || prev?.encoding || 'utf8');
    const encNorm = encoding.toLowerCase();
    if (encNorm === 'base64') {
      await writeFile(abs, Buffer.from(content, 'base64'));
      fileMeta.set(abs, { encoding: 'base64', eol: '\n', bom: false });
      send(ws, { runId, status: 'ok' });
      return;
    }
    const eol = String(msg.eol || prev?.eol || detectEol(content) || '\n');
    const bom = prev ? prev.bom : false;
    await writeDisk(abs, content, encoding, eol, bom);
    send(ws, { runId, status: 'ok' });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleDelete(ws, msg) {
  const runId = msg.runId;
  const file = String(msg.file || msg.path || '');
  try {
    if (!file) throw new Error('missing file');
    assertWorkspaceNotInstall('delete');
    const abs = resolveInside(file);
    assertNotAppInstall(abs, 'delete');
    await unlink(abs);
    fileMeta.delete(abs);
    send(ws, { runId, status: 'ok' });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleSetRoot(ws, msg) {
  const runId = msg.runId;
  try {
    const raw = String(msg.path || '').trim();
    if (!raw) throw new Error('missing path');
    const resolved = path.resolve(raw);
    assertNotAppInstall(resolved, 'workspace');
    let st;
    try {
      st = await stat(resolved);
    } catch {
      throw new Error('directory not found');
    }
    if (!st.isDirectory()) throw new Error('not a directory');
    ROOT = resolved;
    send(ws, { runId, status: 'ok', root: ROOT, appRoot: APP_ROOT });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleLs(ws, msg) {
  const runId = msg.runId;
  try {
    const rel = String(msg.path || '.').trim() || '.';
    const abs = resolveInside(rel);
    const st = await stat(abs);
    if (!st.isDirectory()) throw new Error('not a directory');
    const names = await readdir(abs, { withFileTypes: true });
    const entries = [];
    for (const d of names) {
      if (skipDirentName(d.name)) continue;
      const childAbs = path.join(abs, d.name);
      entries.push({
        name: d.name,
        path: toRel(childAbs),
        dir: d.isDirectory(),
      });
    }
    entries.sort((a, b) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    send(ws, { runId, status: 'ok', entries });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleRead(ws, msg) {
  const runId = msg.runId;
  const file = String(msg.file || msg.path || '');
  try {
    if (!file) throw new Error('missing file');
    const abs = resolveInside(file);
    const st = await stat(abs);
    if (!st.isFile()) throw new Error('not a file');
    if (st.size > MAX_READ_BYTES) throw new Error('file too large');
    const wantEnc = String(msg.encoding || '').toLowerCase();
    if (wantEnc === 'base64') {
      const buf = await readFile(abs);
      send(ws, { runId, status: 'ok', content: buf.toString('base64'), encoding: 'base64' });
      return;
    }
    const disk = await readDisk(abs);
    send(ws, { runId, status: 'ok', content: disk.text, encoding: disk.encoding, eol: disk.eol });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

function compileGrepPattern(pattern) {
  try {
    return { type: 're', re: new RegExp(pattern) };
  } catch {
    return { type: 'sub', sub: pattern };
  }
}

function lineMatches(line, compiled) {
  if (compiled.type === 're') return compiled.re.test(line);
  return line.includes(compiled.sub);
}

function isBinaryBuf(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

async function handleGrep(ws, msg) {
  const runId = msg.runId;
  try {
    const pattern = String(msg.pattern ?? '');
    if (!pattern) throw new Error('missing pattern');
    const rel = String(msg.path || '.').trim() || '.';
    const abs = resolveInside(rel);
    const globPat = msg.glob != null && String(msg.glob).trim() ? String(msg.glob).trim() : '';
    let cap = Number(msg.maxMatches);
    if (!Number.isFinite(cap) || cap <= 0) cap = MAX_GREP_MATCHES;
    cap = Math.min(MAX_GREP_MATCHES, Math.floor(cap));

    const compiled = compileGrepPattern(pattern);
    const hits = [];
    let truncated = false;

    const grepFile = async (fileAbs) => {
      if (hits.length >= cap) {
        truncated = true;
        return true;
      }
      const relFile = toRel(fileAbs);
      if (globPat && !matchGlob(globPat, relFile)) return false;
      let st;
      try {
        st = await stat(fileAbs);
      } catch {
        return false;
      }
      if (!st.isFile() || st.size > MAX_READ_BYTES) return false;
      let buf;
      try {
        buf = await readFile(fileAbs);
      } catch {
        return false;
      }
      if (isBinaryBuf(buf)) return false;
      const text = buf.toString('utf8');
      const lines = text.split(/\r\n|\n|\r/);
      for (let i = 0; i < lines.length; i++) {
        if (hits.length >= cap) {
          truncated = true;
          return true;
        }
        const line = lines[i];
        if (!lineMatches(line, compiled)) continue;
        const clipped = line.length > MAX_GREP_LINE ? `${line.slice(0, MAX_GREP_LINE)}…` : line;
        hits.push(`${relFile}:${i + 1}:${clipped}`);
      }
      return false;
    };

    const st = await stat(abs);
    if (st.isFile()) {
      await grepFile(abs);
    } else if (st.isDirectory()) {
      await walkFiles(ROOT, abs, grepFile, { skipName: skipSearchName });
    } else {
      throw new Error('not a file or directory');
    }

    let content = hits.join('\n');
    if (truncated) content += `\n/* truncated at ${cap} matches */`;
    if (!content) content = 'no matches';
    send(ws, { runId, status: 'ok', content });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleGlob(ws, msg) {
  const runId = msg.runId;
  try {
    const pattern = String(msg.pattern || '').trim();
    if (!pattern) throw new Error('missing pattern');
    const matches = [];
    await walkFiles(
      ROOT,
      ROOT,
      async (fileAbs) => {
        if (matches.length >= MAX_GLOB_MATCHES) return true;
        const rel = toRel(fileAbs);
        if (matchGlob(pattern, rel)) matches.push(rel);
        return matches.length >= MAX_GLOB_MATCHES;
      },
      { skipName: skipSearchName },
    );
    const content = matches.length ? matches.join('\n') : 'no matches';
    send(ws, { runId, status: 'ok', content });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}


async function handleFileOutline(ws, msg) {
  const runId = msg.runId;
  try {
    const file = String(msg.file || msg.path || '').trim();
    if (!file) throw new Error('missing path');
    const abs = resolveInside(file);
    const st = await stat(abs);
    if (!st.isFile()) throw new Error('not a file');
    if (st.size > MAX_READ_FOR_OUTLINE) throw new Error('file too large');
    const disk = await readDisk(abs);
    const content = outlineFromText(toRel(abs), disk.text, MAX_OUTLINE_LINES);
    send(ws, { runId, status: 'ok', content });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleSemanticSearch(ws, msg) {
  const runId = msg.runId;
  try {
    const query = String(msg.query || msg.pattern || '').trim();
    if (!query) throw new Error('missing query');
    const content = await semanticSearch(ROOT, query, {
      path: msg.path,
      glob: msg.glob,
      maxSnippets: msg.maxSnippets ?? msg.maxMatches,
    });
    send(ws, { runId, status: 'ok', content });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleGitStatus(ws, msg) {
  const runId = msg.runId;
  try {
    const st = await runGit(['status', '--porcelain=v1', '-b']);
    const combined = `${st.out}${st.err}`;
    if (st.code !== 0) {
      const errText = combined.trim() || 'not a git repository';
      const text = /not a git repository/i.test(errText) ? 'not a git repository' : errText;
      send(ws, { runId, status: 'ok', branch: '', dirty: false, porcelain: '', text, content: text });
      return;
    }
    const parsed = parsePorcelain(st.out);
    if (!parsed.branch) {
      const br = await runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
      if (br.code === 0) parsed.branch = br.out.trim();
    }
    const text = `branch ${parsed.branch || '(unknown)'}${parsed.dirty ? ' dirty' : ' clean'}\n${st.out}`.trimEnd();
    send(ws, {
      runId,
      status: 'ok',
      branch: parsed.branch,
      dirty: parsed.dirty,
      porcelain: parsed.porcelain,
      text,
      content: text,
    });
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    send(ws, { runId, status: 'ok', branch: '', dirty: false, porcelain: '', text, content: text });
  }
}

async function handleGitCommit(ws, msg) {
  const runId = msg.runId;
  try {
    assertWorkspaceNotInstall('git_commit');
    const message = String(msg.message || '').trim();
    if (!message) throw new Error('empty commit message');
    if (isDeadly(message)) throw new Error('refused: deadly command blocked by local daemon');
    if (isForbiddenGitMessage(message)) throw new Error('refused: commit message looks like git config or hooks');
    const inside = await runGit(['rev-parse', '--is-inside-work-tree']);
    if (inside.code !== 0) throw new Error('not a git repository');

    let paths = [];
    if (Array.isArray(msg.paths)) paths = msg.paths.map((p) => String(p));
    else if (typeof msg.paths === 'string' && msg.paths.trim()) paths = [msg.paths.trim()];

    if (paths.length) {
      const rels = [];
      for (const p of paths) {
        const abs = resolveInside(p);
        assertNotAppInstall(abs, 'git_commit');
        rels.push(toRel(abs));
      }
      const add = await runGit(['add', '--', ...rels]);
      if (add.code !== 0) throw new Error((add.err || add.out || 'git add failed').trim());
    } else {
      const add = await runGit(['add', '-A', '.']);
      if (add.code !== 0) throw new Error((add.err || add.out || 'git add failed').trim());
    }

    const commit = await runGit(['commit', '-m', message]);
    if (commit.code !== 0) throw new Error((commit.err || commit.out || 'git commit failed').trim());
    const hash = await runGit(['rev-parse', 'HEAD']);
    const st = await runGit(['status', '--porcelain=v1', '-b']);
    const sha = hash.out.trim();
    const text = `committed ${sha}\n${st.out}`.trimEnd();
    send(ws, { runId, status: 'ok', hash: sha, content: text, text });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}


async function handleGitDiff(ws, msg) {
  const runId = msg.runId;
  try {
    const staged = Boolean(msg.staged);
    const filePath = String(msg.path || '').trim();
    const args = ['diff'];
    if (staged) args.push('--cached');
    if (filePath) {
      const abs = resolveInside(filePath);
      args.push('--', toRel(abs));
    }
    const st = await runGit(args);
    const text = `${st.out}${st.err}`.trimEnd() || '(empty diff)';
    if (st.code !== 0 && !st.out) throw new Error(text || 'git diff failed');
    send(ws, { runId, status: 'ok', content: text, text });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleCreatePr(ws, msg) {
  const runId = msg.runId;
  try {
    assertWorkspaceNotInstall('create_pr');
    const title = String(msg.title || '').trim();
    if (!title) throw new Error('empty PR title');
    const body = String(msg.body || '');
    const base = String(msg.base || '').trim();
    // Prefer gh when available
    const args = ['pr', 'create', '--title', title, '--body', body || title];
    if (base) args.push('--base', base);
    const result = await new Promise((resolve) => {
      const child = spawn('gh', args, { cwd: ROOT, env: process.env });
      let out = '';
      let err = '';
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { err += c; });
      child.on('error', (e) => resolve({ code: 127, out: '', err: e.message }));
      child.on('close', (code) => resolve({ code: code ?? 1, out, err }));
    });
    if (result.code === 127 || /not found|ENOENT/i.test(result.err)) {
      throw new Error('gh CLI not available on PATH');
    }
    if (result.code !== 0) throw new Error((result.err || result.out || 'gh pr create failed').trim());
    const text = (result.out || result.err).trim();
    send(ws, { runId, status: 'ok', content: text, text });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleCheckpointSave(ws, msg) {
  const runId = msg.runId;
  try {
    assertWorkspaceNotInstall('checkpoint_save');
    const label = String(msg.label || '').trim() || 'checkpoint';
    const id = `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const dir = path.join(ROOT, '.ablit', 'checkpoints', id);
    await mkdir(dir, { recursive: true });
    const unstaged = await runGit(['diff']);
    const staged = await runGit(['diff', '--cached']);
    const status = await runGit(['status', '--porcelain=v1', '-b']);
    const head = await runGit(['rev-parse', 'HEAD']);
    await writeFile(path.join(dir, 'unstaged.patch'), unstaged.out || '', 'utf8');
    await writeFile(path.join(dir, 'staged.patch'), staged.out || '', 'utf8');
    await writeFile(path.join(dir, 'status.txt'), status.out || '', 'utf8');
    await writeFile(
      path.join(dir, 'meta.json'),
      JSON.stringify({ id, label, head: (head.out || '').trim(), createdAt: Date.now() }, null, 2),
      'utf8',
    );
    const text = `saved checkpoint ${id} head=${(head.out || '').trim() || '(none)'} label=${label}`;
    send(ws, { runId, status: 'ok', id, content: text, text });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleCheckpointRestore(ws, msg) {
  const runId = msg.runId;
  try {
    assertWorkspaceNotInstall('checkpoint_restore');
    const id = String(msg.id || '').trim();
    if (!id) throw new Error('missing checkpoint id');
    if (id.includes('..') || id.includes('/') || id.includes('\\')) throw new Error('invalid checkpoint id');
    const dir = path.join(ROOT, '.ablit', 'checkpoints', id);
    const metaRaw = await readFile(path.join(dir, 'meta.json'), 'utf8');
    const unstaged = await readFile(path.join(dir, 'unstaged.patch'), 'utf8').catch(() => '');
    const staged = await readFile(path.join(dir, 'staged.patch'), 'utf8').catch(() => '');
    // Soft restore: apply patches with git apply --whitespace=nowarn (best-effort)
    let notes = [`restoring ${id}`];
    if (staged.trim()) {
      await writeFile(path.join(dir, '_restore_staged.patch'), staged, 'utf8');
      const child = await new Promise((resolve) => {
        const c = spawn('git', ['apply', '--cached', '--whitespace=nowarn', path.join(dir, '_restore_staged.patch')], {
          cwd: ROOT,
          env: process.env,
        });
        let out = '', err = '';
        c.stdout.on('data', (d) => { out += d; });
        c.stderr.on('data', (d) => { err += d; });
        c.on('close', (code) => resolve({ code, out, err }));
      });
      notes.push(`staged: exit ${child.code} ${(child.err || child.out).trim()}`.trim());
    }
    if (unstaged.trim()) {
      await writeFile(path.join(dir, '_restore_unstaged.patch'), unstaged, 'utf8');
      const child = await new Promise((resolve) => {
        const c = spawn('git', ['apply', '--whitespace=nowarn', path.join(dir, '_restore_unstaged.patch')], {
          cwd: ROOT,
          env: process.env,
        });
        let out = '', err = '';
        c.stdout.on('data', (d) => { out += d; });
        c.stderr.on('data', (d) => { err += d; });
        c.on('close', (code) => resolve({ code, out, err }));
      });
      notes.push(`unstaged: exit ${child.code} ${(child.err || child.out).trim()}`.trim());
    }
    notes.push(`meta ${metaRaw.slice(0, 200)}`);
    const text = notes.join('\n');
    send(ws, { runId, status: 'ok', content: text, text });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleCheckpointList(ws, msg) {
  const runId = msg.runId;
  try {
    const base = path.join(ROOT, '.ablit', 'checkpoints');
    let entries = [];
    try {
      entries = await readdir(base, { withFileTypes: true });
    } catch {
      send(ws, { runId, status: 'ok', checkpoints: [] });
      return;
    }
    const checkpoints = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = await readFile(path.join(base, entry.name, 'meta.json'), 'utf8');
        const meta = JSON.parse(raw);
        checkpoints.push({
          id: meta.id || entry.name,
          label: meta.label || '',
          head: meta.head || '',
          createdAt: Number(meta.createdAt) || 0,
        });
      } catch {
        // skip unreadable checkpoint dirs
      }
    }
    checkpoints.sort((a, b) => b.createdAt - a.createdAt);
    send(ws, { runId, status: 'ok', checkpoints });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}


async function handleListSkills(ws, msg) {
  const runId = msg.runId;
  try {
    const list = await skills.listSkills(APP_ROOT, ROOT);
    send(ws, { runId, status: 'ok', skills: list });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleReadSkill(ws, msg) {
  const runId = msg.runId;
  try {
    const skillId = String(msg.skill_id || msg.id || msg.skillId || '');
    const skill = await skills.readSkill(skillId, APP_ROOT, ROOT);
    send(ws, { runId, status: 'ok', skill });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleWriteSkill(ws, msg) {
  const runId = msg.runId;
  try {
    const skill = await skills.writeSkill(
      {
        name: String(msg.name || ''),
        description: String(msg.description || ''),
        body: String(msg.body || ''),
        scope: String(msg.scope || 'workspace'),
      },
      APP_ROOT,
      ROOT,
    );
    send(ws, { runId, status: 'ok', skill });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleMcpConnect(ws, msg) {
  const runId = msg.runId;
  try {
    assertWorkspaceNotInstall('mcp_connect');
    const result = await mcp.connect(
      { id: msg.id, name: msg.name, command: msg.command, args: msg.args, env: msg.env },
      ROOT,
    );
    send(ws, { runId, status: 'ok', tools: result.tools });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleMcpDisconnect(ws, msg) {
  const runId = msg.runId;
  try {
    await mcp.disconnect(msg.id);
    send(ws, { runId, status: 'ok' });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleMcpCallTool(ws, msg) {
  const runId = msg.runId;
  try {
    const content = await mcp.callTool(msg.id, msg.toolName || msg.name, msg.arguments || msg.args || {});
    send(ws, { runId, status: 'ok', content, text: content });
  } catch (err) {
    send(ws, { runId, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}


const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('abliterated-bridge localhost only\n');
});

function isLocalAddress(addr) {
  if (!addr) return false;
  const a = String(addr).replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1' || a === 'localhost';
}

const wss = new WebSocketServer({
  server,
  path: '/',
  verifyClient(info) {
    const addr = info.req.socket?.remoteAddress;
    if (!isLocalAddress(addr)) {
      console.warn(`[bridge] rejected non-localhost WS from ${addr}`);
      return false;
    }
    return true;
  },
});
wss.on('connection', (ws, req) => {
  const addr = req?.socket?.remoteAddress;
  if (!isLocalAddress(addr)) {
    console.warn(`[bridge] closing non-localhost connection from ${addr}`);
    try {
      ws.close(1008, 'localhost only');
    } catch {
      /* ignore */
    }
    return;
  }
  sendHello(ws);
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    const type = msg.type;
    if (type === 'ping') {
      send(ws, { type: 'pong' });
      return;
    }
    if (type === 'hello') {
      sendHello(ws, msg.runId);
      return;
    }
    if (type === 'set_root') {
      void handleSetRoot(ws, msg);
      return;
    }
    const needsWorkspace = type === 'ls' || type === 'read_file' || type === 'grep' || type === 'glob'
      || type === 'file_outline' || type === 'semantic_search' || type === 'git_status' || type === 'git_commit'
      || type === 'git_diff' || type === 'create_pr' || type === 'checkpoint_save' || type === 'checkpoint_restore'
      || type === 'checkpoint_list' || type === 'mcp_connect' || type === 'exec' || type === 'apply_patch'
      || type === 'write_file' || type === 'delete_file';
    if (needsWorkspace) {
      try {
        assertWorkspaceNotInstall(type);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        if (type === 'exec') {
          send(ws, { runId: msg.runId, type: 'stderr', data: `${error}\n` });
          send(ws, { runId: msg.runId, type: 'exit', code: 126 });
        } else {
          send(ws, { runId: msg.runId, status: 'error', error });
        }
        return;
      }
    }
    if (type === 'ls') {
      void handleLs(ws, msg);
      return;
    }
    if (type === 'read_file') {
      void handleRead(ws, msg);
      return;
    }
    if (type === 'grep') {
      void handleGrep(ws, msg);
      return;
    }
    if (type === 'glob') {
      void handleGlob(ws, msg);
      return;
    }
    if (type === 'file_outline') {
      void handleFileOutline(ws, msg);
      return;
    }
    if (type === 'semantic_search') {
      void handleSemanticSearch(ws, msg);
      return;
    }
    if (type === 'git_status') {
      void handleGitStatus(ws, msg);
      return;
    }
    if (type === 'git_commit') {
      void handleGitCommit(ws, msg);
      return;
    }
    if (type === 'git_diff') {
      void handleGitDiff(ws, msg);
      return;
    }
    if (type === 'create_pr') {
      void handleCreatePr(ws, msg);
      return;
    }
    if (type === 'checkpoint_save') {
      void handleCheckpointSave(ws, msg);
      return;
    }
    if (type === 'checkpoint_restore') {
      void handleCheckpointRestore(ws, msg);
      return;
    }
    if (type === 'checkpoint_list') {
      void handleCheckpointList(ws, msg);
      return;
    }
    if (type === 'list_skills') {
      void handleListSkills(ws, msg);
      return;
    }
    if (type === 'read_skill') {
      void handleReadSkill(ws, msg);
      return;
    }
    if (type === 'write_skill') {
      void handleWriteSkill(ws, msg);
      return;
    }
    if (type === 'mcp_connect') {
      void handleMcpConnect(ws, msg);
      return;
    }
    if (type === 'mcp_disconnect') {
      void handleMcpDisconnect(ws, msg);
      return;
    }
    if (type === 'mcp_call_tool') {
      void handleMcpCallTool(ws, msg);
      return;
    }

    if (type === 'exec') {
      handleExec(ws, msg);
      return;
    }
    if (type === 'apply_patch') {
      void handlePatch(ws, msg);
      return;
    }
    if (type === 'write_file') {
      void handleWrite(ws, msg);
      return;
    }
    if (type === 'delete_file') {
      void handleDelete(ws, msg);
      return;
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`abliterated bridge ws://${HOST}:${PORT} root=${ROOT} appRoot=${APP_ROOT}`);
});

let shuttingDown = false;
async function shutdownBridge() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await mcp.disconnectAll();
  } catch (err) {
    console.error('mcp.disconnectAll failed', err);
  }
  process.exit(0);
}
process.once('SIGINT', () => {
  void shutdownBridge();
});
process.once('SIGTERM', () => {
  void shutdownBridge();
});
process.once('beforeExit', () => {
  void shutdownBridge();
});
