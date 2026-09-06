import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, RotateCw, Terminal, Trash2, X } from 'lucide-react';
import {
  cancelJob,
  clearFinishedJobs,
  deleteJob,
  enqueueJob,
  subscribeJobs,
} from '../lib/jobRunner';
import { cn } from '../lib/cn';
import { bridge } from '../lib/bridgeClient';
import { getSettings, getWorkspace, setSettings } from '../lib/storage';
import { workspaceGate } from '../lib/workspaceGuard';
import type { ClientSettings, Job, JobStatus } from '../types';
import {
  DEEPEN_COMPLETENESS_JOB_PROMPT,
  DEEPEN_COMPLETENESS_PRESET_LABEL,
} from '../lib/deepenComplete';
import {
  VERIFY_STRICT_PROFILE_JOB_PROMPT,
  VERIFY_STRICT_PROFILE_LABEL,
  applyVerifyStrictProfile,
} from '../lib/verifyStrictProfile';
import { TASK_GRAPH_PATH, formatTaskGraphPrompt, parseTaskGraph } from '../lib/taskGraph';

interface Props {
  jobs: Job[];
  onJobsChange: (jobs: Job[]) => void;
  onSettingsChange?: (s: ClientSettings) => void;
}

const BADGE: Record<JobStatus, string> = {
  queued: 'text-zinc-300 bg-zinc-800 border-zinc-700',
  running: 'text-amber-300 bg-amber-950/80 border-amber-800/60 shadow-[0_0_8px_rgba(245,158,11,0.2)]',
  done: 'text-emerald-300 bg-emerald-950/80 border-emerald-800/60',
  error: 'text-rose-300 bg-rose-950/80 border-rose-800/60',
  incomplete: 'text-orange-300 bg-orange-950/80 border-orange-800/60',
};

const PROMPT_EXAMPLES = [
  'Summarize git status and list dirty files',
  'Find TODO comments under src/ and group by file',
  'Read package.json and suggest a minimal cleanup PR',
  DEEPEN_COMPLETENESS_JOB_PROMPT,
  VERIFY_STRICT_PROFILE_JOB_PROMPT,
];

/** Short chip labels; full prompt may be longer for the completeness preset. */
const PROMPT_EXAMPLE_LABELS = [
  'Summarize git status and list dirty files',
  'Find TODO comments under src/ and group by file',
  'Read package.json and suggest a minimal cleanup PR',
  DEEPEN_COMPLETENESS_PRESET_LABEL,
  VERIFY_STRICT_PROFILE_LABEL,
];

function relativeTime(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

type FilterTab = 'all' | 'active' | 'done' | 'error' | 'incomplete';

export function JobsScreen({ jobs, onJobsChange, onSettingsChange }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [multiAgent, setMultiAgent] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [statusFilter, setStatusFilter] = useState<FilterTab>('all');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [appRoot, setAppRoot] = useState(bridge.currentAppRoot);
  const [graphPrompt, setGraphPrompt] = useState('');
  const [forceReplanFlash, setForceReplanFlash] = useState('');

  useEffect(() => subscribeJobs(onJobsChange), [onJobsChange]);
  useEffect(() => bridge.onAppRootChange(setAppRoot), []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 2200);
    return () => window.clearTimeout(id);
  }, [flash]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!openId || !bridge.connected) {
        if (!cancelled) setGraphPrompt('');
        return;
      }
      const job = jobs.find((j) => j.id === openId);
      if (!job?.multiAgent && job?.status !== 'running') {
        // still show graph if file exists for MA jobs or any running
      }
      try {
        const raw = await bridge.readFile(TASK_GRAPH_PATH);
        const g = parseTaskGraph(raw);
        if (!cancelled) setGraphPrompt(formatTaskGraphPrompt(g));
      } catch {
        if (!cancelled) setGraphPrompt('');
      }
    };
    void load();
    const id = window.setInterval(() => { void load(); }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [openId, jobs, appRoot]);


  const run = () => {
    setError('');
    try {
      const settings = getSettings();
      const job = enqueueJob({ title: title.trim() || undefined, prompt, multiAgent: multiAgent && settings.multiAgentEnabled === true });
      setPrompt('');
      setTitle('');
      setMultiAgent(false);
      setOpenId(job.id);
      setFlash('Job enqueued');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onCancel = (id: string) => {
    cancelJob(id);
    setFlash('Job cancelled');
  };

  const confirmDelete = (id: string) => {
    deleteJob(id);
    if (openId === id) setOpenId(null);
    setDeleteConfirmId(null);
    setFlash('Job deleted');
  };

  const cloneJob = (job: Job) => {
    setTitle(`Copy of ${job.title}`);
    setPrompt(job.prompt);
    setFlash('Job prompt loaded');
  };

  const filteredJobs = useMemo(() => {
    if (statusFilter === 'all') return jobs;
    if (statusFilter === 'active') return jobs.filter((j) => j.status === 'running' || j.status === 'queued');
    if (statusFilter === 'done') return jobs.filter((j) => j.status === 'done');
    if (statusFilter === 'error') return jobs.filter((j) => j.status === 'error');
    if (statusFilter === 'incomplete') return jobs.filter((j) => j.status === 'incomplete');
    return jobs;
  }, [jobs, statusFilter]);

  const jobWorkspace = workspaceGate(
    bridge.validWorkspaceRoot || getWorkspace().rootPath,
    appRoot,
  );
  const canRun = Boolean(prompt.trim()) && jobWorkspace.ok;

  return (
    <div className="flex h-full flex-col bg-background select-none">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="font-mono text-xs font-semibold tracking-wider text-zinc-100">JOBS RUNNER</div>
          <div className="flex items-center gap-1 rounded bg-surface-raised p-0.5 border border-border/80">
            {(['all', 'active', 'done', 'incomplete', 'error'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={cn(
                  'rounded px-2 py-0.5 font-mono text-[10px] uppercase font-medium transition-colors',
                  statusFilter === tab
                    ? 'bg-zinc-800 text-zinc-100 shadow-sm'
                    : 'text-muted hover:text-zinc-300',
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {flash ? (
            <span className="font-mono text-[10px] text-emerald-400 font-medium" role="status">
              {flash}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => clearFinishedJobs()}
            className="btn-ghost h-7 px-2.5 text-[10px]"
          >
            Clear finished
          </button>
        </div>
      </header>

      {/* Enqueue Form */}
      <div className="border-b border-border bg-surface-raised/30 px-4 py-3 select-text">
        <div className="flex flex-col gap-2">
          <label className="block font-mono text-[10px] uppercase text-muted font-medium">
            Title (optional)
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short task summary..."
              className="field mt-1"
            />
          </label>
          <label className="block font-mono text-[10px] uppercase text-muted font-medium">
            Prompt
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder={`e.g. ${PROMPT_EXAMPLES[0]}`}
              className="field mt-1 resize-y"
            />
          </label>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {PROMPT_EXAMPLES.map((ex, i) => {
            const label = PROMPT_EXAMPLE_LABELS[i] || ex;
            const isCompleteness = ex === DEEPEN_COMPLETENESS_JOB_PROMPT;
            return (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setPrompt(ex);
                  if (isCompleteness) {
                    const next = { ...getSettings(), deepenCompleteness: true };
                    setSettings(next);
                    onSettingsChange?.(next);
                    setFlash('Completeness deepen enabled (synced with Chat/Settings)');
                  }
                  if (ex === VERIFY_STRICT_PROFILE_JOB_PROMPT) {
                    const next = applyVerifyStrictProfile({ ...getSettings(), verifyStrictProfile: true });
                    setSettings(next);
                    onSettingsChange?.(next);
                    setFlash('Verify-strict profile applied (Build + skills)');
                  }
                }}
                className="chip max-w-full truncate hover:border-sky-500/40 hover:text-sky-200"
                title={ex}
              >
                {label}
              </button>
            );
          })}
        </div>

        {error ? <div className="mt-2 font-mono text-[11px] text-rose-400">{error}</div> : null}
        {!jobWorkspace.ok ? (
          <div className="mt-2 font-mono text-[11px] text-amber-300">{jobWorkspace.message}</div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 font-mono text-[10px] text-zinc-400">
            <input
              type="checkbox"
              checked={multiAgent}
              disabled={getSettings().multiAgentEnabled !== true}
              onChange={(e) => setMultiAgent(e.target.checked)}
            />
            Multi-agent fleet
            {getSettings().multiAgentEnabled !== true ? ' (enable in Settings)' : ''}
          </label>
          <button type="button" onClick={run} disabled={!canRun} className="btn-primary">
            <Plus size={12} /> Run background job
          </button>
          <p className="w-full font-mono text-[10px] text-muted">
            Background agent queue (concurrency from Settings → Max concurrent Jobs). Runs headlessly.
          </p>
        </div>
      </div>

      {/* Jobs List */}
      <div className="flex-1 overflow-auto select-text">
        {filteredJobs.length === 0 ? (
          <div className="mx-auto max-w-sm px-4 py-12 text-center select-none">
            <div className="font-mono text-xs text-zinc-300">
              {statusFilter === 'all' ? 'No jobs yet' : `No ${statusFilter} jobs`}
            </div>
            <p className="mt-2 font-mono text-[11px] leading-5 text-muted">
              Queue a background task above. Jobs continue processing while you browse files or chat in another session.
            </p>
            {statusFilter === 'all' ? (
              <button
                type="button"
                className="btn-ghost mt-4"
                onClick={() => {
                  setPrompt(PROMPT_EXAMPLES[0]);
                  setTitle('Quick status');
                }}
              >
                Use example prompt
              </button>
            ) : null}
          </div>
        ) : (
          filteredJobs.map((job) => (
            <div key={job.id} className="border-b border-border transition-colors">
              <div className="flex w-full items-center gap-3 px-4 py-2.5 hover:bg-zinc-900/50">
                <button
                  type="button"
                  onClick={() => setOpenId(openId === job.id ? null : job.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400"
                >
                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-mono text-[10px] uppercase font-semibold border',
                      BADGE[job.status],
                    )}
                  >
                    {job.status === 'running' ? <Loader2 size={10} className="spin-slow text-amber-400" /> : null}
                    {job.status}
                    {job.multiAgent ? ' · MA' : ''}
                    {job.role ? ` · ${job.role}` : ''}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-zinc-200">
                    {job.title}
                  </span>
                  <span className="hidden shrink-0 font-mono text-[10px] text-zinc-500 sm:inline">
                    {job.projectName}
                  </span>
                  <span
                    className="shrink-0 font-mono text-[10px] text-muted"
                    title={new Date(job.createdAt).toLocaleString()}
                  >
                    {relativeTime(job.createdAt, now)}
                  </span>
                </button>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    title="Clone / re-run prompt"
                    onClick={() => cloneJob(job)}
                    className="btn-icon h-7 w-7 text-zinc-400 hover:text-sky-300"
                  >
                    <RotateCw size={11} />
                  </button>

                  {job.status === 'queued' || job.status === 'running' ? (
                    <button
                      type="button"
                      title="Cancel job"
                      onClick={() => onCancel(job.id)}
                      className="btn-icon h-7 w-7 text-zinc-400 hover:text-rose-400"
                    >
                      <X size={12} />
                    </button>
                  ) : deleteConfirmId === job.id ? (
                    <div className="flex items-center gap-1 modal-animate-in">
                      <button
                        type="button"
                        onClick={() => confirmDelete(job.id)}
                        className="btn-danger h-6 px-1.5 text-[9px]"
                      >
                        Confirm Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(null)}
                        className="btn-ghost h-6 w-6 p-0"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      title="Delete job"
                      onClick={() => setDeleteConfirmId(job.id)}
                      className="btn-icon h-7 w-7 text-zinc-400 hover:text-rose-400"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Job Details Expansion */}
              {openId === job.id ? (
                <div className="border-t border-border/70 bg-zinc-950 px-4 py-3 modal-animate-in">
                  {job.prompt ? (
                    <div className="mb-2.5 font-mono text-[11px] text-zinc-400 bg-surface/40 p-2 rounded border border-border/50">
                      <span className="text-zinc-500 font-semibold uppercase text-[10px]">prompt: </span>
                      {job.prompt}
                    </div>
                  ) : null}

                  {job.todos && job.todos.length ? (
                    <div className="mb-3 rounded-md border border-sky-900/50 bg-sky-950/30 p-2.5">
                      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-sky-400 font-semibold flex items-center gap-1.5">
                        <Check size={12} />
                        <span>Execution Checklist</span>
                      </div>
                      <ul className="space-y-1 font-mono text-[11px] text-zinc-300">
                        {job.todos.map((item, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="shrink-0 text-sky-400 mt-0.5">•</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}


                  {(job.multiAgent || graphPrompt) && openId === job.id ? (
                    <div className="mb-3 rounded-md border border-violet-900/50 bg-violet-950/20 p-2.5">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <div className="font-mono text-[10px] uppercase tracking-wider text-violet-300 font-semibold">
                          Task graph{job.fleetId ? ` · ${job.fleetId}` : ''}
                          {job.role ? ` · role ${job.role}` : ''}
                        </div>
                        <button
                          type="button"
                          className="btn-ghost h-6 px-2 text-[10px]"
                          onClick={() => {
                            setForceReplanFlash('Replan: inject guidance via a new multi-agent job or mid-run note');
                            setFlash('Force replan: enqueue MA job with REPLAN TRIGGER in prompt, or use Settings multi-agent');
                          }}
                        >
                          Force replan hint
                        </button>
                      </div>
                      {forceReplanFlash && openId === job.id ? (
                        <div className="mb-1.5 font-mono text-[10px] text-amber-300">{forceReplanFlash}</div>
                      ) : null}
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-zinc-300 leading-5">
                        {graphPrompt || '(no .ablit/task.json yet — multi-agent will seed a fleet plan)'}
                      </pre>
                    </div>
                  ) : null}

                  {job.stopReason ? (
                    <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                      stopReason: {job.stopReason}
                      {job.status === 'incomplete' ? ' (not done)' : ''}
                    </div>
                  ) : null}
                  {job.error ? (
                    <div className="mb-2.5 rounded bg-rose-950/50 border border-rose-800/50 p-2 font-mono text-[11px] text-rose-300">
                      {job.status === 'incomplete' ? 'Incomplete' : 'Error'}: {job.error}
                    </div>
                  ) : null}

                  {/* Terminal Log Console */}
                  <div className="rounded-md border border-border/80 bg-black/60 overflow-hidden font-mono text-[11px]">
                    <div className="flex items-center justify-between border-b border-border/60 bg-surface-raised/60 px-3 py-1 text-[10px] text-muted">
                      <div className="flex items-center gap-1.5">
                        <Terminal size={11} className="text-sky-400" />
                        <span>Execution Logs</span>
                      </div>
                      <span>{job.logs.length} entries</span>
                    </div>
                    <pre className="max-h-72 overflow-auto p-3 text-zinc-300 leading-5">
                      {job.logs.length ? job.logs.join('\n') : '(no logs yet)'}
                    </pre>
                  </div>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
