import { Check, Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { PlanItem } from '../../lib/turnWorkflow';

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

  return (
    <div className="my-2.5 rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3 font-mono text-xs">
      <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-2">
        <span className="font-semibold uppercase tracking-wider text-zinc-300">
          Plan {awaiting ? '· review' : ''}
        </span>
        <span className="text-zinc-500 tabular-nums text-[10.5px]">
          {completed}/{items.length}
        </span>
      </div>

      <ul className="space-y-1.5 text-[12px]">
        {items.map((item, idx) => (
          <li key={item.id} className="flex items-start gap-2">
            {item.status === 'done' ? (
              <Check size={13} className="text-emerald-400 mt-0.5 shrink-0" strokeWidth={2.5} />
            ) : item.status === 'active' ? (
              <Loader2 size={13} className="text-sky-400 mt-0.5 shrink-0 animate-spin" />
            ) : (
              <span className="text-zinc-600 shrink-0 w-3 text-center text-[11px]">{idx + 1}.</span>
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
        <div className="mt-3 flex items-center gap-2 pt-2 border-t border-zinc-800/60">
          <button
            type="button"
            className="btn-primary h-6 px-2.5 text-[10.5px] font-mono"
            onClick={() => onApprove?.()}
          >
            Approve
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
  );
}
