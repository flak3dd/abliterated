import { useMemo, useState } from 'react';
import { Download, Pin, Plus, Search, Trash2, Upload } from 'lucide-react';
import { resolveActiveSettings } from '../lib/activeEndpoint';
import { cn } from '../lib/cn';
import { deleteThread, getMessages, getThreads, uid, upsertThread } from '../lib/storage';
import { downloadThread, importThreadPayload, searchThreads } from '../lib/threadIo';
import { workspaceGate } from '../lib/workspaceGuard';
import { bridge } from '../lib/bridgeClient';
import { DEFAULT_ENABLED_TOOLS, type ClientSettings, type Thread } from '../types';

interface Props {
  threads: Thread[];
  settings: ClientSettings;
  onThreadsChange: (threads: Thread[]) => void;
  onOpenThread: (id: string) => void;
  onNewSession?: () => void;
  /** Used only by the local createSession fallback when onNewSession is absent. */
  workspaceRoot?: string;
  activeThreadId?: string | null;
  compact?: boolean;
  hideHeader?: boolean;
}

function pathBasename(path: string): string {
  const s = path.trim().replace(/[/\\]+$/, '');
  if (!s) return '';
  const parts = s.split(/[/\\]/);
  return parts[parts.length - 1] || s;
}

export function HomeScreen({
  threads,
  settings,
  onThreadsChange,
  onOpenThread,
  onNewSession,
  workspaceRoot,
  activeThreadId,
  compact,
  hideHeader,
}: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const ids = q ? new Set(searchThreads(query)) : null;
    const list = ids ? threads.filter((t) => ids.has(t.id)) : threads;
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  }, [threads, query]);

  const createSession = () => {
    if (onNewSession) {
      onNewSession();
      return;
    }
    const now = Date.now();
    const candidate = (workspaceRoot || '').trim();
    const root = workspaceGate(candidate, bridge.currentAppRoot).ok ? candidate : undefined;
    const thread: Thread = {
      id: uid('thr'),
      title: 'New session',
      model: resolveActiveSettings(settings).defaultModel,
      pinned: false,
      systemPrompt: settings.systemPrompt,
      enabledTools: [...DEFAULT_ENABLED_TOOLS],
      workspaceRoot: root,
      createdAt: now,
      updatedAt: now,
    };
    onThreadsChange(upsertThread(thread));
    onOpenThread(thread.id);
  };

  const togglePin = (thread: Thread) => {
    onThreadsChange(upsertThread({ ...thread, pinned: !thread.pinned, updatedAt: Date.now() }));
  };

  const remove = (id: string) => {
    if (!window.confirm('Delete this session and its messages?')) return;
    onThreadsChange(deleteThread(id));
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {!hideHeader ? (
        <header className={cn('flex items-center gap-2 border-b border-border', compact ? 'px-3 py-3' : 'px-4 py-3')}>
        {compact ? (
          <>
            <div className="min-w-0 flex-1 text-[13px] font-semibold tracking-tight text-foreground">Chats</div>
            <button
              type="button"
              className="btn-icon"
              title="Import chat"
              aria-label="Import chat"
              onClick={() => {
                const raw = window.prompt('Paste exported JSON or markdown');
                if (!raw?.trim()) return;
                try {
                  const t = importThreadPayload(raw);
                  onThreadsChange(getThreads());
                  onOpenThread(t.id);
                } catch (err) {
                  window.alert(err instanceof Error ? err.message : 'Import failed');
                }
              }}
            >
              <Upload size={14} />
            </button>
            <button type="button" onClick={createSession} className="btn-icon" title="New chat" aria-label="New chat">
              <Plus size={14} />
            </button>
          </>
        ) : (
          <>
            <div className="text-[13px] font-semibold tracking-tight text-foreground">Chats</div>
            <div className="relative ml-2 flex-1">
              <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search threads"
                className="field w-full py-1 pl-7 pr-2 text-[12px]"
              />
            </div>
            <button type="button" onClick={createSession} className="btn-primary">
              <Plus size={12} /> New Chat
            </button>
          </>
        )}
      </header>
      ) : null}
      {compact ? (
        <div className="border-b border-border px-3 py-2">
          <div className="relative">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="field w-full py-1 pl-7 pr-2 text-[12px]"
            />
          </div>
        </div>
      ) : null}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="mx-auto max-w-sm px-4 py-12 text-center">
            <div className="text-sm text-foreground">
              {query.trim() ? 'No matching chats' : 'No chats yet'}
            </div>
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
              {query.trim()
                ? 'Try a different search, or clear the filter.'
                : 'Create a chat to work with the agent. Pin files with @path.'}
            </p>
            {!query.trim() ? (
              <button type="button" onClick={createSession} className="btn-primary mt-4">
                <Plus size={12} /> New Chat
              </button>
            ) : null}
          </div>
        ) : (
          <ul>
            {filtered.map((t) => {
              const count = getMessages(t.id).length;
              const fullRoot = (t.workspaceRoot || '').trim();
              const dirLabel = fullRoot ? pathBasename(fullRoot) || fullRoot : 'No workspace';
              return (
                <li
                  key={t.id}
                  className={cn(
                    'flex items-center gap-2 border-b border-border px-3 py-2 hover:bg-accent/80',
                    t.id === activeThreadId && 'bg-accent',
                  )}
                >
                  <button type="button" onClick={() => togglePin(t)} className={cn('text-muted-foreground hover:text-foreground', t.pinned && 'text-warn')}>
                    <Pin size={13} fill={t.pinned ? 'currentColor' : 'none'} />
                  </button>
                  <button type="button" onClick={() => onOpenThread(t.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-[13px] text-foreground">{t.title}</div>
                    <div
                      className="truncate font-mono text-[10px] text-muted"
                      title={fullRoot || undefined}
                    >
                      <span className={fullRoot ? 'text-zinc-400' : 'text-zinc-600'}>{dirLabel}</span>
                      {' · '}
                      {t.model} · {count} msgs · {new Date(t.updatedAt).toLocaleString()}
                    </div>
                    {fullRoot ? (
                      <div className="truncate font-mono text-[10px] text-zinc-600" title={fullRoot}>
                        {fullRoot}
                      </div>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    title="Export markdown"
                    className="text-muted hover:text-sky-300"
                    onClick={() => downloadThread(t.id, 'md')}
                  >
                    <Download size={13} />
                  </button>
                  <button type="button" onClick={() => remove(t.id)} className="text-muted hover:text-red-400">
                    <Trash2 size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
