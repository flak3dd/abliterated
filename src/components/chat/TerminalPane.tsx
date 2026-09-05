import { useRef, useState, useEffect } from 'react';
import { AlertTriangle, Check, Copy, Play, RotateCcw, Terminal } from 'lucide-react';
import { bridge } from '../../lib/bridgeClient';
import { cn } from '../../lib/cn';
import { isSpuriousReviewCommit } from '../../lib/agentHelpers';

export type TerminalTone = 'plan' | 'build' | 'discuss';

interface Props {
  command: string;
  onExecuted?: (result: string) => void;
  tone?: TerminalTone;
}

export function TerminalPane({ command, onExecuted, tone = 'discuss' }: Props) {
  const [output, setOutput] = useState('');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLDivElement | null>(null);

  const trimmed = command.trim();
  const isFauxTool = /^(list_dir|read_file|file_outline|git_status|git_diff)\b/.test(trimmed);
  const isSuspiciousCommit = isSpuriousReviewCommit(command);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  const run = async () => {
    if (running) return;
    setRunning(true);
    setOutput('');
    setExitCode(null);

    if (!bridge.connected) {
      setOutput('Bridge disconnected');
      setExitCode(126);
      setRunning(false);
      onExecuted?.('Bridge disconnected\nexit 126');
      return;
    }

    let cmdToRun = command;
    if (trimmed.startsWith('list_dir')) {
      const parts = trimmed.split(/\s+/);
      const target = parts[1] || '.';
      cmdToRun = `ls -la ${target}`;
    } else if (trimmed.startsWith('read_file')) {
      const parts = trimmed.split(/\s+/);
      const target = parts[1] || '';
      cmdToRun = target ? `cat ${target}` : 'cat';
    } else if (trimmed.startsWith('file_outline')) {
      const parts = trimmed.split(/\s+/);
      const target = parts[1] || '';
      cmdToRun = target ? `head -n 50 ${target}` : 'head';
    } else if (trimmed.startsWith('git_status')) {
      cmdToRun = 'git status';
    } else if (trimmed.startsWith('git_diff')) {
      cmdToRun = 'git diff';
    }

    let out = '';
    try {
      const code = await bridge.runCommand(cmdToRun, (chunk) => {
        out += chunk;
        setOutput((prev) => prev + chunk);
      });
      setExitCode(code);
      onExecuted?.(out + (out.endsWith('\n') || !out ? '' : '\n') + 'exit ' + String(code));
    } catch (err) {
      const errText = err instanceof Error ? err.message : String(err);
      out += errText;
      setOutput((prev) => prev + errText);
      setExitCode(1);
      onExecuted?.(out + (out.endsWith('\n') || !out ? '' : '\n') + 'exit 1');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      className={cn(
        'term-pane my-2.5 overflow-hidden rounded-lg border shadow-sm font-mono text-[11px]',
        tone === 'plan' && 'term-pane--plan border-orange-800/50',
        tone === 'build' && 'term-pane--build border-emerald-800/50',
        tone === 'discuss' && 'term-pane--discuss border-border',
      )}
    >
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-border/80 bg-surface-raised/70 px-3 py-1.5">
        <Terminal size={12} className="text-emerald-400 shrink-0" />
        <span className="text-zinc-500 font-bold">$</span>
        <span className="truncate text-zinc-200 font-semibold">{command.split('\n')[0]}</span>
        {isSuspiciousCommit ? (
          <span className="inline-flex items-center gap-1 rounded bg-rose-950/80 px-1.5 py-0.5 text-[9px] font-medium text-rose-300 border border-rose-800/60">
            <AlertTriangle size={10} className="text-rose-400 shrink-0" />
            <span>creates commit</span>
          </span>
        ) : isFauxTool ? (
          <span className="rounded bg-amber-950/80 px-1.5 py-0.5 text-[9px] font-medium text-amber-300 border border-amber-800/60">
            IDE Tool
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          {exitCode !== null ? (
            <span
              className={cn(
                'rounded px-1.5 py-0.2 text-[9px] uppercase font-semibold',
                exitCode === 0
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/50'
                  : 'bg-rose-950 text-rose-400 border border-rose-800/50',
              )}
            >
              exit {exitCode}
            </span>
          ) : null}
          <button
            type="button"
            title="Copy command"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
            <span className={copied ? 'text-emerald-400 font-medium' : ''}>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          {output ? (
            <button
              type="button"
              title="Clear output"
              onClick={() => {
                setOutput('');
                setExitCode(null);
              }}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            >
              <RotateCcw size={10} />
            </button>
          ) : null}
          <button
            type="button"
            disabled={running}
            onClick={() => void run()}
            className="inline-flex items-center gap-1 rounded bg-emerald-900/70 px-2 py-0.5 text-[10px] font-medium text-emerald-300 hover:bg-emerald-800 border border-emerald-700/50 disabled:opacity-50 transition-colors"
          >
            <Play size={10} className={running ? 'animate-spin' : ''} />
            {running ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>

      {isSuspiciousCommit ? (
        <div className="flex items-center gap-2 border-b border-rose-900/50 bg-rose-950/40 px-3 py-1.5 text-[10px] text-rose-300">
          <AlertTriangle size={12} className="text-rose-400 shrink-0" />
          <span>Caution: <code>git_commit</code> will commit staged changes. To inspect recent history, use <code>git log</code> or <code>git status</code>.</span>
        </div>
      ) : null}

      {command.includes('\n') ? (
        <pre className="border-b border-border/60 bg-surface/30 p-2.5 text-zinc-400 overflow-x-auto">
          {command}
        </pre>
      ) : null}

      {output || exitCode !== null ? (
        <div
          ref={outputRef}
          className={cn(
            'term-pane-output max-h-60 overflow-auto p-3 text-[11px] leading-5',
            tone === 'plan' && 'term-pane-output--plan',
            tone === 'build' && 'term-pane-output--build',
            tone === 'discuss' && 'term-pane-output--discuss',
          )}
        >
          {output ? <pre className="whitespace-pre-wrap text-zinc-300">{output}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}
