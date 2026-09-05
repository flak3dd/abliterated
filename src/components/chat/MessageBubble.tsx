import { memo, useMemo, useState, type ReactNode } from 'react';
import {
  Brain,
  Check,
  Code2,
  Copy,
  FileText,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Globe,
  ImageIcon,
  Search,
  Terminal,
  Zap,
} from 'lucide-react';
import { DiffViewer } from './DiffViewer';
import { TerminalPane, type TerminalTone } from './TerminalPane';
import { formatGrokStatus, type GrokApplyResult } from '../../lib/grokLayer';
import { cn } from '../../lib/cn';
import { isMidRunMessageContent, stripMidRunPrefix } from '../../lib/agentHelpers';
import { NO_CONTENT_REASONING_NOTE } from '../../lib/agentPhase';
import { parseCompletionFooter } from '../../lib/completionFooter';
import {
  PLAN_CODE_OMITTED_NOTE,
  liftReasoningWork,
  stripImplementationFromText,
} from '../../lib/reasoningWork';
import type { Message, ToolCallPayload } from '../../types';

type ContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'diff'; code: string }
  | { kind: 'shell'; code: string }
  | { kind: 'code'; lang: string; code: string };

const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console']);
const DIFF_LANGS = new Set(['diff', 'patch', 'udiff']);

function looksLikeDiff(code: string): boolean {
  const head = code.trimStart();
  return head.startsWith('diff ') || head.startsWith('--- ') || head.startsWith('+++ ') || head.startsWith('@@ ');
}

export function splitMessageContent(content: string): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    if (match.index > last) {
      const text = content.slice(last, match.index);
      if (text.trim()) blocks.push({ kind: 'text', text });
    }
    const lang = (match[1] || '').trim().toLowerCase();
    const code = match[2].replace(/\n$/, '');
    if (DIFF_LANGS.has(lang) || (!lang && looksLikeDiff(code))) {
      blocks.push({ kind: 'diff', code });
    } else if (SHELL_LANGS.has(lang)) {
      blocks.push({ kind: 'shell', code });
    } else {
      blocks.push({ kind: 'code', lang, code });
    }
    last = match.index + match[0].length;
  }
  if (last < content.length) {
    const text = content.slice(last);
    if (text.trim() || blocks.length === 0) blocks.push({ kind: 'text', text });
  }
  if (blocks.length === 0) blocks.push({ kind: 'text', text: content });
  return blocks;
}

function toolArgString(args: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

function maybeImageResult(content: string) {
  const m = content.match(/!\[[^\]]*\]\((data:image\/[^)]+)\)/);
  if (m) {
    return (
      <div>
        <img src={m[1]} alt="generated" className="my-2 max-h-80 max-w-full rounded border border-border" />
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-zinc-500">
          {content.length > 500 ? content.slice(0, 200) + '…[base64 truncated]…' : content}
        </pre>
      </div>
    );
  }
  return (
    <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-zinc-300">
      {content}
    </pre>
  );
}

const TOOL_COLLAPSE_CHARS = 900;
const TOOL_COLLAPSE_LINES = 14;

function CollapsibleToolOutput({ content }: { content: string }) {
  const lines = content.split('\n').length;
  const long = content.length > TOOL_COLLAPSE_CHARS || lines > TOOL_COLLAPSE_LINES;
  const [expanded, setExpanded] = useState(!long);
  if (!long) {
    return (
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-zinc-300">
        {content}
      </pre>
    );
  }
  const preview = content.split('\n').slice(0, 8).join('\n');
  const clipped =
    preview.length > 480 ? `${preview.slice(0, 480)}…` : `${preview}${lines > 8 ? '\n…' : ''}`;
  return (
    <div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-zinc-300">
        {expanded ? content : clipped}
      </pre>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 chip border-zinc-700 text-zinc-400 hover:text-zinc-200"
      >
        {expanded ? 'Collapse output' : `Expand output (${lines} lines · ${content.length.toLocaleString()} chars)`}
      </button>
    </div>
  );
}

function getToolIcon(name: string) {
  if (name === 'read_file' || name === 'file_outline' || name === 'list_dir' || name === 'list_skills' || name === 'read_skill' || name === 'suggest_skill' || name === 'write_skill') return FileText;
  if (name === 'web_fetch' || name === 'web_search') return Globe;
  if (name === 'grep' || name === 'glob' || name === 'semantic_search') return Search;
  if (name === 'git_status' || name === 'git_diff') return GitBranch;
  if (name === 'git_commit') return GitCommit;
  if (name === 'create_pr') return GitPullRequest;
  if (name === 'generate_image') return ImageIcon;
  if (name === 'shell') return Terminal;
  return Zap;
}

function toolSummary(tool: ToolCallPayload): string {
  if (tool.name === 'read_file' || tool.name === 'file_outline' || tool.name === 'list_dir') {
    return toolArgString(tool.arguments, ['path', 'file', 'target', 'dir', 'directory']);
  }
  if (tool.name === 'grep' || tool.name === 'glob') return toolArgString(tool.arguments, ['pattern']);
  if (tool.name === 'semantic_search') return toolArgString(tool.arguments, ['query', 'pattern', 'q']);
  if (tool.name === 'generate_image') return toolArgString(tool.arguments, ['prompt']);
  if (tool.name === 'git_commit') return toolArgString(tool.arguments, ['message', 'msg']);
  if (tool.name === 'git_diff')
    return toolArgString(tool.arguments, ['path']) || (tool.arguments.staged ? 'staged' : 'unstaged');
  if (tool.name === 'create_pr') return toolArgString(tool.arguments, ['title']);
  if (tool.name === 'checkpoint_save') return toolArgString(tool.arguments, ['label', 'name']) || 'save';
  if (tool.name === 'checkpoint_restore') return toolArgString(tool.arguments, ['id', 'checkpoint']);
  if (tool.name === 'web_fetch') return toolArgString(tool.arguments, ['url']);
  if (tool.name === 'web_search') return toolArgString(tool.arguments, ['query', 'q', 'search']);
  if (tool.name === 'list_skills') return 'catalog';
  if (tool.name === 'read_skill') return toolArgString(tool.arguments, ['skill_id', 'id', 'slug', 'name']);
  if (tool.name === 'suggest_skill' || tool.name === 'write_skill') return toolArgString(tool.arguments, ['name', 'title']);
  if (tool.name === 'shell') return toolArgString(tool.arguments, ['command', 'cmd', 'script']);
  return '';
}

/** Lightweight keyword tokenizer for syntax coloring */
const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'import', 'export', 'default', 'from',
  'if', 'else', 'switch', 'case', 'break', 'for', 'while', 'do', 'try', 'catch', 'finally',
  'throw', 'class', 'extends', 'interface', 'type', 'async', 'await', 'yield', 'new', 'this',
  'true', 'false', 'null', 'undefined', 'def', 'self', 'lambda', 'in', 'is', 'not', 'and', 'or',
]);

function highlightLine(line: string): ReactNode[] {
  // Match comments
  if (line.trimStart().startsWith('//') || line.trimStart().startsWith('#')) {
    return [<span key="comment" className="tok-comment">{line}</span>];
  }
  // Regex to split words, strings, operators
  const tokens: ReactNode[] = [];
  const re = /(".*?"|'.*?'|`.*?`|\b\w+\b|[^\s\w]+|\s+)/g;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = re.exec(line)) !== null) {
    const text = match[0];
    if (text.startsWith('"') || text.startsWith("'") || text.startsWith('`')) {
      tokens.push(<span key={key++} className="tok-string">{text}</span>);
    } else if (KEYWORDS.has(text)) {
      tokens.push(<span key={key++} className="tok-keyword">{text}</span>);
    } else if (/^\d+(\.\d+)?$/.test(text)) {
      tokens.push(<span key={key++} className="tok-number">{text}</span>);
    } else if (['=>', '===', '!==', '==', '!=', '<=', '>=', '&&', '||'].includes(text)) {
      tokens.push(<span key={key++} className="tok-operator">{text}</span>);
    } else {
      tokens.push(<span key={key++}>{text}</span>);
    }
  }

  return tokens.length ? tokens : [<span key="empty">{line}</span>];
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => code.split('\n'), [code]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="my-2.5 overflow-hidden rounded-lg border border-border bg-zinc-950/90 shadow-sm font-mono text-[11px]">
      <div className="flex items-center justify-between border-b border-border/80 bg-surface-raised/60 px-3 py-1.5">
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
          <Code2 size={12} className="text-sky-400" />
          <span className="uppercase font-semibold tracking-wide text-zinc-300">{lang || 'code'}</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-500">{lines.length} lines</span>
        </div>
        {code.trim() ? (
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
            <span className={copied ? 'text-emerald-400 font-medium' : ''}>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        ) : null}
      </div>
      <div className="flex overflow-x-auto p-2.5 leading-5">
        <div className="select-none pr-3 text-right text-[10px] text-zinc-600 font-mono">
          {lines.map((_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <div className="min-w-0 flex-1 whitespace-pre font-mono text-zinc-200">
          {lines.map((line, i) => (
            <div key={i}>{highlightLine(line)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function renderMessageContent(
  content: string,
  autoAccept: boolean,
  writesLocked = false,
  terminalTone: TerminalTone = 'discuss',
) {
  return splitMessageContent(content).map((block, i) => {
    if (block.kind === 'diff') {
      if (writesLocked) return <CodeBlock key={i} lang="diff" code={block.code} />;
      return <DiffViewer key={i} rawDiff={block.code} autoAccept={autoAccept} />;
    }
    if (block.kind === 'shell') {
      if (writesLocked) return <CodeBlock key={i} lang="bash" code={block.code} />;
      return <TerminalPane key={i} command={block.code} tone={terminalTone} />;
    }
    if (block.kind === 'code') {
      return <CodeBlock key={i} lang={block.lang} code={block.code} />;
    }
    return (
      <div key={i} className="whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-zinc-200">
        {block.text}
      </div>
    );
  });
}

export type MessageBubbleProps = {
  message: Message;
  autoAcceptEdits: boolean;
  /** Plan mode: hide Apply / Run / Commit so writes stay locked. */
  writesLocked?: boolean;
  grokResults?: GrokApplyResult[];
  bridgeConnected: boolean;
  onGitCommit: (message: Message) => void;
  onCreatePr?: (message: Message) => void;
  onCheckpointRestore?: (message: Message) => void;
  onShellExecuted?: (message: Message, result: string) => void;
  /** When true (default), parse Done/Continue footer and show one-click chips. */
  completionFooterEnabled?: boolean;
  /** One-click send (or fill) a Continue prompt from the completion footer. */
  onContinuePrompt?: (text: string) => void;
  terminalTone?: TerminalTone;
};

function MessageBubbleInner({
  message: m,
  autoAcceptEdits,
  writesLocked = false,
  grokResults,
  bridgeConnected,
  onGitCommit,
  onCreatePr,
  onCheckpointRestore,
  onShellExecuted,
  completionFooterEnabled = true,
  onContinuePrompt,
  terminalTone = 'discuss',
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);

  const reasoningForUi = useMemo(() => {
    const raw = m.reasoning || '';
    if (!raw.trim()) return '';
    return writesLocked ? stripImplementationFromText(raw) : raw;
  }, [m.reasoning, writesLocked]);

  const promoteReasoning =
    m.role === 'assistant' &&
    m.status === 'complete' &&
    (!(m.content || '').trim() || (m.content || '').trim() === NO_CONTENT_REASONING_NOTE) &&
    !!reasoningForUi.trim();

  const displayContent = useMemo(() => {
    if (m.role === 'user' && isMidRunMessageContent(m.content)) return stripMidRunPrefix(m.content);
    if (promoteReasoning) return reasoningForUi;
    if (writesLocked) {
      const stripped = stripImplementationFromText(m.content || '');
      if (stripped) return stripped;
      if (liftReasoningWork(m.content || '')) return PLAN_CODE_OMITTED_NOTE;
    }
    return m.content;
  }, [m.role, m.content, reasoningForUi, m.status, promoteReasoning, writesLocked]);

  const textToCopy = useMemo(() => {
    if (m.toolCall) return m.toolCall.result || m.content;
    if (displayContent.trim()) return displayContent;
    return reasoningForUi;
  }, [m.toolCall, m.content, reasoningForUi, displayContent]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  const footer = useMemo(() => {
    if (m.role !== 'assistant' || m.status !== 'complete' || completionFooterEnabled === false) return null;
    return parseCompletionFooter(displayContent);
  }, [m.role, m.status, completionFooterEnabled, displayContent]);

  const mainContent = footer ? footer.body : displayContent;

  const contentNode = useMemo(() => {
    if (!(mainContent.trim() || !m.reasoning)) return null;
    return renderMessageContent(
      mainContent,
      autoAcceptEdits && m.status === 'complete',
      writesLocked,
      terminalTone,
    );
  }, [mainContent, m.reasoning, autoAcceptEdits, m.status, writesLocked, terminalTone]);

  const isUser = m.role === 'user';
  const ToolIcon = m.toolCall ? getToolIcon(m.toolCall.name) : Zap;

  return (
    <div className={cn('mb-3.5 max-w-3xl', isUser && 'ml-auto')}>
      <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted">
        <span className={cn('font-semibold', isUser ? 'text-sky-400/90' : 'text-zinc-400')}>
          {m.role}
        </span>
        {isUser && isMidRunMessageContent(m.content) ? (
          <span className="rounded bg-sky-950/60 px-1 py-0.2 text-[9px] text-sky-300 border border-sky-800/40">
            mid-run note
          </span>
        ) : null}
        {m.status === 'streaming' ? (
          <span className="flex items-center gap-1 text-amber-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
            streaming
          </span>
        ) : null}
        {m.status === 'error' ? <span className="text-rose-400 font-semibold">error</span> : null}
        {textToCopy.trim() ? (
          <button
            type="button"
            onClick={() => void copy()}
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
            <span className={copied ? 'text-emerald-400' : ''}>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        ) : null}
      </div>

      <div
        className={cn(
          'rounded-lg border px-3.5 py-2.5 shadow-sm transition-colors',
          isUser
            ? 'border-sky-900/40 bg-zinc-900/90 shadow-sky-950/20'
            : 'border-border bg-surface-raised/40',
        )}
      >
        {m.toolCall ? (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] border-b border-border/60 pb-1.5">
              <span className="inline-flex items-center gap-1 rounded bg-amber-950/80 px-2 py-0.5 text-amber-300 border border-amber-800/50 font-medium">
                <ToolIcon size={11} />
                {m.toolCall.name}
              </span>
              <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400 border border-border-subtle">
                {m.toolCall.status}
              </span>
              {toolSummary(m.toolCall) ? (
                <span className="min-w-0 truncate text-zinc-300 text-[11px] max-w-[280px]">
                  {toolSummary(m.toolCall)}
                </span>
              ) : null}
            </div>
            {!writesLocked &&
            (m.toolCall.name === 'git_commit' ||
              m.toolCall.name === 'create_pr' ||
              m.toolCall.name === 'checkpoint_restore') &&
            (m.toolCall.status === 'allowed' || m.toolCall.status === 'pending') ? (
              <div>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-zinc-300">
                  {m.toolCall.result || m.content}
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    if (m.toolCall?.name === 'create_pr') onCreatePr?.(m);
                    else if (m.toolCall?.name === 'checkpoint_restore') onCheckpointRestore?.(m);
                    else onGitCommit(m);
                  }}
                  className="mt-2 rounded bg-emerald-900/70 px-2.5 py-1 font-mono text-[10px] text-emerald-300 hover:bg-emerald-800 font-medium border border-emerald-700/50"
                >
                  {m.toolCall.name === 'create_pr'
                    ? 'Create PR'
                    : m.toolCall.name === 'checkpoint_restore'
                      ? 'Restore'
                      : 'Commit'}
                </button>
              </div>
            ) : !writesLocked &&
              m.toolCall.name === 'shell' &&
              m.toolCall.status !== 'executed' &&
              m.toolCall.status !== 'error' ? (
              <TerminalPane
                command={toolArgString(m.toolCall.arguments, ['command', 'cmd', 'script']) || m.content}
                onExecuted={onShellExecuted ? (result) => onShellExecuted(m, result) : undefined}
                tone={terminalTone}
              />
            ) : m.toolCall.name === 'generate_image' ? (
              maybeImageResult(m.toolCall.result || m.content)
            ) : (
              <CollapsibleToolOutput content={m.toolCall.result || m.content} />
            )}
          </>
        ) : (
          <>
            {m.status === 'streaming' && !!reasoningForUi.trim() && !m.content.trim() ? (
              <div className="agent-status-chip" role="status">
                <Brain size={11} className="animate-pulse text-amber-400" />
                <span>reasoning (synthesizing plan)…</span>
              </div>
            ) : null}
            {reasoningForUi && !promoteReasoning ? (
              <details
                className="mb-2.5 rounded-md border border-zinc-800/80 bg-zinc-950/80 px-2.5 py-1.5 transition-all"
                open={m.status === 'streaming' && !m.content.trim()}
              >
                <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-wide text-zinc-400 flex items-center gap-1.5 select-none hover:text-zinc-200">
                  <Brain size={12} className="text-amber-400" />
                  <span>reasoning{m.status === 'streaming' && !m.content.trim() ? ' · active' : ''}</span>
                </summary>
                <div className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-zinc-400 border-t border-zinc-800/60 pt-2">
                  {reasoningForUi}
                </div>
              </details>
            ) : null}
            {contentNode}
            {m.status === 'streaming' ? <span className="stream-cursor" aria-hidden /> : null}
            {footer ? (
              <div className="mt-3 border-t border-zinc-800 pt-2.5">
                <div className="mb-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-zinc-300">
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-400">Done · </span>
                  {footer.summary}
                </div>
                <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted font-medium">Suggested Next Steps</div>
                <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap">
                  {footer.options.map((opt, i) => (
                    <button
                      key={i}
                      type="button"
                      title={opt}
                      disabled={!onContinuePrompt}
                      onClick={() => onContinuePrompt?.(opt)}
                      className="rounded border border-border bg-surface px-2.5 py-1 text-left font-mono text-[10px] leading-4 text-zinc-300 hover:border-sky-500/50 hover:text-sky-200 hover:bg-sky-950/20 transition-all disabled:opacity-40"
                    >
                      <span className="mr-1 text-sky-400 font-semibold">[{i + 1}]</span>
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
        {m.role === 'assistant' && grokResults && grokResults.length > 0 ? (
          <div className="mt-2.5 truncate font-mono text-[10px] text-zinc-500 border-t border-border/40 pt-1.5">
            {formatGrokStatus(grokResults, autoAcceptEdits, bridgeConnected)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleInner);
