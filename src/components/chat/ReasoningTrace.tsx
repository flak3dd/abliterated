import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Brain, Check, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { cn } from '../../lib/cn';
import { splitReasoningSections } from '../../lib/reasoningWork';

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
  const sections = useMemo(() => splitReasoningSections(text), [text]);
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
  const meta = [
    streaming ? 'active' : null,
    sections.length > 1 ? `${sections.length} steps` : null,
    elapsed ? (streaming ? elapsed : `thought ${elapsed}`) : null,
  ]
    .filter(Boolean)
    .join(' · ');

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
    <div className={cn('reasoning-trace', hasAnswer ? 'mt-2.5' : 'mb-2.5')}>
      <div className="reasoning-trace-bar">
        <button
          type="button"
          className="reasoning-trace-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown size={14} className="shrink-0 text-amber-400/90" /> : <ChevronRight size={14} className="shrink-0 text-amber-400/90" />}
          <Brain size={13} className={cn('shrink-0 text-amber-400', streaming && 'animate-pulse')} />
          <span className="font-medium text-zinc-200">{streaming ? 'Thinking…' : 'Thought'}</span>
          {meta ? <span className="text-zinc-500">{meta}</span> : null}
        </button>
        <button
          type="button"
          className="reasoning-trace-copy"
          onClick={copy}
        >
          {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {open ? (
        <div className="reasoning-trace-body">
          {sections.map((sec, i) => {
            const nested = sections.length > 1;
            if (!nested) {
              return (
                <div key={sec.id} className="reasoning-trace-prose">
                  {sec.body}
                </div>
              );
            }
            return (
              <details
                key={sec.id}
                className="reasoning-sub"
                open={streaming ? i === sections.length - 1 : i === 0}
              >
                <summary>
                  <ChevronRight size={12} className="reasoning-sub-chevron" />
                  {sec.title}
                </summary>
                <div className="reasoning-trace-prose">{sec.body}</div>
              </details>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
