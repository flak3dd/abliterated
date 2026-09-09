import { ListTodo } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { PlanItem } from '../../lib/turnWorkflow';

function ItemMarker({ status }: { status: PlanItem['status'] }) {
  if (status === 'done') {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-signal/20 text-signal">
        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3.4">
          <path d="M4 12.5l5.2 5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center">
        <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent" />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-rose-950 text-rose-400">
        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border" />;
}

export function PlanCard({
  items,
  awaiting = false,
  onApprove,
  onDecline,
}: {
  items: PlanItem[];
  awaiting?: boolean;
  onApprove?: () => void;
  onDecline?: () => void;
}) {
  if (!items.length) return null;
  const completed = items.filter((item) => item.status === 'done').length;
  const allDone = completed === items.length;
  const progress = Math.round((completed / items.length) * 100);

  return (
    <section
      className="mb-3 rounded-xl border border-border bg-surface/40 p-3"
      aria-label={`Plan checklist, ${completed} of ${items.length} tasks complete`}
    >
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400">
          <ListTodo className={cn('h-3.5 w-3.5', awaiting && 'text-sky-400')} strokeWidth={1.8} />
          {awaiting ? 'plan · review' : allDone ? 'plan · complete' : 'plan'}
        </span>
        <span
          className={cn(
            'font-mono text-[10px] tabular-nums',
            allDone && !awaiting ? 'text-signal' : 'text-zinc-500',
          )}
        >
          {completed}/{items.length}
        </span>
      </div>
      <span aria-hidden="true" className="mb-2 block h-px w-full overflow-hidden rounded-full bg-border">
        <span className="block h-full bg-signal/70 transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
      </span>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2.5 rounded-md px-0.5 py-0.5">
            <ItemMarker status={item.status} />
            <span
              className={cn(
                'text-[13px] leading-snug',
                item.status === 'done'
                  ? 'text-zinc-500'
                  : item.status === 'failed'
                    ? 'text-rose-400'
                    : 'text-zinc-200',
              )}
            >
              {item.label}
            </span>
          </li>
        ))}
      </ul>
      {awaiting ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-sky-700/70 bg-sky-950/50 px-2.5 py-1 font-mono text-[10px] text-sky-200 hover:border-sky-500"
            onClick={() => onApprove?.()}
          >
            Approve & run
          </button>
          <button
            type="button"
            className="rounded border border-border bg-surface px-2.5 py-1 font-mono text-[10px] text-zinc-300 hover:border-zinc-500"
            onClick={() => onDecline?.()}
          >
            Adjust
          </button>
        </div>
      ) : null}
    </section>
  );
}
