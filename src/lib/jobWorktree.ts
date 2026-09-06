/** Optional per-Job worktree helpers under .ablit/worktrees/<jobId>. */

export const JOB_WORKTREES_DIR = ".ablit/worktrees";

export function jobWorktreeRelPath(jobId: string): string {
  const safe = String(jobId || "job").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
  return `${JOB_WORKTREES_DIR}/${safe || "job"}`;
}

export type PrepareJobWorktreeResult = {
  enabled: boolean;
  path: string;
  created: boolean;
  note: string;
};

/** Best-effort prepare. Does not switch the bridge ROOT (single-root limit). */
export async function prepareJobWorktree(opts: {
  enabled: boolean;
  jobId: string;
  workspaceRoot: string;
  run: (command: string) => Promise<{ out: string; code: number }>;
}): Promise<PrepareJobWorktreeResult> {
  const path = jobWorktreeRelPath(opts.jobId);
  if (!opts.enabled) {
    return { enabled: false, path, created: false, note: "job worktrees disabled" };
  }
  if (!opts.workspaceRoot) {
    return { enabled: true, path, created: false, note: "no workspace root — skipped" };
  }
  const mkdir = await opts.run(`mkdir -p ${shellQuote(path)}`);
  if (mkdir.code !== 0) {
    return {
      enabled: true,
      path,
      created: false,
      note: `mkdir failed: ${(mkdir.out || "").trim() || `exit ${mkdir.code}`}`,
    };
  }
  const gitCheck = await opts.run("git rev-parse --is-inside-work-tree");
  if (gitCheck.code !== 0 || !/true/i.test(gitCheck.out || "")) {
    return {
      enabled: true,
      path,
      created: true,
      note: "directory ready (not a git repo); bridge ROOT unchanged (stub)",
    };
  }
  const ls = await opts.run(`ls -A ${shellQuote(path)}`);
  if ((ls.out || "").trim()) {
    return {
      enabled: true,
      path,
      created: false,
      note: "path exists; reuse (bridge ROOT unchanged — multi-root follow-up)",
    };
  }
  const branch = `ablit-job/${opts.jobId}`.replace(/[^a-zA-Z0-9._/-]+/g, "-").slice(0, 100);
  const add = await opts.run(
    `git worktree add -b ${shellQuote(branch)} ${shellQuote(path)} HEAD`,
  );
  if (add.code !== 0) {
    const add2 = await opts.run(`git worktree add ${shellQuote(path)} HEAD`);
    if (add2.code !== 0) {
      return {
        enabled: true,
        path,
        created: true,
        note: `git worktree add failed (dir kept): ${(add2.out || add.out || "").trim().slice(0, 200)}; bridge ROOT unchanged`,
      };
    }
  }
  return {
    enabled: true,
    path,
    created: true,
    note: `git worktree ready at ${path} (bridge ROOT still shared — isolation stub)`,
  };
}

function shellQuote(s: string): string {
  if (/^[a-zA-Z0-9._/-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

