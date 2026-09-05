import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../lib/cn';

export type CommandAction = {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  category?: string;
  run: () => void;
};

interface Props {
  open: boolean;
  actions: CommandAction[];
  onClose: () => void;
}

export function CommandPalette({ open, actions, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((a) => {
      const hay = `${a.label} ${a.keywords ?? ''} ${a.hint ?? ''} ${a.category ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [actions, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const action = filtered[index];
        if (action) {
          onClose();
          action.run();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, filtered, index, onClose]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${index}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm px-4 pt-[14vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-surface shadow-2xl shadow-black/70 modal-animate-in"
      >
        <div className="flex items-center gap-2.5 border-b border-border bg-surface-raised/40 px-3.5 py-2.5">
          <Search size={14} className="text-zinc-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search actions…"
            className="w-full bg-transparent font-mono text-xs text-zinc-100 outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
            Esc
          </kbd>
        </div>
        <div ref={listRef} className="max-h-72 overflow-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center font-mono text-xs text-muted">No matching commands</div>
          ) : (
            filtered.map((action, i) => (
              <button
                key={action.id}
                type="button"
                data-idx={i}
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  onClose();
                  action.run();
                }}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2 text-left font-mono text-xs rounded-md transition-colors',
                  i === index
                    ? 'bg-sky-950/50 text-sky-200 border border-sky-800/40 shadow-sm'
                    : 'text-zinc-300 hover:bg-zinc-800/50 border border-transparent',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{action.label}</span>
                {action.hint ? (
                  <kbd className="shrink-0 rounded bg-surface border border-border-subtle px-1.5 py-0.5 text-[9px] text-zinc-400 font-mono">
                    {action.hint}
                  </kbd>
                ) : null}
              </button>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border bg-surface-raised/30 px-3 py-2 font-mono text-[10px] text-muted">
          <div className="flex items-center gap-2">
            <span>
              <kbd className="text-zinc-400">↑↓</kbd> navigate
            </span>
            <span>·</span>
            <span>
              <kbd className="text-zinc-400">↵</kbd> select
            </span>
          </div>
          <span>{filtered.length} actions</span>
        </div>
      </div>
    </div>
  );
}
