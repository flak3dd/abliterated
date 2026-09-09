/** Export / import chat threads as markdown or JSON. */

import type { Message, Thread } from '../types';
import { getMessages, getThreads, uid, upsertThread, replaceThreadMessages } from './storage';
import { threadToMarkdown } from './threadMarkdown';

export { threadToMarkdown };

export type ThreadExport = {
  version: 1;
  exportedAt: number;
  thread: Thread;
  messages: Message[];
};

export function exportThreadPayload(threadId: string): ThreadExport | null {
  const thread = getThreads().find((t) => t.id === threadId);
  if (!thread) return null;
  return {
    version: 1,
    exportedAt: Date.now(),
    thread,
    messages: getMessages(threadId),
  };
}

export function downloadThread(threadId: string, format: 'md' | 'json' = 'md'): boolean {
  const payload = exportThreadPayload(threadId);
  if (!payload) return false;
  const safe = (payload.thread.title || 'chat').replace(/[^\w.-]+/g, '_').slice(0, 48);
  const blob =
    format === 'json'
      ? new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      : new Blob([threadToMarkdown(payload.thread, payload.messages)], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${safe}.${format === 'json' ? 'json' : 'md'}`;
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}

export function importThreadPayload(raw: string): Thread {
  const trimmed = raw.trim();
  let parsed: ThreadExport | null = null;
  if (trimmed.startsWith('{')) {
    const json = JSON.parse(trimmed) as Partial<ThreadExport>;
    if (json.thread && Array.isArray(json.messages)) {
      parsed = json as ThreadExport;
    }
  }
  if (!parsed) {
    const title = trimmed.match(/^#\s+(.+)$/m)?.[1]?.trim() || 'Imported chat';
    const now = Date.now();
    const thread: Thread = {
      id: uid('thr'),
      title,
      model: '',
      pinned: false,
      systemPrompt: '',
      enabledTools: [],
      createdAt: now,
      updatedAt: now,
    };
    const messages: Message[] = [
      {
        id: uid('msg'),
        threadId: thread.id,
        role: 'user',
        content: trimmed,
        createdAt: now,
      },
    ];
    upsertThread(thread);
    replaceThreadMessages(thread.id, messages);
    return thread;
  }
  const now = Date.now();
  const thread: Thread = {
    ...parsed.thread,
    id: uid('thr'),
    pinned: false,
    createdAt: now,
    updatedAt: now,
    title: (parsed.thread.title || 'Imported chat') + ' (import)',
  };
  const messages = parsed.messages.map((m) => ({
    ...m,
    id: uid('msg'),
    threadId: thread.id,
  }));
  upsertThread(thread);
  replaceThreadMessages(thread.id, messages);
  return thread;
}

export function searchThreads(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return getThreads().map((t) => t.id);
  const hits = new Set<string>();
  for (const t of getThreads()) {
    if (
      t.title.toLowerCase().includes(q) ||
      t.model.toLowerCase().includes(q) ||
      (t.workspaceRoot || '').toLowerCase().includes(q)
    ) {
      hits.add(t.id);
    }
  }
  for (const m of getMessages()) {
    if ((m.content || '').toLowerCase().includes(q)) hits.add(m.threadId);
  }
  return [...hits];
}
