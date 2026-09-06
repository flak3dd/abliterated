/**
 * MemPalace CLI adapter for the localhost bridge.
 * Resolves `mempalace` / uvx / python -m and runs search, wake-up, status, save, init.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const MISSING_CLI =
  'MemPalace CLI not found. Settings → MemPalace → Install, or run: uv tool install mempalace';

export const DEFAULT_ROOM = 'abliterated-chat';
export const DEFAULT_PALACE = path.join(os.homedir(), '.mempalace', 'palace');

const SEARCH_TIMEOUT_MS = 60_000;
const WAKE_TIMEOUT_MS = 60_000;
const STATUS_TIMEOUT_MS = 45_000;
const SAVE_TIMEOUT_MS = 180_000;
const INIT_TIMEOUT_MS = 180_000;
const INSTALL_TIMEOUT_MS = 300_000;
const MAX_BUFFER = 2 * 1024 * 1024;
const MAX_CONTENT = 24_000;
const MAX_WAKE = 2_400;

/** @type {{ cmd: string, prefix: string[] } | null | undefined} */
let cachedLauncher;

export function resetLauncherCache() {
  cachedLauncher = undefined;
}

export function sanitizePalaceName(raw, fallback = 'workspace') {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return s || fallback;
}

export function wingFromRoot(root) {
  const base = path.basename(String(root || '').trim());
  return sanitizePalaceName(base, 'workspace');
}

export function clipText(text, max) {
  const t = String(text || '');
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n/* truncated */`;
}

export function formatWakePrompt(text) {
  const body = clipText(String(text || '').trim(), MAX_WAKE);
  if (!body) return '';
  return [
    '## MemPalace wake-up (verbatim memory)',
    'Search-before-answer for people, projects, and past decisions. Call memory_search before guessing.',
    'Do not echo this block unless asked.',
    '',
    body,
  ].join('\n');
}

/** Probe PATH / uv / python for a MemPalace launcher. Cached. */
export async function resolveLauncher() {
  if (cachedLauncher !== undefined) return cachedLauncher;
  const envBin = String(process.env.ABLIT_MEMPALACE_BIN || '').trim();
  const candidates = [];
  if (envBin) candidates.push({ cmd: envBin, prefix: [] });
  candidates.push({ cmd: 'mempalace', prefix: [] });
  candidates.push({ cmd: 'python3', prefix: ['-m', 'mempalace'] });
  candidates.push({ cmd: 'python', prefix: ['-m', 'mempalace'] });

  for (const c of candidates) {
    try {
      await execFileAsync(c.cmd, [...c.prefix, '--help'], {
        timeout: 12_000,
        maxBuffer: 256 * 1024,
        windowsHide: true,
      });
      cachedLauncher = c;
      return c;
    } catch (err) {
      const code = err && typeof err === 'object' ? err.code : '';
      if (code === 'ENOENT') continue;
      const stderr = err && typeof err === 'object' ? String(err.stderr || '') : '';
      const msg = `${err instanceof Error ? err.message : String(err)}\n${stderr}`;
      if (/ModuleNotFoundError|No module named ['"]mempalace['"]/i.test(msg)) continue;
      if (/not found|cannot find/i.test(msg) && /mempalace/i.test(msg)) continue;
      cachedLauncher = c;
      return c;
    }
  }
  cachedLauncher = null;
  return null;
}

async function runCli(args, opts = {}) {
  const launcher = await resolveLauncher();
  if (!launcher) {
    const err = new Error(MISSING_CLI);
    err.code = 'MEMPALACE_MISSING';
    throw err;
  }
  const timeout = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : SEARCH_TIMEOUT_MS;
  const env = { ...process.env };
  const palace = String(opts.palacePath || '').trim();
  if (palace) env.MEMPALACE_PALACE_PATH = palace;
  const { stdout, stderr } = await execFileAsync(launcher.cmd, [...launcher.prefix, ...args], {
    timeout,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    env,
    cwd: opts.cwd || os.homedir(),
  });
  const out = String(stdout || '').trim();
  const err = String(stderr || '').trim();
  return { stdout: out, stderr: err, combined: [out, err].filter(Boolean).join('\n') };
}

export async function mempalaceWhich() {
  const launcher = await resolveLauncher();
  if (!launcher) return { ok: false, error: MISSING_CLI, cmd: '', prefix: [] };
  return {
    ok: true,
    cmd: launcher.cmd,
    prefix: launcher.prefix,
    display: [launcher.cmd, ...launcher.prefix].join(' ').trim(),
  };
}

export async function mempalaceStatus(opts = {}) {
  const { combined } = await runCli(['status'], {
    palacePath: opts.palacePath,
    timeoutMs: STATUS_TIMEOUT_MS,
  });
  return combined || '(empty status)';
}

export async function mempalaceWake(opts = {}) {
  const args = ['wake-up'];
  const wing = String(opts.wing || '').trim();
  if (wing) args.push('--wing', sanitizePalaceName(wing));
  const { combined } = await runCli(args, {
    palacePath: opts.palacePath,
    timeoutMs: WAKE_TIMEOUT_MS,
  });
  return combined || '';
}

export async function mempalaceSearch(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('missing query');
  const args = ['search', q];
  const wing = String(opts.wing || '').trim();
  const room = String(opts.room || '').trim();
  const n = Number(opts.results);
  if (wing) args.push('--wing', sanitizePalaceName(wing));
  if (room) args.push('--room', sanitizePalaceName(room, 'room'));
  if (Number.isFinite(n) && n > 0) args.push('--results', String(Math.min(20, Math.max(1, Math.floor(n)))));
  const { combined } = await runCli(args, {
    palacePath: opts.palacePath,
    timeoutMs: SEARCH_TIMEOUT_MS,
  });
  return combined || '(no results)';
}

export async function mempalaceSave(content, opts = {}) {
  const body = clipText(String(content || '').trim(), MAX_CONTENT);
  if (!body) throw new Error('missing content');
  const wing = sanitizePalaceName(opts.wing || 'workspace');
  const room = sanitizePalaceName(opts.room || DEFAULT_ROOM, DEFAULT_ROOM);
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'ablit-mempalace-'));
  try {
    const file = path.join(tmp, `${room}.md`);
    const md = `# ${wing} / ${room}\n\n${body}\n`;
    await writeFile(file, md, 'utf8');
    const args = ['mine', tmp, '--wing', wing, '--limit', '8'];
    const { combined } = await runCli(args, {
      palacePath: opts.palacePath,
      timeoutMs: SAVE_TIMEOUT_MS,
    });
    return combined || `filed into ${wing}/${room}`;
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

export async function mempalaceInit(projectDir, opts = {}) {
  const dir = String(projectDir || '').trim();
  if (!dir) throw new Error('missing project directory');
  const args = ['init', dir, '--yes', '--no-llm'];
  const { combined } = await runCli(args, {
    palacePath: opts.palacePath,
    timeoutMs: INIT_TIMEOUT_MS,
    cwd: dir,
  });
  return combined || `initialized palace from ${dir}`;
}

export async function mempalaceInstall() {
  resetLauncherCache();
  try {
    const { stdout, stderr } = await execFileAsync('uv', ['tool', 'install', 'mempalace'], {
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    });
    resetLauncherCache();
    const which = await mempalaceWhich();
    return {
      ok: which.ok,
      output: [String(stdout || '').trim(), String(stderr || '').trim()].filter(Boolean).join('\n'),
      which,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`uv tool install mempalace failed: ${msg}`);
  }
}

export function mcpServerSpec(palacePath) {
  const env = {};
  const palace = String(palacePath || '').trim();
  if (palace) env.MEMPALACE_PALACE_PATH = palace;
  return {
    name: 'mempalace',
    command: 'uvx',
    args: ['--from', 'mempalace', 'python', '-m', 'mempalace.mcp_server'],
    env,
  };
}
