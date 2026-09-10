import { cn } from '../../lib/cn';
import type { RunProof } from '../../lib/harnessGates';

export type { RunProof };

export function ProofChip({ proof, className }: { proof: RunProof; className?: string }) {
  const items: { key: keyof Pick<RunProof, 'write' | 'verify' | 'explore'>; label: string }[] = [
    { key: 'write', label: 'write' },
    { key: 'verify', label: 'verify' },
    { key: 'explore', label: 'explore' },
  ];
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1 font-mono text-[10px]',
        className,
      )}
      role="status"
      title={proof.proven ? 'This run landed proof (write, verify, or a tool-backed finding).' : 'No proven improvement this run.'}
    >
      <span className={proof.proven ? 'font-semibold text-emerald-400' : 'text-zinc-500'}>
        {proof.proven ? 'proof' : 'no proof'}
      </span>
      {items.map((it) => {
        const ok = proof[it.key];
        return (
          <span
            key={it.key}
            className={
              ok
                ? 'rounded border border-emerald-800/60 bg-emerald-950/40 px-1 text-emerald-300'
                : 'rounded border border-border px-1 text-zinc-600'
            }
          >
            {it.label}
            {ok ? ' ✓' : ''}
          </span>
        );
      })}
    </div>
  );
}
