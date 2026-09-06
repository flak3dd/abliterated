/**
 * Client-side working-directory gate.
 * Abliterated's install folder is never a valid workspace; conversations start without one.
 */

export const APP_ROOT_REFUSED =
  'The Abliterated install folder cannot be a working directory. Pick a different folder to build in.';

export const WORKSPACE_REQUIRED =
  'Choose a working directory before chatting. Abliterated will not write into its own install folder.';

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

export function isUnsetWorkspace(path: string): boolean {
  const s = path.trim();
  return s === '' || s === '/workspace' || s === '.';
}

export function isInsideAppRoot(appRoot: string, target: string): boolean {
  const t = collapseDots(target);
  const a = collapseDots(appRoot);
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

/** File writes land in the connected working directory. Plan mode and install-dir stay blocked. Shell stays gated. */
export function shouldWriteWorkspaceFiles(opts: {
  planMode?: boolean;
  workspaceRoot?: string;
  appRoot?: string;
  connected?: boolean;
}): boolean {
  if (opts.planMode) return false;
  if (opts.connected === false) return false;
  return workspaceGate(opts.workspaceRoot || '', opts.appRoot || '').ok;
}
