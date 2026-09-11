import { useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import {
  agentPhaseLabel,
  formatElapsedSec,
  REASONING_NO_CONTENT_WARN_SEC,
  type AgentPhase,
  type AgentPhaseMeta,
} from '../../lib/agentPhase';

export type AgentStatusMonitorProps = {
  phase: AgentPhase;
  meta?: AgentPhaseMeta;
  turn: number;
  maxTurns: number;
  queuedMidRun?: number;
  /** @deprecated Prefer runStartedAt + ticking so the parent transcript does not re-render. */
  elapsedMs?: number;
  /** Wall-clock start of the current run; used with ticking for an isolated timer. */
  runStartedAt?: number;
  /** When true, this component owns the 500ms elapsed ticker. */
  ticking?: boolean;
  /** Compact idle strip after last stop (optional). */
  compact?: boolean;
  className?: string;
};

export function AgentStatusMonitor({
  phase,
  meta = {},
  turn,
  maxTurns,
  queuedMidRun = 0,
  elapsedMs: elapsedMsProp = 0,
  runStartedAt,
  ticking = false,
  compact = false,
  className,
}: AgentStatusMonitorProps) {
  const [tickMs, setTickMs] = useState(0);

  useEffect(() => {
    if (!ticking) {
      setTickMs(0);
      return;
    }
    const started = runStartedAt || meta.runStartedAt || Date.now();
    const tick = () => setTickMs(Date.now() - started);
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [ticking, runStartedAt, meta.runStartedAt]);

  const elapsedMs = ticking ? tickMs : elapsedMsProp;
  const label = agentPhaseLabel(phase, meta);

  const reasoningWarn = useMemo(() => {
    if (phase !== 'reasoning' || meta.hasContent) return false;
    const started = meta.reasoningStartedAt ?? meta.runStartedAt;
    if (!started) return false;
    const sec = (Date.now() - started) / 1000;
    const fromElapsed =
      meta.reasoningStartedAt && meta.runStartedAt
        ? (elapsedMs - (meta.reasoningStartedAt - meta.runStartedAt)) / 1000
        : elapsedMs / 1000;
    const age = Number.isFinite(fromElapsed) && fromElapsed >= 0 ? fromElapsed : sec;
    return age >= REASONING_NO_CONTENT_WARN_SEC;
  }, [phase, meta.hasContent, meta.reasoningStartedAt, meta.runStartedAt, elapsedMs]);

  const subline = useMemo(() => {
    const parts: string[] = [];
    if (turn > 0 && maxTurns > 0) parts.push(`turn ${turn}/${maxTurns}`);
    if (elapsedMs > 0 || phase !== 'idle') parts.push(formatElapsedSec(elapsedMs));
    return parts.join(' · ');
  }, [turn, maxTurns, elapsedMs, phase]);

  if (phase === 'idle' && !compact) return null;

  if (compact && (phase === 'idle' || phase === 'stopped' || phase === 'error' || phase === 'finishing')) {
    return (
      <div
        className={cn(
          'agent-status-monitor agent-status-monitor--compact mx-auto max-w-3xl mb-1.5 flex items-center gap-2 font-mono text-[10px] text-zinc-500 px-1',
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <span className="text-zinc-400">{label}</span>
        {subline ? <span className="text-zinc-600">· {subline}</span> : null}
      </div>
    );
  }

  const warn = reasoningWarn || phase === 'error';
  const accent =
    phase === 'error'
      ? 'border-rose-900/50 bg-rose-950/20 text-rose-300'
      : warn
      ? 'border-amber-900/40 bg-amber-950/20 text-amber-300'
      : 'border-border/60 bg-zinc-950/60 text-zinc-300';

  return (
    <div
      className={cn(
        'agent-status-monitor mx-auto max-w-3xl mb-1.5 flex items-center justify-between gap-3 rounded-[3px] border px-3 py-1 font-mono text-[11px] backdrop-blur-sm transition-colors',
        accent,
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'inline-block h-1.5 w-1.5 shrink-0 rounded-[1px]',
            phase === 'error'
              ? 'bg-rose-400'
              : warn
              ? 'bg-amber-400 animate-pulse'
              : 'bg-sky-400 animate-pulse',
          )}
          aria-hidden
        />
        <span
          className={cn(
            'truncate font-medium',
            phase === 'error' ? 'text-rose-300' : warn ? 'text-amber-300' : 'text-zinc-200',
          )}
        >
          {label}
        </span>
        {subline ? <span className="text-zinc-500 text-[10px] truncate">· {subline}</span> : null}
        {reasoningWarn ? (
          <span className="text-[10px] text-amber-400/90 shrink-0">(still thinking…)</span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2.5 text-[10px]">
        {queuedMidRun > 0 ? (
          <span className="text-sky-400 font-medium">+{queuedMidRun} queued</span>
        ) : null}
        <span className="text-zinc-600 select-none">Esc stops</span>
      </div>
    </div>
  );
}
