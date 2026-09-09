import { AlertTriangle, Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../../lib/cn';
import type { WorkflowStep } from '../../lib/turnWorkflow';

function StepMarker({ status }: { status: WorkflowStep['status'] }) {
  if (status === 'done') {
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full border border-signal/50 bg-signal/15 text-signal">
        <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="relative grid h-6 w-6 place-items-center rounded-full border border-primary/60 bg-primary/10">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full border border-rose-500/50 bg-rose-950/40 text-rose-400">
        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
    );
  }
  return <span className="grid h-6 w-6 place-items-center rounded-full border border-border bg-surface" />;
}

function StepRow({ step, isLast }: { step: WorkflowStep; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const hasLog = step.log.length > 0;

  return (
    <li className="relative pl-9">
      {!isLast ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute left-[11px] top-7 h-[calc(100%-16px)] w-px',
            step.status === 'done' ? 'bg-signal/35' : 'bg-border',
          )}
        />
      ) : null}
      <span className="absolute left-0 top-1">
        <StepMarker status={step.status} />
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasLog}
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-2 rounded-md py-1.5 pr-1 text-left',
          hasLog ? 'hover:text-zinc-100' : 'cursor-default',
        )}
      >
        <span className={cn('text-sm font-semibold', step.status === 'pending' ? 'text-zinc-500' : 'text-zinc-100')}>
          {step.title}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-500">
          {step.kind === 'done' ? '— ' : ': '}
          {step.detail}
        </span>
        {hasLog ? (
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform', open && 'rotate-180')} />
        ) : null}
      </button>
      {open && hasLog ? (
        <pre className="mb-2 ml-0 max-h-40 overflow-auto rounded border border-border bg-zinc-950/60 px-2 py-1.5 font-mono text-[10px] leading-4 text-zinc-400">
          {step.log.join('\n')}
        </pre>
      ) : null}
    </li>
  );
}

export function StepTimeline({ steps }: { steps: WorkflowStep[] }) {
  if (!steps.length) return null;
  return (
    <ol className="mb-3 space-y-0" aria-label="Turn steps">
      {steps.map((step, i) => (
        <StepRow key={step.id} step={step} isLast={i === steps.length - 1} />
      ))}
    </ol>
  );
}
