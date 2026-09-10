import { useEffect, useState } from 'react';
import { Check, FolderOpen, Trash2, X } from 'lucide-react';
import {
  acceptAllInbox,
  acceptInboxItem,
  clearApplyInbox,
  rejectInboxItem,
  subscribeApplyInbox,
  type ApplyInboxItem,
} from '../../lib/applyInbox';


type Props = {
  workspaceRoot: string;
  onOpenFile?: (rel: string) => void;
};

export function ApplyInboxDrawer({ workspaceRoot, onOpenFile }: Props) {
  const [items, setItems] = useState<ApplyInboxItem[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => subscribeApplyInbox(setItems), []);

  if (!items.length && !open) return null;

  return (
    <div className="border-t border-border bg-sidebar">
      <button
        type="button"
        className="flex h-7 w-full items-center justify-between px-3 font-mono text-[10px] text-amber-200 hover:bg-zinc-900/60"
        onClick={() => setOpen((o) => !o)}
      >
        <span>Apply inbox · {items.length} pending</span>
        <span>{open ? 'hide' : 'show'}</span>
      </button>
      {open ? (
        <div className="max-h-56 overflow-auto border-t border-border px-3 py-2">
          {err ? <p className="mb-2 font-mono text-[10px] text-red-300">{err}</p> : null}
          {items.length === 0 ? (
            <p className="font-mono text-[10px] text-muted">Empty</p>
          ) : (
            <ul className="space-y-1.5">
              {items.map((item) => (
                <li key={item.id} className="rounded border border-border bg-background px-2 py-1.5">
                  <div className="truncate font-mono text-[11px] text-zinc-200" title={item.file}>
                    {item.file}
                    <span className="ml-2 text-[10px] text-muted">{item.kind}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="btn-primary h-6 px-2 text-[10px]"
                      disabled={busyId === item.id}
                      onClick={() => {
                        setBusyId(item.id);
                        setErr('');
                        void acceptInboxItem(item.id, workspaceRoot)
                          .then((r) => {
                            if (r.status !== 'ok') setErr(r.error || 'apply failed');
                          })
                          .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
                          .finally(() => setBusyId(null));
                      }}
                    >
                      <Check size={10} /> Accept
                    </button>
                    <button
                      type="button"
                      className="btn-ghost h-6 px-2 text-[10px]"
                      onClick={() => rejectInboxItem(item.id)}
                    >
                      <X size={10} /> Reject
                    </button>
                    <button
                      type="button"
                      className="btn-ghost h-6 px-2 text-[10px]"
                      onClick={() => onOpenFile?.(item.file)}
                    >
                      <FolderOpen size={10} /> Open
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {items.length > 1 ? (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="btn-primary h-6 px-2 text-[10px]"
                onClick={() => {
                  setErr('');
                  void acceptAllInbox(workspaceRoot).catch((e) =>
                    setErr(e instanceof Error ? e.message : String(e)),
                  );
                }}
              >
                Accept all
              </button>
              <button type="button" className="btn-ghost h-6 px-2 text-[10px]" onClick={() => clearApplyInbox()}>
                <Trash2 size={10} /> Clear
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
