import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';

type Props = {
  text: string;
  /** Actively receiving reasoning with no answer yet (caller-controlled). */
  streaming?: boolean;
  /** True once displayable answer content exists — collapses Thought. */
  hasAnswer?: boolean;
  startedAt?: number;
};

function formatElapsed(startedAt?: number, streaming?: boolean): string {
  if (!startedAt) return '';
  const ms = Math.max(0, Date.now() - startedAt);
  const s = Math.max(1, Math.round(ms / 1000));
  if (streaming) return `${s}s`;
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function ReasoningTrace({ text, streaming = false, hasAnswer = false, startedAt }: Props) {
  const [open, setOpen] = useState(() => streaming || !hasAnswer);
  const [copied, setCopied] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (streaming) setOpen(true);
    else if (hasAnswer) setOpen(false);
    else setOpen(true);
  }, [streaming, hasAnswer]);

  useEffect(() => {
    if (!streaming || !startedAt) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [streaming, startedAt]);

  if (!text.trim()) return null;

  const elapsed = useMemo(() => formatElapsed(startedAt, streaming), [startedAt, streaming, tick]);

  const copy = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={cn('text-xs font-mono select-none', hasAnswer ? 'mt-2' : 'mb-2')}>
      <div className="flex items-center gap-2 text-zinc-500">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 py-0.5 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ChevronRight
            size={12}
            className={cn('transition-transform text-zinc-500', open && 'rotate-90 text-zinc-400')}
          />
          <span className={cn(streaming ? 'text-amber-400 animate-pulse font-medium' : 'text-zinc-400')}>
            {streaming ? `Thinking… ${elapsed}` : `Thought${elapsed ? ` for ${elapsed}` : ''}`}
          </span>
        </button>

        {open ? (
          <button
            type="button"
            onClick={copy}
            className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors ml-auto"
            title="Copy thought"
          >
            {copied ? <span className="text-emerald-400 font-medium">copied</span> : 'copy'}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-1.5 border-l border-zinc-800/80 pl-3 py-0.5 text-zinc-400 whitespace-pre-wrap select-text leading-relaxed text-[11px]">
          {text}
        </div>
      ) : null}
    </div>
  );
}
