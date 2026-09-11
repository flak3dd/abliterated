import { useState } from 'react';
import { Sparkles, ArrowRight, CornerDownLeft, Copy, Check } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface PromptSuggestionsProps {
  suggestions: [string, string, string] | string[];
  onSend?: (text: string) => void;
  onFill?: (text: string) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}

export function PromptSuggestions({
  suggestions,
  onSend,
  onFill,
  disabled = false,
  className,
  title = 'Suggested Next Prompts',
}: PromptSuggestionsProps) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const validSuggestions = (suggestions || []).slice(0, 3).filter(Boolean);
  if (validSuggestions.length === 0) return null;

  const handleCopy = async (e: React.MouseEvent, text: string, idx: number) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      window.setTimeout(() => setCopiedIdx(null), 1400);
    } catch {
      setCopiedIdx(null);
    }
  };

  return (
    <div className={cn('mt-3 border-t border-zinc-800/80 pt-2.5', className)}>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          <Sparkles size={11} className="text-sky-400 shrink-0" />
          <span className="font-semibold text-zinc-300">{title}</span>
        </div>
        <span className="font-mono text-[9px] text-zinc-500 hidden sm:inline-block">
          Click to run · Edit to tweak
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        {validSuggestions.map((opt, i) => (
          <div
            key={i}
            className={cn(
              'group relative flex items-center justify-between gap-2 rounded-[3px] border border-border/80 bg-zinc-900/60 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-300 shadow-sm transition-all duration-150',
              !disabled && 'hover:border-sky-500/60 hover:bg-sky-950/25 hover:text-sky-200 hover:shadow-[0_0_12px_rgba(56,189,248,0.08)]',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            {/* Main prompt trigger */}
            <button
              type="button"
              disabled={disabled || !onSend}
              onClick={() => onSend?.(opt)}
              className="flex min-w-0 flex-1 items-start gap-2 text-left focus-visible:outline-none"
              title={`Run: "${opt}"`}
            >
              <span className="mt-0.5 shrink-0 rounded bg-zinc-800/80 px-1 py-0.2 font-mono text-[9.5px] font-bold text-sky-400 group-hover:bg-sky-900/50 group-hover:text-sky-300 transition-colors">
                [{i + 1}]
              </span>
              <span className="flex-1 break-words font-sans text-[12px] text-zinc-200 group-hover:text-sky-100 transition-colors">
                {opt}
              </span>
            </button>

            {/* Quick action buttons */}
            <div className="flex shrink-0 items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
              {onFill ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    onFill(opt);
                  }}
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                  title="Insert into prompt input to edit"
                >
                  <CornerDownLeft size={12} />
                </button>
              ) : null}

              <button
                type="button"
                onClick={(e) => void handleCopy(e, opt, i)}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                title={copiedIdx === i ? 'Copied' : 'Copy prompt text'}
              >
                {copiedIdx === i ? (
                  <Check size={12} className="text-emerald-400" />
                ) : (
                  <Copy size={12} />
                )}
              </button>

              {onSend ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSend(opt)}
                  className="rounded p-1 text-sky-400 hover:bg-sky-900/60 hover:text-sky-200 transition-colors"
                  title="Run this prompt now"
                >
                  <ArrowRight size={12} />
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
