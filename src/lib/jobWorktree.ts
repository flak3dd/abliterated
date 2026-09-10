/** Optional per-Job git worktree under .ablit/worktrees/<jobId> + bridge ROOT switch. */

export const JOB_WORKTREES_DIR = '.ablit/worktrees';

export function jobWorktreeRelPath(jobId: string): string {
  const safe = String(jobId || 'job').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  return `${JOB_WORKTREES_DIR}/${safe || 'job'}`;
}

export type PrepareJobWorktreeResult = {
  enabled: boolean;
  path: string;
  /** Absolute path when workspaceRoot was provided. */
  absPath: string;
  created: boolean;
  /** Caller should bridge.setRoot(absPath) when true. */
  shouldSetRoot: boolean;
  note: string;
};

function shellQuote(s: string): string {
  if (/^[a-zA-Z0-9._/-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function joinRoot(workspaceRoot: string, rel: string): string {
  const root = workspaceRoot.replace(/[/\\]+$/, '');
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return `${root}${sep}${rel.replace(/\//g, sep)}`;
}

/**
 * Create a real git worktree when possible. Returns absPath + shouldSetRoot so
 * the Job runner can point the bridge ROOT at the isolated tree.
 */
export async function prepareJobWorktree(opts: {
  enabled: boolean;
  jobId: string;
  workspaceRoot: string;
  run: (command: string) => Promise<{ out: string; code: number }>;
}): Promise<PrepareJobWorktreeResult> {
  const path = jobWorktreeRelPath(opts.jobId);
  const absPath = opts.workspaceRoot ? joinRoot(opts.workspaceRoot, path) : path;
  if (!opts.enabled) {
    return {
      enabled: false,
      path,
      absPath,
      created: false,
      shouldSetRoot: false,
      note: 'job worktrees disabled',
    };
  }
  if (!opts.workspaceRoot) {
    return {
      enabled: true,
      path,
      absPath,
      created: false,
      shouldSetRoot: false,
      note: 'no workspace root — skipped',
    };
  }

  const mkdir = await opts.run(`mkdir -p ${shellQuote(path)}`);
  if (mkdir.code !== 0) {
    return {
      enabled: true,
      path,
      absPath,
      created: false,
      shouldSetRoot: false,
      note: `mkdir failed: ${(mkdir.out || '').trim() || `exit ${mkdir.code}`}`,
    };
  }

  const gitCheck = await opts.run('git rev-parse --is-inside-work-tree');
  if (gitCheck.code !== 0 || !/true/i.test(gitCheck.out || '')) {
    return {
      enabled: true,
      path,
      absPath,
      created: true,
      shouldSetRoot: true,
      note: `directory ready at ${absPath} (not a git repo) — set workspace root`,
    };
  }

  const ls = await opts.run(`ls -A ${shellQuote(path)}`);
  if ((ls.out || '').trim()) {
    return {
      enabled: true,
      path,
      absPath,
      created: false,
      shouldSetRoot: true,
      note: `reuse worktree at ${absPath} — set workspace root`,
    };
  }

  const branch = `ablit-job/${opts.jobId}`.replace(/[^a-zA-Z0-9._/-]+/g, '-').slice(0, 100);
  const add = await opts.run(
    `git worktree add -b ${shellQuote(branch)} ${shellQuote(path)} HEAD`,
  );
  if (add.code !== 0) {
    const add2 = await opts.run(`git worktree add ${shellQuote(path)} HEAD`);
    if (add2.code !== 0) {
      return {
        enabled: true,
        path,
        absPath,
        created: true,
        shouldSetRoot: true,
        note: `git worktree add failed (dir kept): ${(add2.out || add.out || '').trim().slice(0, 200)} — set workspace root anyway`,
      };
    }
  }

  return {
    enabled: true,
    path,
    absPath,
    created: true,
    shouldSetRoot: true,
    note: `git worktree ready at ${absPath} — set workspace root`,
  };
}
