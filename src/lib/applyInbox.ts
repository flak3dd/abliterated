/** Persistent pending-diff inbox when auto-accept is off. */

import type { GrokApplyResult, GrokEdit } from './grokLayer';
import { applyGrokEdits } from './grokLayer';
import { bridge } from './bridgeClient';
import { uid } from './storage';

export type ApplyInboxItem = {
  id: string;
  file: string;
  kind: 'patch' | 'write';
  patch?: string;
  content?: string;
  createdAt: number;
  source?: string;
};

type Listener = (items: ApplyInboxItem[]) => void;

const items: ApplyInboxItem[] = [];
const listeners = new Set<Listener>();

function notify(): void {
  const snap = [...items];
  listeners.forEach((cb) => cb(snap));
}

export function subscribeApplyInbox(cb: Listener): () => void {
  listeners.add(cb);
  cb([...items]);
  return () => listeners.delete(cb);
}

export function listApplyInbox(): ApplyInboxItem[] {
  return [...items];
}

export function enqueuePendingEdits(edits: GrokEdit[], source?: string): ApplyInboxItem[] {
  const added: ApplyInboxItem[] = [];
  for (const edit of edits) {
    const file = (edit.file || '').trim();
    if (!file) continue;
    const existing = items.findIndex((i) => i.file === file && i.kind === edit.kind);
    const row: ApplyInboxItem = {
      id: uid('diff'),
      file,
      kind: edit.kind,
      patch: edit.patch,
      content: edit.content,
      createdAt: Date.now(),
      source,
    };
    if (existing >= 0) items.splice(existing, 1, row);
    else items.unshift(row);
    added.push(row);
  }
  if (added.length) notify();
  return added;
}

export function rejectInboxItem(id: string): void {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return;
  items.splice(i, 1);
  notify();
}

export function clearApplyInbox(): void {
  if (!items.length) return;
  items.splice(0, items.length);
  notify();
}

export async function acceptInboxItem(id: string, root?: string): Promise<GrokApplyResult> {
  const item = items.find((x) => x.id === id);
  if (!item) throw new Error('Diff is no longer in the inbox');
  const edit: GrokEdit = {
    file: item.file,
    kind: item.kind,
    patch: item.patch,
    content: item.content,
  };
  const results = await applyGrokEdits([edit], {
    autoAccept: true,
    writeToWorkspace: true,
    root: root || bridge.currentRoot,
  });
  const first = results[0];
  if (first?.status === 'ok') {
    rejectInboxItem(id);
  }
  return first || { file: item.file, kind: item.kind, status: 'error', error: 'empty apply' };
}

export async function acceptAllInbox(root?: string): Promise<GrokApplyResult[]> {
  const snapshot = [...items];
  const out: GrokApplyResult[] = [];
  for (const item of snapshot) {
    out.push(await acceptInboxItem(item.id, root));
  }
  return out;
}
