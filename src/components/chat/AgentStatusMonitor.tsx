import { useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import {
  agentPhaseLabel,
  agentPhaseStepCount,
  agentPhaseStepIndex,
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
  const stepIdx = agentPhaseStepIndex(phase);
  const stepCount = agentPhaseStepCount();

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
    if (turn > 0 && maxTurns > 0) parts.push(`Turn ${turn}/${maxTurns}`);
    if (elapsedMs > 0 || phase !== 'idle') parts.push(formatElapsedSec(elapsedMs));
    if (queuedMidRun > 0) parts.push(`queued mid-run×${queuedMidRun}`);
    return parts.join(' · ');
  }, [turn, maxTurns, elapsedMs, queuedMidRun, phase]);

  if (phase === 'idle' && !compact) return null;

  if (compact && (phase === 'idle' || phase === 'stopped' || phase === 'error' || phase === 'finishing')) {
    return (
      <div
        className={cn(
          'agent-status-monitor agent-status-monitor--compact mb-1.5 rounded border border-border/80 bg-background/80 px-2 py-1',
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-500">
          <span className="text-zinc-400">{label}</span>
          {subline ? <span className="text-zinc-600">· {subline}</span> : null}
        </div>
      </div>
    );
  }

  const warn = reasoningWarn || phase === 'error';
  const accent =
    phase === 'error'
      ? 'border-red-900/70 bg-red-950/40'
      : warn
        ? 'border-amber-800/70 bg-amber-950/35'
        : 'border-border bg-zinc-950/50';

  return (
    <div
      className={cn('agent-status-monitor mb-1.5 rounded border px-2.5 py-1.5', accent, className)}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full',
            phase === 'error' ? 'bg-red-400' : warn ? 'bg-amber-400 animate-pulse' : 'bg-sky-400 animate-pulse',
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'font-mono text-[12px] font-medium leading-5',
              phase === 'error' ? 'text-red-300' : warn ? 'text-amber-300' : 'text-zinc-100',
            )}
          >
            {label}
          </div>
          {subline ? (
            <div className="mt-0.5 font-mono text-[10px] leading-4 text-zinc-500">{subline}</div>
          ) : null}
          {reasoningWarn ? (
            <div className="mt-1 font-mono text-[10px] leading-4 text-amber-400/95">
              Still reasoning — no reply tokens yet
            </div>
          ) : null}
          {stepIdx >= 0 ? (
            <div className="agent-phase-dots mt-1.5" aria-hidden>
              {Array.from({ length: stepCount }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    'agent-phase-dot',
                    i < stepIdx && 'agent-phase-dot--done',
                    i === stepIdx && 'agent-phase-dot--active',
                  )}
                />
              ))}
              <span className="agent-phase-bar">
                <span
                  className="agent-phase-bar-fill"
                  style={{ width: `${Math.round(((stepIdx + 1) / stepCount) * 100)}%` }}
                />
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
