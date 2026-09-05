import { useEffect, useMemo, useState } from 'react';
import { Keyboard, Search, X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  category: string;
  keys: string[];
  description: string;
}

const SHORTCUTS: ShortcutItem[] = [
  { category: 'Navigation', keys: ['⌘', '1'], description: 'Go to Sessions (Home)' },
  { category: 'Navigation', keys: ['⌘', '2'], description: 'Go to Workspace' },
  { category: 'Navigation', keys: ['⌘', '3'], description: 'Go to Models' },
  { category: 'Navigation', keys: ['⌘', '4'], description: 'Go to Jobs' },
  { category: 'Navigation', keys: ['⌘', '5'], description: 'Go to API' },
  { category: 'Navigation', keys: ['⌘', '6'], description: 'Go to Images' },
  { category: 'Navigation', keys: ['⌘', '7'], description: 'Go to Settings' },
  { category: 'Navigation', keys: ['⌘', 'K'], description: 'Open Command Palette' },
  { category: 'Navigation', keys: ['?'], description: 'Open Keyboard Shortcuts' },
  { category: 'General', keys: ['⌘', 'N'], description: 'New Chat Session' },
  { category: 'General', keys: ['Esc'], description: 'Close modal / Stop agent / Back' },
  { category: 'Chat & Agent', keys: ['Enter'], description: 'Send message' },
  { category: 'Chat & Agent', keys: ['Shift', 'Enter'], description: 'Insert newline in composer' },
  { category: 'Chat & Agent', keys: ['@'], description: 'Trigger file mention autocomplete' },
  { category: 'Workspace', keys: ['⌘', 'S'], description: 'Save current file in editor' },
  { category: 'Workspace', keys: ['Tab'], description: 'Indent code with 2 spaces' },
];

export function ShortcutsModal({ open, onClose }: Props) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SHORTCUTS;
    return SHORTCUTS.filter(
      (s) =>
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.keys.some((k) => k.toLowerCase().includes(q)),
    );
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, ShortcutItem[]>();
    for (const item of filtered) {
      const list = map.get(item.category) || [];
      list.push(item);
      map.set(item.category, list);
    }
    return map;
  }, [filtered]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts"
        className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-lg border border-border bg-surface shadow-2xl shadow-black/70 modal-animate-in overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-surface-raised/50">
          <div className="flex items-center gap-2 font-mono text-xs font-semibold text-zinc-100">
            <Keyboard size={15} className="text-sky-400" />
            <span>KEYBOARD SHORTCUTS</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search shortcuts..."
              autoFocus
              className="field pl-8 py-1 text-xs"
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {Array.from(grouped.entries()).map(([category, items]) => (
            <div key={category}>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
                {category}
              </div>
              <div className="space-y-1.5">
                {items.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-1 px-2 rounded hover:bg-zinc-800/40 transition-colors font-mono text-xs"
                  >
                    <span className="text-zinc-300 text-[11px]">{item.description}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k, j) => (
                        <kbd
                          key={j}
                          className="inline-flex min-w-[20px] items-center justify-center rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 shadow-sm"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {filtered.length === 0 ? (
            <div className="py-8 text-center font-mono text-xs text-muted">No matching shortcuts found.</div>
          ) : null}
        </div>

        <div className="border-t border-border px-4 py-2 bg-surface-raised/30 font-mono text-[10px] text-muted flex items-center justify-between">
          <span>Tip: Press ? from anywhere to view this reference</span>
          <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-[9px] text-zinc-400">Esc</kbd>
        </div>
      </div>
    </div>
  );
}
