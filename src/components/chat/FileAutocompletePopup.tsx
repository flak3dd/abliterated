import { useEffect, useMemo, useRef, useState } from 'react';
import { FileCode, FileText, Folder, ImageIcon } from 'lucide-react';
import { bridge, type BridgeDirEntry } from '../../lib/bridgeClient';
import { cn } from '../../lib/cn';

interface Props {
  query: string;
  workspaceRoot: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.venv',
  '__pycache__',
  'release',
  '.ide-qa-fixtures',
]);

async function fetchAllFiles(rel = '', depth = 0, acc: { count: number } = { count: 0 }): Promise<string[]> {
  if (depth > 3 || acc.count >= 400) return [];
  try {
    const entries: BridgeDirEntry[] = await bridge.listDir(rel);
    const files: string[] = [];
    for (const e of entries) {
      if (acc.count >= 400) break;
      if (e.dir) {
        if (SKIP_DIRS.has(e.name)) continue;
        acc.count++;
        const sub = await fetchAllFiles(e.path, depth + 1, acc);
        files.push(...sub);
      } else {
        acc.count++;
        files.push(e.path);
      }
    }
    return files;
  } catch {
    return [];
  }
}

function getFileIcon(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) {
    return <span className="text-[9px] font-bold text-sky-400 shrink-0 w-3 text-center">TS</span>;
  }
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs')) {
    return <span className="text-[9px] font-bold text-amber-400 shrink-0 w-3 text-center">JS</span>;
  }
  if (lower.endsWith('.json')) {
    return <span className="text-[9px] font-bold text-amber-300 shrink-0 w-3 text-center">{'{}'}</span>;
  }
  if (lower.endsWith('.css') || lower.endsWith('.scss')) {
    return <span className="text-[9px] font-bold text-pink-400 shrink-0 w-3 text-center">#</span>;
  }
  if (lower.endsWith('.md')) {
    return <FileText size={12} className="text-zinc-400 shrink-0" />;
  }
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.svg') || lower.endsWith('.webp')) {
    return <ImageIcon size={12} className="text-purple-400 shrink-0" />;
  }
  return <FileCode size={12} className="text-zinc-500 shrink-0" />;
}

export function FileAutocompletePopup({ query, workspaceRoot, onSelect, onClose }: Props) {
  const [fileList, setFileList] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    void fetchAllFiles('', 0).then((files) => {
      if (active) setFileList(files);
    });
    return () => {
      active = false;
    };
  }, [workspaceRoot]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return fileList.slice(0, 10);
    return fileList
      .filter((p) => p.toLowerCase().includes(q))
      .slice(0, 10);
  }, [fileList, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [matches]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (matches.length > 0 ? (i + 1) % matches.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (matches.length > 0 ? (i - 1 + matches.length) % matches.length : 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (matches.length > 0 && matches[selectedIndex]) {
          e.preventDefault();
          e.stopPropagation();
          onSelect(matches[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [matches, selectedIndex, onSelect, onClose]);

  if (matches.length === 0 && !query.trim()) return null;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-4 mb-2 z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[4px] border border-border bg-panel/95 p-1 font-mono shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
    >
      <div className="flex items-center justify-between border-b border-border/60 px-2.5 py-1 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1 font-sans font-medium text-foreground">
          <Folder size={11} className="text-primary" />
          <span>Pin file to prompt</span>
        </span>
        <span className="text-[9px] text-zinc-500 font-mono">↑↓ Tab / Enter</span>
      </div>

      <div className="max-h-56 overflow-y-auto p-1">
        {matches.length === 0 ? (
          <div className="p-3 text-center text-[11px] text-zinc-500">No matching files</div>
        ) : (
          matches.map((path, idx) => {
            const parts = path.split('/');
            const filename = parts.pop() || path;
            const dir = parts.join('/');
            const isSelected = idx === selectedIndex;

            return (
              <button
                key={path}
                type="button"
                onClick={() => onSelect(path)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[2px] px-2.5 py-1.5 text-left text-[11px] transition-colors',
                  isSelected
                    ? 'bg-primary/20 text-foreground border border-primary/40 shadow-sm'
                    : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100 border border-transparent',
                )}
              >
                {getFileIcon(filename)}
                <span className="truncate font-semibold text-foreground">{filename}</span>
                {dir ? <span className="ml-auto truncate text-[10px] text-zinc-500 max-w-[120px]">{dir}</span> : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
