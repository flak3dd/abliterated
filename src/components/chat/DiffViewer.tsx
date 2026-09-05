import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ClipboardCopy, Copy, FileCode, X } from 'lucide-react';
import { bridge } from '../../lib/bridgeClient';
import { hunkToPatch, parseUnifiedDiff } from '../../lib/diffParser';
import { isPathInsideRoot, noteFileApplied, wasRecentlyApplied } from '../../lib/grokLayer';
import { cn } from '../../lib/cn';
import type { DiffHunk, HunkStatus } from '../../types';

interface Props {
  rawDiff: string;
  defaultFile?: string;
  autoAccept?: boolean;
}

export function DiffViewer({ rawDiff, defaultFile, autoAccept = false }: Props) {
  const parsed = useMemo(() => parseUnifiedDiff(rawDiff, defaultFile), [rawDiff, defaultFile]);
  const [hunks, setHunks] = useState<DiffHunk[]>(parsed);
  const [statusText, setStatusText] = useState('');
  const autoApplied = useRef<Set<number>>(new Set());
  const hunksRef = useRef(hunks);
  hunksRef.current = hunks;

  useEffect(() => {
    setHunks(parsed);
    autoApplied.current = new Set();
  }, [parsed]);

  const setHunkStatus = (idx: number, status: HunkStatus) => {
    setHunks((prev) => prev.map((h, i) => (i === idx ? { ...h, status } : h)));
  };

  const apply = async (idx: number, opts?: { auto?: boolean }) => {
    const hunk = hunksRef.current[idx];
    if (!hunk || hunk.status !== 'pending') return;
    if (opts?.auto && wasRecentlyApplied(hunk.file)) {
      setHunkStatus(idx, 'accepted');
      setStatusText(`Applied ${hunk.file}`);
      return;
    }
    if (opts?.auto && !bridge.connected) return;
    if (!isPathInsideRoot(hunk.file, bridge.currentRoot)) {
      setStatusText('path escape blocked');
      return;
    }
    const patch = hunkToPatch(hunk);
    if (bridge.connected) {
      try {
        const ok = await bridge.applyPatch(hunk.file, patch);
        if (ok) {
          noteFileApplied(hunk.file);
          setHunkStatus(idx, 'accepted');
          setStatusText(`Applied ${hunk.file}`);
        } else {
          setStatusText(`Apply failed for ${hunk.file}`);
        }
      } catch (err) {
        setStatusText(err instanceof Error ? err.message : 'Apply failed');
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(patch);
      setHunkStatus(idx, 'accepted');
      setStatusText('Bridge disconnected — patch copied to clipboard');
    } catch {
      setStatusText('Bridge disconnected — copy failed');
    }
  };

  const copyPatch = async (hunk: DiffHunk) => {
    try {
      await navigator.clipboard.writeText(hunkToPatch(hunk));
      setStatusText('Patch copied to clipboard');
      window.setTimeout(() => setStatusText(''), 1800);
    } catch {
      setStatusText('Copy failed');
    }
  };

  useEffect(() => {
    if (!autoAccept) return;
    hunks.forEach((hunk, idx) => {
      if (hunk.status !== 'pending') return;
      if (autoApplied.current.has(idx)) return;
      autoApplied.current.add(idx);
      void apply(idx, { auto: true });
    });
  }, [autoAccept, hunks]);

  return (
    <div className="my-2.5 overflow-hidden rounded-lg border border-border bg-zinc-950 shadow-sm font-mono text-[11px]">
      {hunks.map((hunk, idx) => {
        let oldLineNum = hunk.oldStart;
        let newLineNum = hunk.newStart;

        return (
          <div key={`${hunk.file}-${idx}`} className="border-b border-border/80 last:border-b-0">
            {/* Header */}
            <div className="flex items-center gap-2 border-b border-border/80 bg-surface-raised/70 px-3 py-1.5">
              <FileCode size={12} className="text-sky-400 shrink-0" />
              <span className="truncate font-semibold text-zinc-200">{hunk.file}</span>
              <span className="text-[10px] text-zinc-500 font-mono">
                @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  title="Copy patch"
                  onClick={() => void copyPatch(hunk)}
                  className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                >
                  <Copy size={11} />
                </button>
                {hunk.status === 'pending' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void apply(idx)}
                      className="inline-flex items-center gap-1 rounded bg-emerald-900/60 px-2 py-0.5 text-[10px] font-medium text-emerald-300 hover:bg-emerald-800 border border-emerald-700/50 transition-colors"
                    >
                      <Check size={10} /> Apply
                    </button>
                    <button
                      type="button"
                      onClick={() => setHunkStatus(idx, 'rejected')}
                      className="inline-flex items-center gap-1 rounded bg-rose-950/70 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-900 border border-rose-800/40 transition-colors"
                    >
                      <X size={10} /> Reject
                    </button>
                  </>
                ) : (
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.2 text-[9px] uppercase tracking-wider font-semibold',
                      hunk.status === 'accepted'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/50'
                        : 'bg-rose-950 text-rose-400 border border-rose-800/50',
                    )}
                  >
                    {hunk.status}
                  </span>
                )}
              </div>
            </div>

            {/* Diff content with line numbers */}
            <div className="overflow-x-auto leading-5 text-[11px]">
              {hunk.content.split('\n').map((line, i) => {
                const isAdd = line.startsWith('+');
                const isDel = line.startsWith('-');
                const curOld = isAdd ? '' : oldLineNum++;
                const curNew = isDel ? '' : newLineNum++;

                return (
                  <div
                    key={i}
                    className={cn(
                      'flex items-stretch font-mono',
                      isAdd && 'bg-emerald-950/40 text-emerald-300',
                      isDel && 'bg-rose-950/40 text-rose-300',
                      !isAdd && !isDel && 'text-zinc-300 hover:bg-zinc-900/40',
                    )}
                  >
                    <span className="w-8 shrink-0 select-none text-right pr-2 text-[10px] text-zinc-600 bg-surface/30">
                      {curOld}
                    </span>
                    <span className="w-8 shrink-0 select-none text-right pr-2 text-[10px] text-zinc-600 bg-surface/30 border-r border-border/40">
                      {curNew}
                    </span>
                    <span className="w-5 shrink-0 select-none text-center font-bold">
                      {isAdd ? '+' : isDel ? '-' : ' '}
                    </span>
                    <span className="min-w-0 flex-1 whitespace-pre pr-2">
                      {line.slice(1) || ' '}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {statusText ? (
        <div className="flex items-center gap-1.5 border-t border-border bg-surface px-3 py-1 text-[10px] text-zinc-300">
          <ClipboardCopy size={11} className="text-sky-400" />
          <span>{statusText}</span>
        </div>
      ) : null}
    </div>
  );
}
