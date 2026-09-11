import { AlertTriangle, Check, ChevronDown, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import type { PlanItem, WorkflowStep, WorkflowStepStatus } from '../../lib/turnWorkflow';

function StepMarker({ status }: { status: WorkflowStepStatus }) {
  if (status === 'done') {
    return (
      <span className="grid h-5 w-5 place-items-center rounded-[3px] bg-signal/20 text-signal">
        <Check className="h-3 w-3" strokeWidth={2.4} />
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="relative grid h-5 w-5 place-items-center rounded-[3px] border border-primary/60 bg-primary/10 text-primary">
        <Loader2 className="h-3 w-3 animate-spin" />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="grid h-5 w-5 place-items-center rounded-[3px] bg-rose-950 text-rose-400">
        <AlertTriangle className="h-3 w-3" strokeWidth={2} />
      </span>
    );
  }
  return <span className="grid h-5 w-5 place-items-center rounded-[3px] border border-border bg-surface" />;
}

function StepRow({
  step,
  isLast,
  plan,
  awaiting,
  onApprove,
  onDecline,
}: {
  step: WorkflowStep;
  isLast: boolean;
  plan?: PlanItem[];
  awaiting?: boolean;
  onApprove?: () => void;
  onDecline?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isPlanStep = step.kind === 'plan';
  const hasPlanItems = isPlanStep && !!plan && plan.length > 0;
  const hasLog = step.log.length > 0;
  const canToggle = hasLog || hasPlanItems;

  const completedPlanCount = useMemo(() => {
    if (!plan) return 0;
    return plan.filter((p) => p.status === 'done').length;
  }, [plan]);

  return (
    <li className="relative pl-7 text-xs font-mono">
      {!isLast ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute left-[9px] top-5.5 h-[calc(100%-14px)] w-px',
            step.status === 'done' ? 'bg-signal/35' : 'bg-border',
          )}
        />
      ) : null}
      <span className="absolute left-0 top-0.5">
        <StepMarker status={step.status} />
      </span>

      <div className="py-0.5">
        <button
          type="button"
          onClick={() => {
            if (canToggle) setOpen((v) => !v);
          }}
          disabled={!canToggle}
          aria-expanded={open}
          className={cn(
            'flex w-full items-center gap-2 rounded text-left',
            canToggle ? 'hover:text-zinc-100 cursor-pointer' : 'cursor-default',
          )}
        >
          <span
            className={cn(
              'font-semibold text-[12px]',
              step.status === 'pending' ? 'text-zinc-500' : 'text-zinc-100',
            )}
          >
            {step.title}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">
            {step.kind === 'done' ? '— ' : ': '}
            {step.detail}
          </span>
          {canToggle ? (
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform',
                (open || (isPlanStep && awaiting)) && 'rotate-180',
              )}
            />
          ) : null}
        </button>

        {/* Plan checklist incorporated directly into the Plan step */}
        {hasPlanItems && (open || awaiting || step.status === 'active') ? (
          <div className="my-1.5 rounded-lg border border-border/60 bg-surface/30 p-2.5">
            <div className="flex items-center justify-between text-[10.5px] text-zinc-400 mb-1.5">
              <span className="font-semibold uppercase tracking-wider text-zinc-300">
                Plan steps {awaiting ? '· review required' : ''}
              </span>
              <span className="text-zinc-500 tabular-nums">
                {completedPlanCount}/{plan.length}
              </span>
            </div>

            <ul className="space-y-1 text-[11.5px]">
              {plan.map((item, idx) => (
                <li key={item.id} className="flex items-start gap-2">
                  {item.status === 'done' ? (
                    <Check size={12} className="text-emerald-400 mt-0.5 shrink-0" strokeWidth={2.5} />
                  ) : item.status === 'active' ? (
                    <Loader2 size={12} className="text-sky-400 mt-0.5 shrink-0 animate-spin" />
                  ) : (
                    <span className="text-zinc-600 shrink-0 w-3 text-center text-[10.5px]">{idx + 1}.</span>
                  )}
                  <span
                    className={cn(
                      'leading-snug',
                      item.status === 'done'
                        ? 'text-zinc-500 line-through'
                        : item.status === 'active'
                        ? 'text-zinc-100 font-medium'
                        : 'text-zinc-300',
                    )}
                  >
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>

            {awaiting ? (
              <div className="mt-2.5 flex items-center gap-2 border-t border-border/50 pt-2">
                <button
                  type="button"
                  className="btn-primary h-6 px-2.5 text-[10.5px] font-mono"
                  onClick={() => onApprove?.()}
                >
                  Approve plan
                </button>
                <button
                  type="button"
                  className="btn-ghost h-6 px-2 text-[10.5px] font-mono"
                  onClick={() => onDecline?.()}
                >
                  Adjust
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Step execution log */}
        {open && hasLog ? (
          <pre className="mb-2 max-h-40 overflow-auto rounded border border-border bg-zinc-950/60 px-2 py-1.5 font-mono text-[10px] leading-4 text-zinc-400">
            {step.log.join('\n')}
          </pre>
        ) : null}
      </div>
    </li>
  );
}

export type StepTimelineProps = {
  steps?: WorkflowStep[];
  plan?: PlanItem[];
  awaiting?: boolean;
  onApprove?: () => void;
  onDecline?: () => void;
};

export function StepTimeline({
  steps = [],
  plan,
  awaiting = false,
  onApprove,
  onDecline,
}: StepTimelineProps) {
  const effectiveSteps = useMemo(() => {
    if (steps && steps.length > 0) return steps;
    if (!plan || !plan.length) return [];
    const completed = plan.filter((p) => p.status === 'done').length;
    const allDone = completed === plan.length;
    return [
      {
        id: 'step-plan',
        kind: 'plan' as const,
        title: 'Plan',
        detail: `${completed}/${plan.length} checklist items`,
        status: (allDone ? 'done' : 'active') as WorkflowStepStatus,
        startedAt: null,
        finishedAt: null,
        log: [],
      },
      {
        id: 'step-edit',
        kind: 'edit' as const,
        title: 'Edit',
        detail: allDone ? 'edits complete' : 'modifying files',
        status: (allDone ? 'done' : 'pending') as WorkflowStepStatus,
        startedAt: null,
        finishedAt: null,
        log: [],
      },
      {
        id: 'step-check',
        kind: 'check' as const,
        title: 'Check',
        detail: 'verification evidence',
        status: (allDone ? 'done' : 'pending') as WorkflowStepStatus,
        startedAt: null,
        finishedAt: null,
        log: [],
      },
      {
        id: 'step-done',
        kind: 'done' as const,
        title: 'Done',
        detail: allDone ? 'turn complete' : 'summarising',
        status: (allDone ? 'done' : 'pending') as WorkflowStepStatus,
        startedAt: null,
        finishedAt: null,
        log: [],
      },
    ];
  }, [steps, plan]);

  if (!effectiveSteps.length) return null;

  return (
    <ol className="mb-3 space-y-1.5" aria-label="Turn workflow: Plan, Edit, Check, Done">
      {effectiveSteps.map((step, i) => (
        <StepRow
          key={step.id}
          step={step}
          isLast={i === effectiveSteps.length - 1}
          plan={step.kind === 'plan' ? plan : undefined}
          awaiting={awaiting}
          onApprove={onApprove}
          onDecline={onDecline}
        />
      ))}
    </ol>
  );
}
