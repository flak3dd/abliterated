import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { ChevronRight, Brain, Sparkles, Copy, Check, ListTree, AlignLeft } from 'lucide-react';
import { cn } from '../../lib/cn';
import { parseThoughtChunks } from '../../lib/thoughtChunks';

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
  const [viewMode, setViewMode] = useState<'chunks' | 'raw'>('chunks');

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

  const chunks = useMemo(() => parseThoughtChunks(text), [text]);

  const elapsed = useMemo(() => formatElapsed(startedAt, streaming), [startedAt, streaming, tick]);

  if (!text.trim() || chunks.length === 0) return null;

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

  const activeChunk = chunks[chunks.length - 1];

  return (
    <div className={cn('text-xs font-mono select-none my-2.5 rounded-[4px] border border-border/70 bg-zinc-950/60 p-2 shadow-sm backdrop-blur-sm transition-all', hasAnswer ? 'mt-3' : 'mb-3')}>
      {/* Dropdown Header */}
      <div className="flex items-center justify-between gap-2 text-zinc-400">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="group flex min-w-0 flex-1 items-center gap-2 text-left py-0.5 hover:text-zinc-200 transition-colors focus-visible:outline-none"
        >
          <ChevronRight
            size={12}
            className={cn('transition-transform duration-150 shrink-0 text-zinc-500 group-hover:text-zinc-300', open && 'rotate-90 text-zinc-400')}
          />

          {streaming ? (
            <Brain size={12} className="text-amber-400 animate-pulse shrink-0" />
          ) : (
            <Sparkles size={12} className="text-sky-400 shrink-0" />
          )}

          <div className="flex min-w-0 items-center gap-1.5 truncate text-[11px]">
            <span className={cn('font-semibold font-mono tracking-wide', streaming ? 'text-amber-300' : 'text-zinc-300')}>
              {streaming ? 'Thinking…' : 'Thought Process'}
            </span>

            {elapsed ? (
              <span className="rounded bg-zinc-900 px-1.5 py-0.2 font-mono text-[9.5px] text-zinc-400 border border-zinc-800">
                {elapsed}
              </span>
            ) : null}

            <span className="rounded bg-sky-950/60 px-1.5 py-0.2 font-mono text-[9.5px] text-sky-300 border border-sky-800/40 shrink-0">
              {chunks.length} {chunks.length === 1 ? 'chunk' : 'chunks'}
            </span>

            {streaming && activeChunk ? (
              <span className="truncate text-zinc-400 font-sans text-[11px] opacity-80 hidden sm:inline">
                · {activeChunk.title}
              </span>
            ) : null}
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {open && chunks.length > 1 ? (
            <div className="flex items-center rounded border border-zinc-800 bg-zinc-900/90 p-0.5 text-[9.5px] font-mono mr-1">
              <button
                type="button"
                onClick={() => setViewMode('chunks')}
                className={cn(
                  'flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] transition-colors',
                  viewMode === 'chunks'
                    ? 'bg-zinc-800 text-sky-300 font-semibold'
                    : 'text-zinc-500 hover:text-zinc-300',
                )}
                title="View structured thought chunks"
              >
                <ListTree size={10} />
                <span>Chunks</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('raw')}
                className={cn(
                  'flex items-center gap-1 px-1.5 py-0.5 rounded-[2px] transition-colors',
                  viewMode === 'raw'
                    ? 'bg-zinc-800 text-sky-300 font-semibold'
                    : 'text-zinc-500 hover:text-zinc-300',
                )}
                title="View continuous raw text"
              >
                <AlignLeft size={10} />
                <span>Raw</span>
              </button>
            </div>
          ) : null}

          {open ? (
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1 rounded border border-border/60 bg-zinc-900/80 px-1.5 py-0.5 text-[9.5px] font-mono text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
              title="Copy full thought process"
            >
              {copied ? (
                <>
                  <Check size={10} className="text-emerald-400" />
                  <span className="text-emerald-400 font-medium">Copied</span>
                </>
              ) : (
                <>
                  <Copy size={10} />
                  <span>Copy</span>
                </>
              )}
            </button>
          ) : null}
        </div>
      </div>

      {/* Dropdown Body: Structured Chunks as opposed to raw wall-of-text */}
      {open ? (
        <div className="mt-2.5 border-t border-zinc-800/80 pt-2">
          {viewMode === 'chunks' ? (
            <div className="max-h-72 overflow-y-auto pr-1 space-y-2 select-text">
              {chunks.map((chunk, idx) => {
                const isCurrent = streaming && idx === chunks.length - 1;
                return (
                  <div
                    key={chunk.id}
                    className={cn(
                      'rounded-[3px] border p-2 transition-all',
                      isCurrent
                        ? 'border-amber-700/60 bg-amber-950/20 shadow-[0_0_10px_rgba(245,158,11,0.05)]'
                        : 'border-zinc-800/70 bg-zinc-900/40 hover:border-zinc-700/80',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 font-mono text-[10px]">
                        <span className="rounded bg-zinc-800/90 px-1 py-0.2 font-bold text-sky-400">
                          Chunk {chunk.id}
                        </span>
                        <span className="font-semibold text-zinc-200 truncate max-w-[320px]">
                          {chunk.title}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 text-[9.5px] font-mono text-zinc-500">
                        {isCurrent ? (
                          <span className="flex items-center gap-1 text-amber-400 font-medium">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
                            Active
                          </span>
                        ) : (
                          <span>{chunk.wordCount} words</span>
                        )}
                      </div>
                    </div>

                    <div className="whitespace-pre-wrap text-[11.5px] leading-relaxed font-sans text-zinc-300/90">
                      {chunk.content}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-[3px] border border-zinc-800/80 bg-zinc-900/60 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-400 whitespace-pre-wrap select-text">
              {text}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
