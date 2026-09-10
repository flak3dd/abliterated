/** Per-message Plan → Edit → Check → Done, derived from the live agent run (no timers). */

export type WorkflowStepKind = 'plan' | 'edit' | 'check' | 'done';
export type WorkflowStepStatus = 'pending' | 'active' | 'done' | 'failed';
export type PlanApproved = 'awaiting' | 'approved';

export type PlanItem = {
  id: string;
  label: string;
  status: WorkflowStepStatus;
};

export type WorkflowStep = {
  id: string;
  kind: WorkflowStepKind;
  title: string;
  detail: string;
  status: WorkflowStepStatus;
  startedAt: number | null;
  finishedAt: number | null;
  log: string[];
};

export type FileRef = { path: string };

export type TurnPhase =
  | 'idle'
  | 'starting'
  | 'reasoning'
  | 'writing'
  | 'tool_plan'
  | 'tool_exec'
  | 'waiting_gate'
  | 'self_deepen'
  | 'integrating_mid_run'
  | 'finishing'
  | 'error'
  | 'stopped';

const EXPLORE_TOOLS = new Set([
  'read_file',
  'grep',
  'list_dir',
  'glob',
  'semantic_search',
  'file_outline',
]);

const WRITE_TOOLS = new Set([
  'write_file',
  'apply_patch',
  'search_replace',
  'edit_file',
  'str_replace',
]);

const KIND_ORDER: WorkflowStepKind[] = ['plan', 'edit', 'check', 'done'];

function basename(path: string): string {
  const p = (path || '').replace(/\\/g, '/');
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

function editVerb(path: string): string {
  if (path.endsWith('.css')) return 'Restyle';
  if (path.endsWith('.md')) return 'Revise';
  if (path.endsWith('.json')) return 'Configure';
  return 'Update';
}

function uniqPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const p = (raw || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= 8) break;
  }
  return out;
}

export function planRangeForStep(kind: WorkflowStepKind, editCount: number): [number, number] {
  const n = Math.max(1, editCount);
  if (kind === 'plan') return [0, 1];
  if (kind === 'edit') return [1, 1 + n];
  if (kind === 'check') return [1 + n, 2 + n];
  return [2 + n, 3 + n];
}

export function buildTurnPlan(_userText: string, pins: string[], opts?: { promptOnly?: boolean }): PlanItem[] {
  const targets = uniqPaths(pins).slice(0, 4);
  const items: PlanItem[] = [
    { id: 'plan-read', label: 'Read the workspace and locate touch points', status: 'pending' },
  ];
  if (targets.length) {
    for (const path of targets) {
      items.push({
        id: `plan-edit-${path}`,
        label: `${editVerb(path)} ${basename(path)}`,
        status: 'pending',
      });
    }
  } else {
    items.push({
      id: 'plan-edit',
      label: opts?.promptOnly ? 'Write prompt files' : 'Edit matched files',
      status: 'pending',
    });
  }
  items.push(
    { id: 'plan-check', label: 'Run type check and lint', status: 'pending' },
    { id: 'plan-done', label: 'Summarise the change', status: 'pending' },
  );
  return items.slice(0, 8);
}

export function buildTurnSteps(prompt: string, targets: string[]): WorkflowStep[] {
  const files = uniqPaths(targets);
  const fileList = files.map(basename).join(', ');
  const short = (prompt || '').trim().replace(/\s+/g, ' ');
  const intent = short.length > 64 ? `${short.slice(0, 61)}…` : short || '(no prompt)';
  return [
    {
      id: 'step-plan',
      kind: 'plan',
      title: 'Plan',
      detail: 'reading the workspace and locating touch points',
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      log: [`intent: ${intent}`, files.length ? `pins: ${fileList}` : 'pins: none'],
    },
    {
      id: 'step-edit',
      kind: 'edit',
      title: 'Edit',
      detail: fileList || 'no files matched yet',
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      log: [],
    },
    {
      id: 'step-check',
      kind: 'check',
      title: 'Check',
      detail: 'waiting for verify evidence',
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      log: [],
    },
    {
      id: 'step-done',
      kind: 'done',
      title: 'Done',
      detail: 'summarising the change',
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      log: [],
    },
  ];
}

export function collectTurnFiles(opts: {
  pins?: string[];
  grokResults?: { file: string; status?: string }[];
  toolCalls?: { name: string; arguments?: Record<string, unknown> }[];
}): FileRef[] {
  const paths: string[] = [];
  for (const g of opts.grokResults || []) {
    if (g.file && (g.status === 'ok' || g.status === 'pending')) paths.push(g.file);
  }
  for (const tc of opts.toolCalls || []) {
    const n = String(tc.name || '').toLowerCase();
    if (!WRITE_TOOLS.has(n)) continue;
    const args = tc.arguments || {};
    const p = [args.path, args.file, args.target, args.file_path, args.filename].find(
      (v) => typeof v === 'string' && v.trim(),
    );
    if (typeof p === 'string') paths.push(p);
  }
  if (!paths.length) paths.push(...(opts.pins || []));
  return uniqPaths(paths).map((path) => ({ path }));
}

function hasWriteEvidence(
  toolsUsed: string[],
  grokResults?: { file: string; status?: string }[],
): boolean {
  if (toolsUsed.some((t) => WRITE_TOOLS.has(String(t || '').toLowerCase()))) return true;
  return !!(grokResults || []).some((g) => g.status === 'ok' || g.status === 'pending');
}

/** Map live agent phase + evidence onto the four-step contract. */
export function kindForRun(opts: {
  phase: TurnPhase;
  toolsUsed: string[];
  grokOk?: boolean;
  verifyEvidence?: boolean;
}): WorkflowStepKind {
  const phase = opts.phase;
  const used = (opts.toolsUsed || []).map((t) => String(t || '').toLowerCase());
  const last = used[used.length - 1] || '';
  if (phase === 'error' || phase === 'stopped') {
    if (opts.verifyEvidence) return 'check';
    if (opts.grokOk || used.some((t) => WRITE_TOOLS.has(t))) return 'edit';
    return 'plan';
  }
  if (phase === 'finishing' || phase === 'idle') return 'done';
  if (phase === 'waiting_gate') return 'edit';
  if (phase === 'self_deepen') {
    if (opts.verifyEvidence || last === 'verify' || last === 'shell') return 'check';
    if (WRITE_TOOLS.has(last) || opts.grokOk) return 'edit';
    return 'plan';
  }
  if (phase === 'tool_exec') {
    if (last === 'verify' || last === 'shell') return 'check';
    if (WRITE_TOOLS.has(last)) return 'edit';
    if (EXPLORE_TOOLS.has(last)) return 'plan';
    return 'edit';
  }
  if (phase === 'writing') return opts.grokOk || used.some((t) => WRITE_TOOLS.has(t)) ? 'edit' : 'plan';
  return 'plan';
}

function stamp(
  step: WorkflowStep,
  status: WorkflowStepStatus,
  now: number,
  patch?: Partial<WorkflowStep>,
): WorkflowStep {
  const next: WorkflowStep = { ...step, ...patch, status };
  if (status === 'active' && !next.startedAt) next.startedAt = now;
  if ((status === 'done' || status === 'failed') && !next.finishedAt) next.finishedAt = now;
  if (status === 'pending') {
    next.startedAt = null;
    next.finishedAt = null;
  }
  return next;
}

export function syncStepsFromRun(opts: {
  steps: WorkflowStep[];
  plan?: PlanItem[];
  phase: TurnPhase;
  toolsUsed: string[];
  grokResults?: { file: string; status?: string }[];
  verifyEvidence?: boolean;
  promptOnly?: boolean;
  content?: string;
  now?: number;
}): { steps: WorkflowStep[]; plan: PlanItem[] } {
  const now = opts.now ?? Date.now();
  const grokOk = hasWriteEvidence(opts.toolsUsed, opts.grokResults);
  const written = collectTurnFiles({ grokResults: opts.grokResults }).map((f) => f.path);
  const current = kindForRun({
    phase: opts.phase,
    toolsUsed: opts.toolsUsed,
    grokOk,
    verifyEvidence: opts.verifyEvidence,
  });
  const failed = opts.phase === 'error' || opts.phase === 'stopped';
  const currentIdx = KIND_ORDER.indexOf(current);

  const steps = (opts.steps.length ? opts.steps : buildTurnSteps('', [])).map((step) => {
    const idx = KIND_ORDER.indexOf(step.kind);
    if (idx < 0) return step;
    if (failed && idx === currentIdx) {
      return stamp(step, 'failed', now);
    }
    if (idx < currentIdx) {
      if (step.kind === 'edit' && grokOk) {
        return stamp(step, 'done', now, {
          detail: written.map(basename).join(', ') || step.detail,
          log: written.map((p) => `wrote ${p}`),
        });
      }
      if (step.kind === 'edit') {
        return stamp(step, failed ? 'failed' : 'done', now, {
          detail: written.length ? written.map(basename).join(', ') : opts.promptOnly ? 'prompt-only' : 'no files landed',
          log: written.length ? written.map((p) => `wrote ${p}`) : step.log,
        });
      }
      if (step.kind === 'check' && opts.verifyEvidence) {
        return stamp(step, 'done', now, {
          detail: 'verify evidence present',
          log: ['verify ok'],
        });
      }
      if (step.kind === 'check') {
        return stamp(step, 'done', now, {
          detail: opts.promptOnly ? 'check skipped' : 'no verify evidence yet',
          log: step.log.length ? step.log : ['check skipped — no verify tool this turn'],
        });
      }
      if (step.kind === 'plan') {
        const explore = (opts.toolsUsed || []).filter((t) => EXPLORE_TOOLS.has(String(t).toLowerCase()));
        const log = [...step.log];
        if (explore.length) log.push(`tools: ${[...new Set(explore)].join(', ')}`);
        return stamp(step, 'done', now, { detail: 'touch points located', log });
      }
      return stamp(step, 'done', now);
    }
    if (idx === currentIdx) {
      if (step.kind === 'edit') {
        return stamp(step, 'active', now, {
          detail: written.length ? written.map(basename).join(', ') : step.detail,
          log: written.length ? written.map((p) => `wrote ${p}`) : step.log,
        });
      }
      if (step.kind === 'check') {
        return stamp(step, 'active', now, {
          detail: opts.verifyEvidence ? 'verify evidence present' : 'running checks',
          log: opts.verifyEvidence ? ['verify ok'] : step.log,
        });
      }
      if (step.kind === 'done') {
        const summarised = !!(opts.content || '').trim();
        return stamp(step, summarised && !failed ? 'done' : 'active', now, {
          detail: summarised ? 'change summarised' : 'summarising the change',
          log: summarised ? ['summary in content'] : step.log,
        });
      }
      return stamp(step, 'active', now);
    }
    return stamp(step, 'pending', now, { startedAt: null, finishedAt: null });
  });

  const editCount = Math.max(1, (opts.plan || []).filter((p) => p.id.startsWith('plan-edit')).length || 1);
  const plan = (opts.plan || []).map((item, index) => {
    let status: WorkflowStepStatus = 'pending';
    for (const kind of KIND_ORDER) {
      const [start, end] = planRangeForStep(kind, editCount);
      if (index < start || index >= end) continue;
      const step = steps.find((s) => s.kind === kind);
      status = step?.status || 'pending';
      break;
    }
    return { ...item, status };
  });

  return { steps, plan };
}
