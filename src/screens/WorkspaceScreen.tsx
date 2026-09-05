import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileText,
  Folder,
  ImageIcon,
  Plus,
  Plug,
  PlugZap,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { bridge, type BridgeDirEntry, type BridgeStatus } from '../lib/bridgeClient';
import { isPlaceholderRoot, setWorkspace } from '../lib/storage';
import { workspaceGate } from '../lib/workspaceGuard';
import { cn } from '../lib/cn';
import type { WorkspaceContext } from '../types';

interface Props {
  workspace: WorkspaceContext;
  onChange: (ws: WorkspaceContext) => void;
}

type TreeNode = BridgeDirEntry & { children?: TreeNode[] };

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
const MAX_DEPTH = 3;
const MAX_ENTRIES = 400;

async function waitUntilConnected(timeoutMs = 8000): Promise<void> {
  if (bridge.connected) return;
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => {
      unsub();
      reject(new Error('bridge connect timeout'));
    }, timeoutMs);
    const unsub = bridge.onStatusChange((s) => {
      if (s === 'connected') {
        window.clearTimeout(t);
        unsub();
        resolve();
      }
    });
    bridge.connect();
  });
}

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
  return nodes;
}

function getFileIcon(filename: string) {
  if (filename.endsWith('.ts') || filename.endsWith('.tsx')) {
    return <span className="text-[9px] font-bold text-sky-400 shrink-0 w-3 text-center">TS</span>;
  }
  if (filename.endsWith('.js') || filename.endsWith('.jsx') || filename.endsWith('.mjs')) {
    return <span className="text-[9px] font-bold text-amber-400 shrink-0 w-3 text-center">JS</span>;
  }
  if (filename.endsWith('.json')) {
    return <span className="text-[9px] font-bold text-amber-300 shrink-0 w-3 text-center">{}</span>;
  }
  if (filename.endsWith('.css')) {
    return <span className="text-[9px] font-bold text-pink-400 shrink-0 w-3 text-center">#</span>;
  }
  if (filename.endsWith('.md')) {
    return <FileText size={11} className="text-zinc-400 shrink-0" />;
  }
  if (filename.endsWith('.png') || filename.endsWith('.jpg') || filename.endsWith('.svg')) {
    return <ImageIcon size={11} className="text-purple-400 shrink-0" />;
  }
  return <FileCode size={11} className="text-zinc-500 shrink-0" />;
}

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query.trim()) return nodes;
  const q = query.toLowerCase();
  const out: TreeNode[] = [];

  for (const node of nodes) {
    if (node.name.toLowerCase().includes(q)) {
      out.push(node);
    } else if (node.dir && node.children) {
      const filteredChildren = filterTree(node.children, query);
      if (filteredChildren.length > 0) {
        out.push({ ...node, children: filteredChildren });
      }
    }
  }
  return out;
}

function TreeRow({
  node,
  depth,
  selected,
  expanded,
  onToggle,
  onOpen,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (node: TreeNode) => void;
}) {
  const open = expanded.has(node.path);
  return (
    <div>
      <button
        type="button"
        onClick={() => (node.dir ? onToggle(node.path) : onOpen(node))}
        className={cn(
          'flex w-full items-center gap-1.5 py-1 pr-2 text-left font-mono text-[11px] transition-colors rounded-sm',
          selected === node.path
            ? 'bg-sky-950/60 text-sky-200 border-l-2 border-sky-400'
            : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100',
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        {node.dir ? (
          open ? (
            <ChevronDown size={11} className="shrink-0 text-muted" />
          ) : (
            <ChevronRight size={11} className="shrink-0 text-muted" />
          )
        ) : (
          <span className="w-[11px] shrink-0" />
        )}
        {node.dir ? (
          <Folder size={12} className={open ? 'shrink-0 text-amber-400' : 'shrink-0 text-amber-400/80'} />
        ) : (
          getFileIcon(node.name)
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {node.dir && open && node.children
        ? node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              expanded={expanded}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))
        : null}
    </div>
  );
}

export function WorkspaceScreen({ workspace, onChange }: Props) {
  const [status, setStatus] = useState<BridgeStatus>(bridge.currentStatus);
  const [daemonRoot, setDaemonRoot] = useState(bridge.currentRoot);
  const [pathDraft, setPathDraft] = useState(workspace.rootPath);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeFilter, setTreeFilter] = useState('');
  const [treeNote, setTreeNote] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState('');
  const [savedPreview, setSavedPreview] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [treeWidth, setTreeWidth] = useState(260);
  const [isDragging, setIsDragging] = useState(false);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const u1 = bridge.onStatusChange(setStatus);
    const u2 = bridge.onRootChange(setDaemonRoot);
    return () => {
      u1();
      u2();
    };
  }, []);

  useEffect(() => {
    setPathDraft(workspace.rootPath);
  }, [workspace.rootPath]);

  const patch = (partial: Partial<WorkspaceContext>) => {
    const next = { ...workspace, ...partial };
    setWorkspace(next);
    onChange(next);
    return next;
  };

  const refreshTree = useCallback(async () => {
    if (!bridge.connected) {
      setTree([]);
      setTreeNote('bridge disconnected');
      return;
    }
    try {
      const acc = { n: 0 };
      const nodes = await loadTree('.', 0, acc);
      setTree(nodes);
      setExpanded(new Set(nodes.filter((n) => n.dir).map((n) => n.path)));
      setTreeNote(acc.n >= MAX_ENTRIES ? `capped at ${MAX_ENTRIES} entries` : `${acc.n} files`);
      try {
        const gs = await bridge.gitStatus();
        const prev = workspaceRef.current;
        const branch = gs.branch || '';
        if (prev.currentBranch !== branch || prev.isDirty !== gs.dirty) {
          const next = { ...prev, currentBranch: branch, isDirty: gs.dirty };
          setWorkspace(next);
          onChange(next);
        }
      } catch {
        const prev = workspaceRef.current;
        if (prev.currentBranch || prev.isDirty) {
          const next = { ...prev, currentBranch: '', isDirty: false };
          setWorkspace(next);
          onChange(next);
        }
      }
    } catch (err) {
      setTree([]);
      setTreeNote(err instanceof Error ? err.message : String(err));
    }
  }, [onChange]);

  const refreshGitOnly = useCallback(async () => {
    if (!bridge.connected) {
      setActionError('bridge disconnected');
      return;
    }
    setActionError('');
    try {
      const gs = await bridge.gitStatus();
      const prev = workspaceRef.current;
      const branch = gs.branch || '';
      const next = { ...prev, currentBranch: branch, isDirty: gs.dirty };
      setWorkspace(next);
      onChange(next);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [onChange]);

  useEffect(() => {
    if (status === 'connected') void refreshTree();
  }, [status, daemonRoot, refreshTree]);

  const handshake = async (mode: 'connect' | 'use') => {
    const typed = pathDraft.trim();
    setActionError('');
    setBusy(true);
    try {
      if (typed && !isPlaceholderRoot(typed)) {
        const gate = workspaceGate(typed, bridge.currentAppRoot);
        if (!gate.ok) throw new Error(gate.message);
        patch({ rootPath: typed });
      }
      if (mode === 'connect') {
        await waitUntilConnected();
      } else if (!bridge.connected) {
        setActionError('Folder saved. Connect the bridge to list and jail to it.');
        return;
      }
      if (!bridge.connected) throw new Error('Bridge disconnected');
      if (typed && !isPlaceholderRoot(typed)) {
        const gate = workspaceGate(typed, bridge.currentAppRoot);
        if (!gate.ok) throw new Error(gate.message);
        const root = await bridge.setRoot(typed);
        patch({ rootPath: root });
        setPathDraft(root);
      } else {
        const hello = await bridge.hello();
        if (hello.workspaceOk && workspaceGate(hello.root, hello.appRoot).ok) {
          patch({ rootPath: hello.root });
          setPathDraft(hello.root);
        } else {
          throw new Error(
            'Choose a project folder that is not the Abliterated install. The daemon cwd is the install and cannot be used as a workspace.',
          );
        }
      }
      await refreshTree();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (node: TreeNode) => {
    setSelectedPath(node.path);
    setPreview('');
    setSavedPreview('');
    setPreviewError('');
    setSaveStatus('');
    setCursorPos({ line: 1, col: 1 });
    if (!bridge.connected) {
      setPreviewError('bridge disconnected');
      return;
    }
    try {
      const content = await bridge.readFile(node.path);
      setPreview(content);
      setSavedPreview(content);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    }
  };

  const dirty = Boolean(selectedPath) && preview !== savedPreview;

  const saveFile = async () => {
    if (!selectedPath || !dirty || !bridge.connected) return;
    setPreviewError('');
    try {
      const ok = await bridge.writeFile(selectedPath, preview);
      if (!ok) throw new Error('write failed');
      setSavedPreview(preview);
      setSaveStatus('saved');
      window.setTimeout(() => setSaveStatus(''), 2000);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
      setSaveStatus('');
    }
  };

  const revertFile = () => {
    setPreview(savedPreview);
    setPreviewError('');
    setSaveStatus('');
  };

  const handleCreateFile = async () => {
    const path = newFilePath.trim();
    if (!path || !bridge.connected) return;
    setActionError('');
    setPreviewError('');
    try {
      const content = '// ' + path + '\n';
      const ok = await bridge.writeFile(path, content);
      if (!ok) throw new Error('write failed');
      await refreshTree();
      setSelectedPath(path);
      setPreview(content);
      setSavedPreview(content);
      setSaveStatus('created');
      setIsCreatingFile(false);
      setNewFilePath('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Draggable Divider Handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const newW = Math.max(180, Math.min(480, e.clientX - 64));
      setTreeWidth(newW);
    };
    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const updateCursorPos = () => {
    if (!textareaRef.current) return;
    const text = textareaRef.current.value.slice(0, textareaRef.current.selectionStart);
    const lines = text.split('\n');
    setCursorPos({
      line: lines.length,
      col: lines[lines.length - 1].length + 1,
    });
  };

  const filteredTree = useMemo(() => filterTree(tree, treeFilter), [tree, treeFilter]);

  const previewLines = useMemo(() => preview.split('\n'), [preview]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Top Workspace Bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <div className="font-mono text-[10px] font-semibold tracking-wide text-zinc-400">ROOT</div>
        <input
          value={pathDraft}
          onChange={(e) => setPathDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handshake('use');
            }
          }}
          placeholder="/absolute/path/to/folder"
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-500"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void handshake('use')}
          className="btn-ghost h-7 px-2 text-[10px]"
        >
          Use folder
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handshake('connect')}
          className="btn-primary h-7 px-2.5 text-[10px]"
        >
          {status === 'connected' ? <PlugZap size={11} /> : <Plug size={11} />}
          Connect
        </button>
        <button
          type="button"
          disabled={busy || status !== 'connected'}
          onClick={() => void refreshTree()}
          className="btn-ghost h-7 px-2 text-[10px]"
          title="Refresh tree"
        >
          <RefreshCw size={11} /> Refresh
        </button>
        <button
          type="button"
          disabled={busy || status !== 'connected'}
          onClick={() => void refreshGitOnly()}
          className="btn-ghost h-7 px-2 text-[10px]"
          title="Refresh git status"
        >
          git status
        </button>
      </div>

      {/* Subheader Status */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-raised/40 px-3 py-1 font-mono text-[10px] text-muted">
        <span className={status === 'connected' ? 'text-emerald-400 font-medium' : 'text-zinc-500'}>
          bridge {status}
        </span>
        <span className="text-zinc-700">·</span>
        <span className="truncate">daemon {daemonRoot || '—'}</span>
        {workspace.currentBranch ? (
          <>
            <span className="text-zinc-700">·</span>
            <span>
              branch {workspace.currentBranch}
              {workspace.isDirty ? ' · dirty' : ' · clean'}
            </span>
          </>
        ) : null}
        {treeNote ? <span className="ml-auto truncate text-zinc-500">{treeNote}</span> : null}
      </div>

      {actionError ? (
        <div className="shrink-0 border-b border-rose-950 bg-rose-950/40 px-3 py-1 font-mono text-[10px] text-rose-300">
          {actionError}
        </div>
      ) : null}

      {/* Main Workspace Explorer & Editor Split */}
      <div className="flex min-h-0 flex-1 relative">
        {/* Left: File Tree Explorer */}
        <div
          style={{ width: treeWidth }}
          className="shrink-0 flex flex-col border-r border-border bg-surface/30 select-none overflow-hidden"
        >
          {/* File search filter & New File button */}
          <div className="flex items-center gap-1.5 p-2 border-b border-border/80 bg-surface/60">
            <div className="relative flex-1">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={treeFilter}
                onChange={(e) => setTreeFilter(e.target.value)}
                placeholder="Filter files…"
                className="w-full rounded border border-border bg-background pl-6 pr-2 py-0.5 font-mono text-[10px] text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
              />
            </div>
            <button
              type="button"
              disabled={status !== 'connected'}
              onClick={() => setIsCreatingFile(true)}
              title="New file"
              className="btn-icon h-6 w-6 text-zinc-400 hover:text-zinc-100"
            >
              <Plus size={12} />
            </button>
          </div>

          {/* Inline New File Form */}
          {isCreatingFile ? (
            <div className="p-2 border-b border-border bg-surface-raised/80 flex items-center gap-1 modal-animate-in">
              <input
                value={newFilePath}
                onChange={(e) => setNewFilePath(e.target.value)}
                placeholder="filename.ts"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreateFile();
                  if (e.key === 'Escape') setIsCreatingFile(false);
                }}
                className="flex-1 rounded border border-sky-500 bg-background px-2 py-0.5 font-mono text-[10px] text-zinc-100 outline-none"
              />
              <button
                type="button"
                onClick={() => void handleCreateFile()}
                className="btn-primary h-6 px-1.5 text-[9px]"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setIsCreatingFile(false)}
                className="btn-ghost h-6 w-6 p-0"
              >
                <X size={10} />
              </button>
            </div>
          ) : null}

          {/* File Tree List */}
          <div className="flex-1 overflow-auto p-1">
            {status !== 'connected' ? (
              <div className="px-3 py-6 font-mono text-[11px] text-muted text-center">
                Connect the bridge to list files.
              </div>
            ) : filteredTree.length === 0 ? (
              <div className="px-3 py-6 font-mono text-[11px] text-muted text-center">
                {treeFilter ? 'No matching files.' : 'Empty or unreadable.'}
              </div>
            ) : (
              filteredTree.map((node) => (
                <TreeRow
                  key={node.path}
                  node={node}
                  depth={0}
                  selected={selectedPath}
                  expanded={expanded}
                  onToggle={toggle}
                  onOpen={(n) => void openFile(n)}
                />
              ))
            )}
          </div>
        </div>

        {/* Resizable Divider Handle */}
        <div
          onMouseDown={() => setIsDragging(true)}
          className="w-1 hover:w-1.5 bg-border/40 hover:bg-sky-500/60 cursor-col-resize transition-all shrink-0 select-none z-10"
          title="Drag to resize explorer"
        />

        {/* Right: Code Editor + Scratchpad */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Editor Header */}
          <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
            <div className="min-w-0 flex-1 flex items-center gap-2">
              <span className="truncate font-mono text-[11px] font-semibold text-zinc-200">
                {selectedPath || 'No file selected'}
              </span>
              {dirty ? (
                <span className="rounded bg-amber-950/70 border border-amber-800/40 px-1.5 py-0.2 font-mono text-[9px] text-amber-300">
                  unsaved
                </span>
              ) : null}
              {saveStatus ? (
                <span className="font-mono text-[10px] text-emerald-400 font-medium">{saveStatus}</span>
              ) : null}
            </div>

            <button
              type="button"
              disabled={!dirty}
              onClick={revertFile}
              className="btn-ghost h-6 px-2 text-[10px] disabled:opacity-30"
            >
              Revert
            </button>
            <button
              type="button"
              disabled={!dirty || status !== 'connected'}
              onClick={() => void saveFile()}
              className="btn-primary h-6 px-2.5 text-[10px] disabled:opacity-30"
            >
              Save (⌘S)
            </button>
          </div>

          {previewError ? (
            <div className="shrink-0 px-3 py-2 font-mono text-[10px] text-rose-300 border-b border-rose-950 bg-rose-950/30">
              {previewError}
            </div>
          ) : null}

          {/* Editor Canvas with Line Numbers Gutter */}
          <div className="flex min-h-0 flex-1 relative bg-zinc-950">
            {selectedPath ? (
              <div className="flex h-full w-full overflow-hidden">
                {/* Line numbers gutter */}
                <div className="w-10 shrink-0 select-none text-right pr-2 pt-3 font-mono text-[11px] leading-5 text-zinc-600 bg-surface/20 border-r border-border/40 overflow-hidden">
                  {previewLines.map((_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>

                {/* Editor Textarea with Tab indentation */}
                <textarea
                  ref={textareaRef}
                  value={preview}
                  onChange={(e) => {
                    setPreview(e.target.value);
                    setSaveStatus('');
                    updateCursorPos();
                  }}
                  onKeyUp={updateCursorPos}
                  onClick={updateCursorPos}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                      e.preventDefault();
                      void saveFile();
                    } else if (e.key === 'Tab') {
                      e.preventDefault();
                      const target = e.currentTarget;
                      const start = target.selectionStart;
                      const end = target.selectionEnd;
                      const next = preview.slice(0, start) + '  ' + preview.slice(end);
                      setPreview(next);
                      setSaveStatus('');
                      window.requestAnimationFrame(() => {
                        target.selectionStart = target.selectionEnd = start + 2;
                        updateCursorPos();
                      });
                    }
                  }}
                  spellCheck={false}
                  className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[11px] leading-5 text-zinc-200 outline-none overflow-auto"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center w-full h-full text-center p-6 text-muted font-mono text-xs">
                <FileCode size={32} className="text-zinc-700 mb-2" />
                <span>Select a file from the explorer to preview and edit.</span>
                <span className="text-[10px] text-zinc-600 mt-1">Press ⌘S to save changes anytime.</span>
              </div>
            )}
          </div>

          {/* Editor Footer Status Bar */}
          {selectedPath ? (
            <div className="flex items-center justify-between border-t border-border bg-surface px-3 py-1 font-mono text-[10px] text-muted select-none">
              <div className="flex items-center gap-3">
                <span>
                  Ln {cursorPos.line}, Col {cursorPos.col}
                </span>
                <span>·</span>
                <span>{previewLines.length} lines</span>
                <span>·</span>
                <span>{preview.length.toLocaleString()} characters</span>
              </div>
              <div className="flex items-center gap-2">
                <span>UTF-8</span>
                <span>·</span>
                <span>Tab: 2 spaces</span>
              </div>
            </div>
          ) : null}

          {/* Scratchpad Collapsible Drawer */}
          <div className="flex h-32 shrink-0 flex-col border-t border-border bg-surface/50">
            <div className="flex items-center justify-between px-3 py-1 font-mono text-[10px] uppercase text-muted bg-surface/80 border-b border-border/50">
              <span className="font-semibold text-zinc-400">Workspace Scratchpad</span>
              <span className="text-[9px] text-zinc-500">Auto-saved to localStorage</span>
            </div>
            <textarea
              value={workspace.scratchpadContent}
              onChange={(e) => patch({ scratchpadContent: e.target.value })}
              placeholder="Quick notes, snippets, or prompt ideas..."
              className="min-h-0 flex-1 resize-none bg-transparent p-2.5 font-mono text-[11px] leading-5 text-zinc-300 outline-none placeholder:text-zinc-600"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
