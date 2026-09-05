import { useMemo, useState } from 'react';
import { Pin, Plus, Search, Trash2 } from 'lucide-react';
import { resolveActiveSettings } from '../lib/activeEndpoint';
import { cn } from '../lib/cn';
import { deleteThread, getMessages, uid, upsertThread } from '../lib/storage';
import { DEFAULT_ENABLED_TOOLS, type ClientSettings, type Thread } from '../types';

interface Props {
  threads: Thread[];
  settings: ClientSettings;
  onThreadsChange: (threads: Thread[]) => void;
  onOpenThread: (id: string) => void;
  onNewSession?: () => void;
  /** Used only by the local createSession fallback when onNewSession is absent. */
  workspaceRoot?: string;
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
}: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? threads.filter(
          (t) =>
            t.title.toLowerCase().includes(q) ||
            t.model.toLowerCase().includes(q) ||
            (t.workspaceRoot || '').toLowerCase().includes(q),
        )
      : threads;
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
    const root = (workspaceRoot || '').trim() || undefined;
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
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <div className="font-mono text-xs font-semibold tracking-wide text-zinc-200">SESSIONS</div>
        <div className="relative ml-2 flex-1">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search threads"
            className="field w-full py-1 pl-7 pr-2 text-[11px]"
          />
        </div>
        <button
          type="button"
          onClick={createSession}
          className="btn-primary"
        >
          <Plus size={12} /> New Session
        </button>
      </header>
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="mx-auto max-w-sm px-4 py-12 text-center">
            <div className="font-mono text-xs text-zinc-300">
              {query.trim() ? 'No matching sessions' : 'No sessions yet'}
            </div>
            <p className="mt-2 font-mono text-[11px] leading-5 text-muted">
              {query.trim()
                ? 'Try a different search, or clear the filter.'
                : 'Create a session to chat with the agent. Pin files with @path and use Continue chips after a turn.'}
            </p>
            {!query.trim() ? (
              <button type="button" onClick={createSession} className="btn-primary mt-4">
                <Plus size={12} /> New Session
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
                <li key={t.id} className="flex items-center gap-2 border-b border-border px-4 py-2 hover:bg-zinc-900/70">
                  <button type="button" onClick={() => togglePin(t)} className={cn('text-muted hover:text-zinc-200', t.pinned && 'text-amber-400')}>
                    <Pin size={13} fill={t.pinned ? 'currentColor' : 'none'} />
                  </button>
                  <button type="button" onClick={() => onOpenThread(t.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate font-mono text-xs text-zinc-200">{t.title}</div>
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
