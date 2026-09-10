/**
 * Path-level write locks for multi-agent / parallel Jobs.
 * Exact relative paths only (v1) — no directory locking.
 */

export type WriteLockOwner = {
  owner: string;
  nodeId: string;
  at: number;
};

export type WriteLockTable = Record<string, WriteLockOwner>;

/** Normalize to a relative posix-ish path key. */
export function normalizeLockPath(p: string): string {
  let s = String(p || '').trim().replace(/\\/g, '/');
  if (!s) return '';
  // strip leading ./ and collapse //
  s = s.replace(/^\.\//, '').replace(/\/+/g, '/');
  // deny absolute / drive roots as lock keys — require relative
  if (s.startsWith('/') || /^[a-zA-Z]:\//.test(s)) {
    const parts = s.split('/').filter(Boolean);
    // keep last meaningful segments if absolute slipped in
    s = parts.slice(-4).join('/');
  }
  return s;
}

export function isPathLocked(
  table: WriteLockTable,
  path: string,
  exceptOwner?: string,
): WriteLockOwner | null {
  const key = normalizeLockPath(path);
  if (!key) return null;
  const hit = table[key];
  if (!hit) return null;
  if (exceptOwner && hit.owner === exceptOwner) return null;
  return hit;
}

export function claimWritePath(
  table: WriteLockTable,
  path: string,
  owner: string,
  nodeId: string,
): { ok: boolean; table: WriteLockTable; reason?: string; key?: string } {
  const key = normalizeLockPath(path);
  if (!key) return { ok: false, table, reason: 'empty path' };
  const existing = table[key];
  if (existing && existing.owner !== owner) {
    return {
      ok: false,
      table,
      key,
      reason: `path locked by ${existing.owner} (node ${existing.nodeId})`,
    };
  }
  return {
    ok: true,
    key,
    table: {
      ...table,
      [key]: { owner, nodeId, at: Date.now() },
    },
  };
}

export function releaseWritePath(
  table: WriteLockTable,
  path: string,
  owner?: string,
): WriteLockTable {
  const key = normalizeLockPath(path);
  if (!key || !table[key]) return table;
  if (owner && table[key].owner !== owner) return table;
  const next = { ...table };
  delete next[key];
  return next;
}

export function releaseAllForOwner(table: WriteLockTable, owner: string): WriteLockTable {
  const next: WriteLockTable = {};
  for (const [k, v] of Object.entries(table)) {
    if (v.owner !== owner) next[k] = v;
  }
  return next;
}

/** Build lock table from in-progress subtasks that declare lockPath. */
export function locksFromSubtasks(
  subtasks: Array<{ id: string; status: string; lockPath?: string; assignee?: string; role?: string }>,
): WriteLockTable {
  const table: WriteLockTable = {};
  for (const s of subtasks) {
    if (s.status !== 'in_progress' || !s.lockPath) continue;
    const key = normalizeLockPath(s.lockPath);
    if (!key) continue;
    table[key] = {
      owner: s.assignee || s.role || s.id,
      nodeId: s.id,
      at: Date.now(),
    };
  }
  return table;
}

/** True if another in_progress subtask already claims the same path. */
export function pathClaimedByOther(
  subtasks: Array<{ id: string; status: string; lockPath?: string }>,
  path: string,
  selfId: string,
): string | null {
  const key = normalizeLockPath(path);
  if (!key) return null;
  for (const s of subtasks) {
    if (s.id === selfId || s.status !== 'in_progress' || !s.lockPath) continue;
    if (normalizeLockPath(s.lockPath) === key) return s.id;
  }
  return null;
}
