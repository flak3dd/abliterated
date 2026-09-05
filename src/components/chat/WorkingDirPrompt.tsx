import { useEffect, useState } from 'react';
import { Folder, FolderPlus } from 'lucide-react';
import { bridge } from '../../lib/bridgeClient';
import { workspaceGate } from '../../lib/workspaceGuard';

type Props = {
  appRoot: string;
  currentRoot: string;
  onChoose: (path: string) => Promise<void>;
};

function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

export function WorkingDirPrompt({ appRoot, currentRoot, onChoose }: Props) {
  const prefill = workspaceGate(currentRoot, appRoot);
  const [draft, setDraft] = useState(prefill.ok ? currentRoot : '');
  const [error, setError] = useState(prefill.ok ? '' : prefill.message);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const gate = workspaceGate(currentRoot, appRoot);
    setDraft(gate.ok ? currentRoot : '');
    setError(gate.ok ? '' : gate.message);
  }, [currentRoot, appRoot]);

  const submit = async () => {
    const path = draft.trim();
    const gate = workspaceGate(path, appRoot);
    if (!gate.ok) {
      setError(gate.message);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onChoose(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const createDirectory = async () => {
    const path = draft.trim();
    if (!path) {
      setError('Enter an absolute path');
      return;
    }
    if (!isAbsolutePath(path)) {
      setError('Path must be absolute');
      return;
    }
    const gate = workspaceGate(path, appRoot);
    if (!gate.ok) {
      setError(gate.message);
      return;
    }
    if (!bridge.connected) {
      setError('Connect the bridge first');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await bridge.createDirectory(path);
      await onChoose(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-3 rounded border border-border bg-surface px-4 py-5">
      <div className="flex items-center gap-2 font-mono text-xs text-zinc-200">
        <Folder size={14} />
        Working directory
      </div>
      <p className="font-mono text-[11px] leading-5 text-muted">
        Pick a project folder before this conversation starts. Abliterated will not write files inside its own
        install
        {appRoot ? ` (${appRoot})` : ''}.
      </p>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="/absolute/path/to/project"
        spellCheck={false}
        className="field w-full font-mono text-[11px]"
        autoFocus
      />
      {error ? <div className="font-mono text-[11px] text-rose-400">{error}</div> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !draft.trim()} className="btn-primary" onClick={() => void submit()}>
          Use this folder
        </button>
        <button
          type="button"
          disabled={busy || !draft.trim()}
          className="btn-ghost inline-flex items-center gap-1.5"
          onClick={() => void createDirectory()}
        >
          <FolderPlus size={14} />
          Create directory
        </button>
      </div>
    </div>
  );
}
