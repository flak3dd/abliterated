import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Copy,
  ExternalLink,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  ImageIcon,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { bridge, type BridgeDirEntry } from '../../lib/bridgeClient';
import { cn } from '../../lib/cn';

export type TreeNode = BridgeDirEntry & { children?: TreeNode[] };

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.venv',
  '__pycache__',
  'release',
  '.ide-qa-fixtures',
]);
const MAX_DEPTH = 3;
const MAX_ENTRIES = 500;

async function loadTree(rel: string, depth: number, acc: { n: number }): Promise<TreeNode[]> {
  if (depth > MAX_DEPTH || acc.n >= MAX_ENTRIES) return [];
  let entries: BridgeDirEntry[] = [];
  try {
    entries = await bridge.listDir(rel);
  } catch {
    return [];
  }
  const nodes: TreeNode[] = [];
  for (const e of entries) {
    if (acc.n >= MAX_ENTRIES) break;
    if (e.dir && SKIP_DIRS.has(e.name)) continue;
    acc.n += 1;
    const node: TreeNode = { name: e.name, path: e.path, dir: e.dir };
    if (e.dir && depth < MAX_DEPTH) {
      node.children = await loadTree(e.path, depth + 1, acc);
    }
    nodes.push(node);
  }
  nodes.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
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
  if (lower.endsWith('.py')) {
    return <span className="text-[9px] font-bold text-emerald-400 shrink-0 w-3 text-center">PY</span>;
  }
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) {
    return <span className="text-[9px] font-bold text-emerald-300 shrink-0 w-3 text-center">SH</span>;
  }
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    return <span className="text-[9px] font-bold text-rose-400 shrink-0 w-3 text-center">YM</span>;
  }
  if (lower.endsWith('.md')) {
    return <FileText size={11} className="text-zinc-400 shrink-0" />;
  }
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.svg') || lower.endsWith('.webp')) {
    return <ImageIcon size={11} className="text-purple-400 shrink-0" />;
  }
  return <FileCode size={11} className="text-zinc-500 shrink-0" />;
}

function filterTree(nodes: TreeNode[], query: string): { filtered: TreeNode[]; matchCount: number } {
  if (!query.trim()) return { filtered: nodes, matchCount: 0 };
  const q = query.toLowerCase();
  let count = 0;

  function walk(items: TreeNode[]): TreeNode[] {
    const out: TreeNode[] = [];
    for (const item of items) {
      if (item.dir && item.children) {
        const sub = walk(item.children);
        if (sub.length > 0 || item.name.toLowerCase().includes(q)) {
          if (item.name.toLowerCase().includes(q)) count++;
          out.push({ ...item, children: sub });
        }
      } else if (item.name.toLowerCase().includes(q)) {
        count++;
        out.push(item);
      }
    }
    return out;
  }

  return { filtered: walk(nodes), matchCount: count };
}

function collectAllDirs(nodes: TreeNode[], set: Set<string>) {
  for (const n of nodes) {
    if (n.dir) {
      set.add(n.path);
      if (n.children) collectAllDirs(n.children, set);
    }
  }
}

interface TreeItemProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onPinFile: (path: string) => void;
  onOpenFileInEditor?: (path: string) => void;
  selectedPath?: string | null;
}

function SidebarTreeRow({
  node,
  depth,
  expanded,
  onToggle,
  onPinFile,
  onOpenFileInEditor,
  selectedPath,
}: TreeItemProps) {
  const open = expanded.has(node.path);
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(node.path);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <div
        className={cn(
          'group relative flex w-full items-center gap-1.5 py-1 pr-1.5 text-left font-mono text-[11px] transition-colors rounded-sm cursor-pointer select-none',
          selectedPath === node.path
            ? 'bg-sky-950/60 text-sky-200 border-l-2 border-sky-400'
            : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100',
        )}
        style={{ paddingLeft: 4 + depth * 10 }}
        onClick={() => (node.dir ? onToggle(node.path) : onPinFile(node.path))}
        title={node.dir ? `Folder: ${node.path}` : `Click to pin @${node.path} in chat`}
      >
        {node.dir ? (
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-muted-foreground">
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        {node.dir ? (
          <Folder size={12} className={open ? 'shrink-0 text-amber-400' : 'shrink-0 text-amber-400/80'} />
        ) : (
          getFileIcon(node.name)
        )}

        <span className="truncate flex-1 text-[11px]">{node.name}</span>

        {/* Action icons on hover */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 ml-auto shrink-0 transition-opacity">
          {!node.dir ? (
            <>
              <button
                type="button"
                className="rounded p-0.5 text-zinc-400 hover:text-sky-300 hover:bg-zinc-700/50"
                title="Pin @path to prompt"
                onClick={(e) => {
                  e.stopPropagation();
                  onPinFile(node.path);
                }}
              >
                <Plus size={11} />
              </button>
              <button
                type="button"
                className="rounded p-0.5 text-zinc-400 hover:text-emerald-300 hover:bg-zinc-700/50"
                title={copied ? 'Copied path!' : 'Copy path'}
                onClick={handleCopy}
              >
                <Copy size={10} />
              </button>
              {onOpenFileInEditor ? (
                <button
                  type="button"
                  className="rounded p-0.5 text-zinc-400 hover:text-amber-300 hover:bg-zinc-700/50"
                  title="Open in Workspace Editor"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenFileInEditor(node.path);
                  }}
                >
                  <ExternalLink size={10} />
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {node.dir && open && node.children
        ? node.children.map((child) => (
            <SidebarTreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onPinFile={onPinFile}
              onOpenFileInEditor={onOpenFileInEditor}
              selectedPath={selectedPath}
            />
          ))
        : null}
    </div>
  );
}

export interface SidebarFileTreeProps {
  workspaceRoot: string;
  onChooseWorkspace?: (path: string) => Promise<void>;
  onPinFile: (path: string) => void;
  onOpenFileInEditor?: (path: string) => void;
  selectedPath?: string | null;
}

export function SidebarFileTree({
  workspaceRoot,
  onChooseWorkspace,
  onPinFile,
  onOpenFileInEditor,
  selectedPath,
}: SidebarFileTreeProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinnedFeedback, setPinnedFeedback] = useState<string | null>(null);

  const folderBasename = useMemo(() => {
    const s = (workspaceRoot || '').trim().replace(/[/\\]+$/, '');
    if (!s) return 'Workspace';
    const parts = s.split(/[/\\]/);
    return parts[parts.length - 1] || s;
  }, [workspaceRoot]);

  const refreshTree = useCallback(async () => {
    if (!workspaceRoot) return;
    setLoading(true);
    setError(null);
    try {
      const nodes = await loadTree('', 1, { n: 0 });
      setTree(nodes);
      // Auto-expand top level folders with few items
      setExpanded((prev) => {
        if (prev.size > 0) return prev;
        const next = new Set<string>();
        for (const n of nodes) {
          if (n.dir && (n.children?.length ?? 0) <= 8) {
            next.add(n.path);
          }
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list directory');
    } finally {
      setLoading(false);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  // Listen to bridge file mutations if possible
  useEffect(() => {
    const unsub = bridge.onRootChange(() => {
      void refreshTree();
    });
    return () => unsub();
  }, [refreshTree]);

  const toggleFolder = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleCollapseAll = () => {
    setExpanded(new Set());
  };

  const handleExpandAll = () => {
    const all = new Set<string>();
    collectAllDirs(tree, all);
    setExpanded(all);
  };

  const handlePin = useCallback(
    (path: string) => {
      onPinFile(path);
      setPinnedFeedback(`@${path}`);
      setTimeout(() => setPinnedFeedback(null), 1800);
    },
    [onPinFile],
  );

  const handleCreateFile = async () => {
    const rel = window.prompt('New file path relative to workspace root (e.g. src/utils/helpers.ts):');
    if (!rel?.trim()) return;
    try {
      await bridge.writeFile(rel.trim(), '');
      await refreshTree();
      handlePin(rel.trim());
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not create file');
    }
  };

  const { filtered, matchCount } = useMemo(() => {
    return filterTree(tree, filter);
  }, [tree, filter]);

  // Auto-expand all when searching so matches are visible
  useEffect(() => {
    if (filter.trim()) {
      const matchingDirs = new Set<string>();
      collectAllDirs(filtered, matchingDirs);
      setExpanded(matchingDirs);
    }
  }, [filter, filtered]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-sidebar select-none font-sans">
      {/* Workspace directory banner */}
      <div className="flex items-center justify-between border-b border-border/70 px-2.5 py-1.5 bg-panel/30">
        <button
          type="button"
          onClick={() => void onChooseWorkspace?.(workspaceRoot)}
          className="flex items-center gap-1.5 min-w-0 text-left hover:text-foreground transition-colors group"
          title={`Root: ${workspaceRoot || 'None'} (Click to switch folder)`}
        >
          <FolderOpen size={13} className="shrink-0 text-primary" />
          <span className="truncate font-mono text-[11px] font-medium text-foreground group-hover:underline">
            {folderBasename}
          </span>
        </button>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={handleCreateFile}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title="New File"
            aria-label="New File"
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            onClick={expanded.size > 0 ? handleCollapseAll : handleExpandAll}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title={expanded.size > 0 ? 'Collapse all folders' : 'Expand all folders'}
            aria-label="Toggle folder expansion"
          >
            <ChevronsDownUp size={12} />
          </button>
          <button
            type="button"
            onClick={() => void refreshTree()}
            className={cn(
              'rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors',
              loading && 'animate-spin text-primary',
            )}
            title="Refresh file tree"
            aria-label="Refresh file tree"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="border-b border-border/70 px-2 py-1.5">
        <div className="relative">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files..."
            className="field w-full py-0.5 pl-6 pr-6 text-[11px] font-mono h-7"
          />
          {filter ? (
            <button
              type="button"
              onClick={() => setFilter('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              title="Clear filter"
            >
              <X size={11} />
            </button>
          ) : null}
        </div>
        {filter.trim() ? (
          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground px-1">
            <span>{matchCount} matches</span>
            <span className="font-mono text-[9px] text-zinc-500">Press Esc to clear</span>
          </div>
        ) : null}
      </div>

      {/* Floating feedback when a file is pinned into prompt */}
      {pinnedFeedback ? (
        <div className="bg-sky-950/80 border-b border-sky-800/80 px-2.5 py-1 text-[10px] font-mono text-sky-200 flex items-center justify-between animate-in fade-in slide-in-from-top-1 duration-150">
          <span className="truncate">Pinned {pinnedFeedback}</span>
          <span className="text-[9px] text-sky-400">added to prompt</span>
        </div>
      ) : null}

      {/* File Tree List */}
      <div className="flex-1 overflow-auto py-1 px-1">
        {error ? (
          <div className="p-3 text-center text-[11px] text-rose-400">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void refreshTree()}
              className="btn-ghost mt-2 h-6 px-2 text-[10px]"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-muted-foreground text-[11px]">
            {filter.trim() ? (
              <>
                <p>No files matching "{filter}"</p>
                <button
                  type="button"
                  onClick={() => setFilter('')}
                  className="btn-ghost mt-2 h-6 px-2 text-[10px]"
                >
                  Clear filter
                </button>
              </>
            ) : loading ? (
              <div className="flex items-center justify-center gap-2 text-zinc-500 text-[11px]">
                <RefreshCw size={12} className="animate-spin" />
                <span>Reading tree...</span>
              </div>
            ) : (
              <div>
                <p>No workspace files found.</p>
                <button
                  type="button"
                  onClick={() => void onChooseWorkspace?.(workspaceRoot)}
                  className="btn-ghost mt-2 h-6 px-2 text-[10px]"
                >
                  Select folder
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((node) => (
              <SidebarTreeRow
                key={node.path}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggleFolder}
                onPinFile={handlePin}
                onOpenFileInEditor={onOpenFileInEditor}
                selectedPath={selectedPath}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="border-t border-border/60 px-2 py-1 bg-surface/30 font-mono text-[9px] text-zinc-500 flex items-center justify-between">
        <span>Click file to pin @path</span>
        <span className="text-zinc-600">bridge :17322</span>
      </div>
    </div>
  );
}
