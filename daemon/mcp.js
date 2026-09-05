import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** @type {Map<string, any>} */
const sessions = new Map();

const INIT_TIMEOUT_MS = 20000;
const STDERR_CAP = 4096;

function writeMessage(proc, msg) {
  // Modern MCP SDK (stdio) uses newline-delimited JSON.
  proc.stdin.write(JSON.stringify(msg) + '\n');
}

function parseMessages(session) {
  const out = [];
  while (true) {
    const buf = session.buf;
    if (!buf.length) break;

    // Content-Length framing (legacy / some servers)
    const head = buf.slice(0, Math.min(buf.length, 64)).toString('utf8');
    if (/^Content-Length\s*:/i.test(head)) {
      const headerEnd = buf.indexOf('\r\n\r\n');
      if (headerEnd < 0) break;
      const header = buf.slice(0, headerEnd).toString('utf8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        session.buf = buf.slice(headerEnd + 4);
        continue;
      }
      const len = Number(match[1]);
      const start = headerEnd + 4;
      if (buf.length < start + len) break;
      const body = buf.slice(start, start + len).toString('utf8');
      session.buf = buf.slice(start + len);
      try {
        out.push(JSON.parse(body));
      } catch {
        /* ignore */
      }
      continue;
    }

    // Newline-delimited JSON (current MCP SDK StdioServerTransport)
    const nl = buf.indexOf('\n');
    if (nl < 0) break;
    const line = buf.slice(0, nl).toString('utf8').replace(/\r$/, '');
    session.buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* ignore */
    }
  }
  return out;
}

function onData(session, chunk) {
  session.buf = Buffer.concat([session.buf, Buffer.from(chunk)]);
  for (const msg of parseMessages(session)) {
    if (msg.id != null && session.waiters.has(msg.id)) {
      const w = session.waiters.get(msg.id);
      session.waiters.delete(msg.id);
      if (msg.error) w.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else w.resolve(msg.result);
    }
  }
}

function appendStderr(session, chunk) {
  const next = Buffer.concat([session.stderrBuf || Buffer.alloc(0), Buffer.from(chunk)]);
  session.stderrBuf = next.length > STDERR_CAP ? next.slice(next.length - STDERR_CAP) : next;
}

function stderrTail(session) {
  const t = (session.stderrBuf || Buffer.alloc(0)).toString('utf8').trim();
  return t;
}

function withStderr(session, message) {
  const tail = stderrTail(session);
  return tail ? message + '\nstderr: ' + tail : message;
}

function killProcessGroup(proc) {
  if (!proc) return;
  const pid = proc.pid;
  if (pid && pid > 0) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      /* not a process group leader or already gone */
    }
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  }
  try {
    if (!proc.killed) proc.kill('SIGKILL');
  } catch {
    /* ignore */
  }
  // Ensure direct pid kill even if ChildProcess handle is stale
  if (pid && pid > 0) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

function request(session, method, params, timeoutMs) {
  const ms = timeoutMs == null ? INIT_TIMEOUT_MS : timeoutMs;
  const id = session.nextId++;
  return new Promise((resolve, reject) => {
    session.waiters.set(id, { resolve: resolve, reject: reject });
    try {
      writeMessage(session.proc, { jsonrpc: '2.0', id: id, method: method, params: params });
    } catch (err) {
      session.waiters.delete(id);
      reject(err);
      return;
    }
    setTimeout(() => {
      if (session.waiters.has(id)) {
        session.waiters.delete(id);
        reject(new Error(withStderr(session, 'MCP timeout: ' + method)));
      }
    }, ms);
  });
}

function isNpxCommand(command) {
  const base = path.basename(String(command || ''));
  return base === 'npx' || base === 'npx.cmd';
}

function parseNpxPackageArgs(args) {
  const a = Array.isArray(args) ? args.map(String) : [];
  let i = 0;
  while (i < a.length && (a[i] === '-y' || a[i] === '--yes' || a[i] === '--')) i++;
  if (i >= a.length) return null;
  const pkg = a[i];
  if (!pkg || pkg.startsWith('-')) return null;
  return { pkg: pkg, rest: a.slice(i + 1) };
}

function packageDirName(pkgSpec) {
  if (pkgSpec.startsWith('@')) {
    const at = pkgSpec.indexOf('@', 1);
    return at > 0 ? pkgSpec.slice(0, at) : pkgSpec;
  }
  const at = pkgSpec.indexOf('@');
  return at > 0 ? pkgSpec.slice(0, at) : pkgSpec;
}

function binNameFromPackage(pkgName) {
  const base = pkgName.includes('/') ? pkgName.split('/').pop() : pkgName;
  if (base && base.startsWith('server-')) return 'mcp-' + base;
  return base || pkgName;
}
function resolveBinFromPkgJson(pkgRoot) {
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
    const bin = pj.bin;
    if (!bin) return null;
    if (typeof bin === 'string') return path.resolve(pkgRoot, bin);
    if (typeof bin === 'object') {
      const keys = Object.keys(bin);
      if (!keys.length) return null;
      const prefer = keys.find(function (k) { return k.startsWith('mcp-'); }) || keys[0];
      return path.resolve(pkgRoot, bin[prefer]);
    }
  } catch (e) { /* ignore */ }
  return null;
}

function tryResolveNpxCacheEntry(pkgSpec) {
  const pkgName = packageDirName(pkgSpec);
  var entries = [];
  const npxRoot = path.join(os.homedir(), Buffer.from('Lm5wbQ==','base64').toString(), Buffer.from('X25weA==','base64').toString());
  try {
    entries = fs.readdirSync(npxRoot);
  } catch (e) {
    return null;
  }
  entries = entries
    .map(function (e) {
      try {
        const full = path.join(npxRoot, e);
        const st = fs.statSync(full);
        return { name: e, full: full, mtime: st.mtimeMs };
      } catch (err) {
        return null;
      }
    })
    .filter(Boolean)
    .sort(function (a, b) { return b.mtime - a.mtime; });

  for (var ei = 0; ei < entries.length; ei++) {
    const ent = entries[ei];
    const pkgRoot = path.join.apply(path, [ent.full, 'node_modules'].concat(pkgName.split('/')));
    if (!fs.existsSync(pkgRoot)) continue;

    const fromBinField = resolveBinFromPkgJson(pkgRoot);
    if (fromBinField && fs.existsSync(fromBinField)) return fromBinField;

    const distIndex = path.join(pkgRoot, 'dist', 'index.js');
    if (fs.existsSync(distIndex)) return distIndex;

    const binGuess = binNameFromPackage(pkgName);
    const shim = path.join(ent.full, 'node_modules', '.bin', binGuess);
    if (fs.existsSync(shim)) {
      try {
        const real = fs.realpathSync(shim);
        if (real.endsWith('.js') || real.endsWith('.mjs') || real.endsWith('.cjs')) return real;
      } catch (err) { /* ignore */ }
      if (fromBinField) return fromBinField;
    }
  }
  return null;
}

function resolveCmd(command, args) {
  if (!isNpxCommand(command)) {
    return { command: command, args: args, viaNpx: false };
  }
  const parsed = parseNpxPackageArgs(args);
  if (!parsed) {
    return { command: command, args: args, viaNpx: true };
  }
  const script = tryResolveNpxCacheEntry(parsed.pkg);
  if (script) {
    const nodeBin = process.execPath || 'node';
    return { command: nodeBin, args: [script].concat(parsed.rest), viaNpx: false };
  }
  return { command: command, args: args, viaNpx: true };
}

function failConnect(id, session, err) {
  if (session && session.proc) killProcessGroup(session.proc);
  sessions.delete(String(id));
  if (session && session.waiters) {
    for (const w of session.waiters.values()) {
      try {
        w.reject(err instanceof Error ? err : new Error(String(err)));
      } catch (e) { /* ignore */ }
    }
    session.waiters.clear();
  }
  const msg = err instanceof Error ? err.message : String(err);
  throw new Error(session ? withStderr(session, msg) : msg);
}

export async function connect(cfg, cwd) {
  const id = String(cfg.id || '');
  if (!id) throw new Error('mcp id required');
  if (sessions.has(id)) {
    await disconnect(id);
  }
  const rawCommand = String(cfg.command || '').trim();
  if (!rawCommand) throw new Error('mcp command required');
  const rawArgs = Array.isArray(cfg.args) ? cfg.args.map(String) : [];
  const resolved = resolveCmd(rawCommand, rawArgs);
  const env = {
    ...process.env,
    ...(cfg.env && typeof cfg.env === 'object' ? cfg.env : {}),
  };
  if (resolved.viaNpx) {
    env.npm_config_loglevel = 'silent';
    env.npm_config_progress = 'false';
    env.NO_COLOR = '1';
  }
  let proc;
  try {
    proc = spawn(resolved.command, resolved.args, {
      cwd: cwd || process.cwd(),
      env: env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }

  const session = {
    proc: proc,
    buf: Buffer.alloc(0),
    stderrBuf: Buffer.alloc(0),
    waiters: new Map(),
    nextId: 1,
    name: String(cfg.name || id),
    spawnCmd: resolved.command,
    spawnArgs: resolved.args,
  };
  let spawnError = null;
  proc.on('error', (err) => {
    spawnError = err;
    const msg = withStderr(session, err && err.code === 'ENOENT'
      ? ('MCP spawn failed (ENOENT): ' + resolved.command)
      : ('MCP spawn failed: ' + (err && err.message ? err.message : String(err))));
    for (const w of session.waiters.values()) w.reject(new Error(msg));
    session.waiters.clear();
    sessions.delete(id);
    killProcessGroup(proc);
  });
  proc.stdout.on('data', (c) => onData(session, c));
  proc.stderr.on('data', (c) => appendStderr(session, c));
  proc.on('exit', () => {
    sessions.delete(id);
    const msg = withStderr(session, 'MCP process exited');
    for (const w of session.waiters.values()) w.reject(new Error(msg));
    session.waiters.clear();
  });

  sessions.set(id, session);

  if (spawnError) {
    failConnect(id, session, spawnError);
  }
  try {
    await request(session, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'abliterated-bridge', version: '1.0.0' },
    }, INIT_TIMEOUT_MS);
    try {
      writeMessage(session.proc, { jsonrpc: '2.0', method: 'notifications/initialized' });
    } catch (e) { /* ignore */ }
    const listed = await request(session, 'tools/list', {}, INIT_TIMEOUT_MS);
    const tools = Array.isArray(listed && listed.tools) ? listed.tools : [];
    return {
      tools: tools.map((t) => ({
        name: String(t.name || ''),
        description: t.description ? String(t.description) : undefined,
        inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : undefined,
      })),
    };
  } catch (err) {
    failConnect(id, session, err);
  }
}

export async function disconnect(id) {
  const key = String(id);
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  const proc = session.proc;
  const pid = proc && proc.pid;
  try {
    if (proc && proc.stdin) proc.stdin.end();
  } catch (e) { /* ignore */ }
  killProcessGroup(proc);
  if (pid && pid > 0) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (e) { /* already gone */ }
  }
  for (const w of session.waiters.values()) {
    try {
      w.reject(new Error('MCP disconnected'));
    } catch (e) { /* ignore */ }
  }
  session.waiters.clear();
}

export async function disconnectAll() {
  const ids = Array.from(sessions.keys());
  await Promise.all(ids.map((sid) => disconnect(sid)));
}

export async function callTool(id, toolName, args) {
  const session = sessions.get(String(id));
  if (!session) throw new Error('MCP server not connected');
  const result = await request(session, 'tools/call', {
    name: String(toolName),
    arguments: args && typeof args === 'object' ? args : {},
  }, 30000);
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result.content)) {
    return result.content
      .map((c) => (typeof c.text === 'string' ? c.text : JSON.stringify(c)))
      .join('\n');
  }
  return JSON.stringify(result);
}
