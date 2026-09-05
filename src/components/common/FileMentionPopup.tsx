import { useEffect, useState } from 'react';
import { File, Folder } from 'lucide-react';
import { bridge } from '../../lib/bridgeClient';
import { cn } from '../../lib/cn';

interface Props {
  query: string;
  visible: boolean;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function FileMentionPopup({ query, visible, onSelect, onClose }: Props) {
  const [candidates, setCandidates] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!visible || !bridge.connected) return;
    let active = true;

    async function fetchFiles() {
      try {
        const pattern = query.trim() ? `*${query.trim()}*` : '*';
        const res = await bridge.glob(`**/${pattern}`);
        if (!active) return;
        const lines = res.split('\n').map((s) => s.trim()).filter(Boolean);
        const filtered = lines
          .filter((p) => !p.includes('node_modules/') && !p.includes('.git/') && !p.includes('dist/'))
          .slice(0, 10);
        setCandidates(filtered);
        setSelectedIndex(0);
      } catch {
        if (active) setCandidates([]);
      }
    }

    void fetchFiles();
    return () => {
      active = false;
    };
  }, [query, visible]);

  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (candidates.length > 0 ? (prev + 1) % candidates.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          candidates.length > 0 ? (prev - 1 + candidates.length) % candidates.length : 0,
        );
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (candidates.length > 0 && candidates[selectedIndex]) {
          e.preventDefault();
          e.stopPropagation();
          onSelect(candidates[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [visible, candidates, selectedIndex, onSelect, onClose]);

  if (!visible || candidates.length === 0) return null;

  return (
    <div
      className="absolute bottom-full left-0 mb-1.5 z-30 w-80 max-h-48 overflow-auto rounded-md border border-border bg-surface-raised shadow-xl shadow-black/60 font-mono text-[11px] modal-animate-in"
      role="listbox"
      aria-label="File mentions"
    >
      <div className="border-b border-border/80 px-2 py-1 text-[10px] uppercase text-muted bg-surface/80 flex items-center justify-between">
        <span>Files (Tab / ↵ to insert)</span>
        <span className="text-[9px] text-zinc-500">@{query}</span>
      </div>
      <div className="p-1">
        {candidates.map((file, idx) => {
          const isSelected = idx === selectedIndex;
          const isDir = file.endsWith('/');
          return (
            <button
              key={file}
              type="button"
              onClick={() => onSelect(file)}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={cn(
                'flex w-full items-center gap-1.5 px-2 py-1 rounded text-left transition-colors',
                isSelected ? 'bg-sky-950/60 text-sky-200 border border-sky-800/50' : 'text-zinc-300 hover:bg-zinc-800/50',
              )}
            >
              {isDir ? <Folder size={12} className="text-amber-400 shrink-0" /> : <File size={12} className="text-sky-400 shrink-0" />}
              <span className="truncate">{file}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
