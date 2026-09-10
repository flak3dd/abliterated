/**
 * Client-side working-directory gate.
 * Abliterated's install folder is never a valid workspace; conversations start without one.
 */

export const APP_ROOT_REFUSED =
  'The Abliterated install folder cannot be a working directory. Pick a different folder to build in.';

export const WORKSPACE_REQUIRED =
  'Choose a working directory before chatting. Abliterated will not write into its own install folder.';

export const BRIDGE_RESTARTING =
  'Bridge restarting — writes are blocked until the localhost daemon says hello (ws://127.0.0.1:17322).';

export type WorkspaceGateReason = 'ok' | 'empty' | 'placeholder' | 'app_root';

export type WorkspaceGate = {
  ok: boolean;
  reason: WorkspaceGateReason;
  message: string;
};

export function normalizeFsPath(p: string): string {
  return p.trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

export function collapseDots(p: string): string {
  const raw = normalizeFsPath(p);
  const abs = raw.startsWith('/');
  const parts = raw.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length) out.pop();
      continue;
    }
    out.push(part);
  }
  const joined = out.join('/');
  if (abs) return `/${joined}`;
  return joined;
}

/**
 * Canonicalize a path for reliable cross-platform and symlink-resilient comparison.
 * Collapses dots, normalizes slashes, and strips macOS /private prefix for /tmp, /var, /etc.
 */
export function canonicalizePath(p: string): string {
  if (!p) return '';
  let collapsed = collapseDots(p);
  // macOS symlink aliases: /tmp -> /private/tmp, /var -> /private/var, /etc -> /private/etc
  if (collapsed.startsWith('/private/tmp')) {
    collapsed = collapsed.slice('/private'.length);
  } else if (collapsed.startsWith('/private/var')) {
    collapsed = collapsed.slice('/private'.length);
  } else if (collapsed.startsWith('/private/etc')) {
    collapsed = collapsed.slice('/private'.length);
  }
  return collapsed;
}

/**
 * Check if two filesystem paths refer to the same location, ignoring case and macOS /private symlinks.
 */
export function isSamePath(a: string, b: string): boolean {
  const ca = canonicalizePath(a).toLowerCase();
  const cb = canonicalizePath(b).toLowerCase();
  return ca === cb;
}

/**
 * Check if a path is located in a temporary/scratch directory that should not be
 * automatically adopted as a persistent workspace root.
 */
export function isTemporaryPath(p: string): boolean {
  if (!p || typeof p !== 'string') return false;
  const c = canonicalizePath(p).toLowerCase();
  if (c === '/tmp' || c.startsWith('/tmp/')) return true;
  if (c === '/var/folders' || c.startsWith('/var/folders/')) return true;
  // Windows temp paths
  if (/[\\/]temp([\\/]|$)/i.test(p) || /[\\/]appdata[\\/]local[\\/]temp([\\/]|$)/i.test(p)) return true;
  return false;
}

export function isUnsetWorkspace(path: string): boolean {
  const s = path.trim();
  return s === '' || s === '/workspace' || s === '.';
}

export function isInsideAppRoot(appRoot: string, target: string): boolean {
  const t = canonicalizePath(target);
  const a = canonicalizePath(appRoot);
  if (!t || !a) return false;
  const tCmp = t.toLowerCase();
  const aCmp = a.toLowerCase();
  return tCmp === aCmp || tCmp.startsWith(`${aCmp}/`);
}

export function joinRoot(root: string, file: string): string {
  const f = file.trim();
  if (!f) return collapseDots(root);
  if (f.startsWith('/') || /^[A-Za-z]:[\\/]/.test(f) || f.startsWith('\\\\')) {
    return collapseDots(f);
  }
  const r = collapseDots(root);
  const rel = f.replace(/\\/g, '/').replace(/^\.\//, '');
  return collapseDots(r ? `${r}/${rel}` : rel);
}

export function isPathInsideAppRoot(file: string, workspaceRoot: string, appRoot: string): boolean {
  if (!appRoot.trim()) return false;
  return isInsideAppRoot(appRoot, joinRoot(workspaceRoot, file));
}

export function workspaceGate(root: string, appRoot = ''): WorkspaceGate {
  if (isUnsetWorkspace(root)) {
    return { ok: false, reason: 'empty', message: WORKSPACE_REQUIRED };
  }
  if (appRoot && isInsideAppRoot(appRoot, root)) {
    return { ok: false, reason: 'app_root', message: APP_ROOT_REFUSED };
  }
  return { ok: true, reason: 'ok', message: '' };
}

/**
 * Directory the localhost bridge will actually write into.
 * Prefer the connected daemon root over a stale UI path; never the install folder.
 */
export function connectedBridgeWriteRoot(opts: {
  workspaceRoot?: string;
  appRoot?: string;
  bridgeRoot?: string;
}): string {
  const app = opts.appRoot || '';
  for (const cand of [opts.bridgeRoot, opts.workspaceRoot]) {
    const p = (cand || '').trim();
    if (p && workspaceGate(p, app).ok) return p;
  }
  return '';
}

/** File writes land in the connected working directory. Plan mode and install-dir stay blocked. Shell stays gated. */
export function shouldWriteWorkspaceFiles(opts: {
  planMode?: boolean;
  workspaceRoot?: string;
  appRoot?: string;
  connected?: boolean;
  bridgeRoot?: string;
}): boolean {
  if (opts.planMode) return false;
  if (opts.connected === false) return false;
  const root = connectedBridgeWriteRoot({
    workspaceRoot: opts.workspaceRoot,
    appRoot: opts.appRoot,
    bridgeRoot: opts.bridgeRoot,
  });
  return workspaceGate(root, opts.appRoot || '').ok;
}
