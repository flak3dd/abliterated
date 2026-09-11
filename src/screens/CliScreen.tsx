import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  Check,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Folder,
  Maximize2,
  Minimize2,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  Zap,
  Download,
  ArrowRight,
  CornerDownLeft,
} from 'lucide-react';
import { getPromptSuggestions } from '../lib/promptSuggestions';
import { cn } from '../lib/cn';
import type { ChatOpenAiMessage, ClientSettings } from '../types';
import { resolveActiveSettings } from '../lib/activeEndpoint';
import { streamChatCompletion } from '../lib/sse';
import {
  promoteReasoningToContent,
  splitThinkFromContent,
  stripThinkingWrappers,
} from '../lib/agentPhase';
import { bridge, type BridgeStatus, type BridgeServerInfo } from '../lib/bridgeClient';
import {
  downloadSingleFile,
  downloadFilesAsZip,
  detectFilenameAndContent,
  extractFilesFromMarkdown,
  type DownloadableFile,
} from '../lib/zipDownload';
import { looksWebInteractionDirective, looksBuildIntent } from '../lib/agentHelpers';
import { runWebSearch } from '../lib/webSearch';
import { classifyCliTurn, CLI_INTENT_META, type CliIntent } from '../lib/cliIntent';

interface CliScreenProps {
  settings?: ClientSettings;
  workspaceRoot?: string;
  bridgeStatus?: BridgeStatus;
  onWorkspaceRootChange?: (newRoot: string) => void;
  onPatchSettings?: (partial: Partial<ClientSettings>) => void;
}

type WorldSpectrum = 'blue';
type CliMode = 'ai' | 'shell';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;
  isStreaming?: boolean;
  truncated?: boolean;
  timestamp: string;
  command?: boolean;
  // Classified intent for this turn (drives the intent chip). AI-mode user turns only.
  intent?: CliIntent;
  // Shell execution metadata
  isShell?: boolean;
  shellCommand?: string;
  exitCode?: number | null;
  isRunning?: boolean;
  executionTime?: number;
}

interface ParsedBlock {
  type: 'text' | 'code';
  content: string;
  language?: string;
}

const GLYPHS = {
  kata: 'ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789ABCDEF@#$%*+=<>',
  ascii: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@#$%*+=<>|{}[]!?',
};

const PALETTES = {
  blue: {
    neon: '#00e5ff',
    bright: '#00afd7',
    mid: '#005fff',
    deep: '#0a5f87',
    bg: '#020610',
    panel: 'rgba(3,9,20,0.92)',
    panel2: 'rgba(0,229,255,0.06)',
    line: 'rgba(0,175,215,0.20)',
    line2: 'rgba(0,229,255,0.40)',
    text: '#c9e9f6',
    dim: '#6f9cb0',
    head: '#d9fbff',
    t1: '#00e5ff',
    t2: '#00c0e0',
    t3: '#005fff',
    t4: '#005f87',
    fade: 'rgba(2,6,16,0.16)',
    accentBg: 'rgba(0,229,255,0.12)',
  },
};

function formatTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function parseContentBlocks(text: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({
        type: 'text',
        content: text.slice(lastIndex, match.index),
      });
    }
    blocks.push({
      type: 'code',
      language: match[1].toLowerCase().trim() || 'text',
      content: match[2],
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    blocks.push({
      type: 'text',
      content: text.slice(lastIndex),
    });
  }

  return blocks.length > 0 ? blocks : [{ type: 'text', content: text }];
}

// Extensionless paths that are nonetheless files, not directories.
const KNOWN_FILENAMES =
  /^(Makefile|Dockerfile|LICENSE|LICENCE|README|CHANGELOG|NOTICE|AUTHORS|Procfile|Gemfile|Rakefile|Vagrantfile|CODEOWNERS)$/i;

// Strip tree-drawing glyphs, bullets, numbering, and trailing comments from a
// manifest line so both plain lists and ASCII trees parse the same way.
function cleanScaffoldLine(line: string): string {
  return line
    .replace(/[│├└┣┗┃┠┖]/g, ' ')
    .replace(/─+|-{2,}/g, ' ')
    .replace(/^[\s>*•▸▹◦]+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/\s+#.*$/, '')
    .replace(/\s+\/\/.*$/, '')
    .trim();
}

// Indentation group (one tree level) and the branch connector that precedes a
// node name. Used to recover hierarchy depth from an ASCII tree.
const TREE_INDENT = /^(?: {2,4}|│[ \t]{0,3}|┃[ \t]{0,3})/;
const TREE_CONNECTOR = /^(?:[├└┣┗┠┖][─\-]*[ \t]*|[|`+\\]-{1,}[ \t]*)/;

/**
 * Parse a scaffold manifest into workspace-relative directories and files.
 * Accepts a flat list (one full path per line), a comma/space list on one line,
 * or an ASCII tree — tree hierarchy is reconstructed from indentation so a leaf
 * like "main.py" under "src/" becomes "src/main.py". A trailing slash marks a
 * directory; a path with an extension / dotfile / known filename is a file; a
 * bare segment is a directory. Absolute paths and ".." escapes are rejected.
 */
export function parseScaffoldSpec(raw: string): { dirs: string[]; files: string[] } {
  const dirs = new Set<string>();
  const files = new Set<string>();
  const multiline = /[\r\n]/.test(raw);
  const lines = multiline ? raw.split(/[\r\n]+/) : raw.split(/[,\s]+/);
  const stack: string[] = []; // ancestor directory segment at each depth
  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    // Depth = number of indent groups + 1 if a branch connector is present.
    let rest = rawLine.replace(/\t/g, '    ');
    let depth = 0;
    while (TREE_INDENT.test(rest)) {
      rest = rest.replace(TREE_INDENT, '');
      depth++;
    }
    if (TREE_CONNECTOR.test(rest)) {
      rest = rest.replace(TREE_CONNECTOR, '');
      depth++;
    }
    let leaf = cleanScaffoldLine(rest).replace(/^['"`]+|['"`]+$/g, '').trim();
    leaf = leaf.replace(/^\.\//, '').replace(/^\/+/, '');
    if (!leaf || leaf === '.' || leaf === '..' || leaf.includes('..')) continue;
    const isDir = /[/\\]$/.test(leaf);
    const nameNoSlash = leaf.replace(/[/\\]+$/, '');
    const base = nameNoSlash.split('/').pop() || nameNoSlash;
    const full = [...stack.slice(0, depth).filter(Boolean), nameNoSlash]
      .join('/')
      .replace(/\/{2,}/g, '/');
    if (!full || full.includes('..')) continue;
    const looksFile =
      !isDir &&
      (/\.[a-z0-9]+$/i.test(base) || /^\./.test(base) || KNOWN_FILENAMES.test(base));
    if (isDir || !looksFile) {
      dirs.add(full);
      stack[depth] = nameNoSlash;
      stack.length = depth + 1;
    } else {
      files.add(full);
    }
  }
  return { dirs: [...dirs], files: [...files] };
}

// Minimal, language-aware placeholder content for a scaffolded stub file.
export function scaffoldStub(pathStr: string): string {
  const name = pathStr.split('/').pop() || pathStr;
  const ext = name.includes('.') ? (name.split('.').pop() || '').toLowerCase() : '';
  if (name === '.gitkeep') return '';
  if (name === '.gitignore') return 'node_modules/\n.venv/\n__pycache__/\ndist/\nbuild/\n.env\n*.log\n';
  switch (ext) {
    case 'py':
      return `"""${pathStr}"""\n\n# TODO: implement\n`;
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return `// ${pathStr}\n// TODO: implement\n`;
    case 'json':
      return name === 'package.json'
        ? '{\n  "name": "",\n  "version": "0.0.0",\n  "private": true\n}\n'
        : '{}\n';
    case 'md':
      return `# ${name.replace(/\.md$/i, '')}\n\n> TODO\n`;
    case 'html':
      return `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <title>${name}</title>\n</head>\n<body>\n  <!-- TODO -->\n</body>\n</html>\n`;
    case 'css':
      return `/* ${pathStr} */\n`;
    case 'sh':
      return `#!/usr/bin/env bash\nset -euo pipefail\n\n# TODO: implement\n`;
    case 'yml':
    case 'yaml':
    case 'toml':
    case 'ini':
    case 'cfg':
      return `# ${pathStr}\n`;
    case 'txt':
      return '';
    default:
      return `# ${pathStr}\n`;
  }
}

// Render a shell-safe path token; convert a leading ~ to $HOME so tilde
// expansion still works inside the double-quotes we add for paths with spaces.
function shellPathToken(input: string): string {
  const p = input.startsWith('~') ? input.replace(/^~(\/|$)/, '$HOME$1') : input;
  // Quote only when needed; leave $ unescaped so $HOME still expands inside quotes.
  if (/\s/.test(p)) return `"${p.replace(/(["\\`])/g, '\\$1')}"`;
  return p;
}

/**
 * Ensures every completed CLI chat response concludes with a clean,
 * dedicated '### Response Summary' section with actionable bullets.
 */
/**
 * Extracts the Response Summary section from markdown text to render
 * a prominent, cyber-styled Response Summary card.
 */
export function splitSummaryFromText(text: string): { body: string; summary: string | null } {
  const regex = /(?:^|\n)(?:#{1,3}\s*Response\s*Summary\b|\*\*Response\s*Summary\*\*:?)\s*([\s\S]*)$/i;
  const match = text.match(regex);
  if (!match || match.index === undefined) {
    return { body: text, summary: null };
  }
  const body = text.slice(0, match.index).trim();
  const summary = match[1].trim();
  return { body, summary: summary || null };
}

export function CliScreen({
  settings,
  workspaceRoot,
  bridgeStatus,
  onWorkspaceRootChange,
  onPatchSettings,
}: CliScreenProps) {
  const world: WorldSpectrum = 'blue';
  const [cliMode, setCliMode] = useState<CliMode>('ai');
  const [glyphSet, setGlyphSet] = useState<'kata' | 'ascii'>('kata');
  const [skullEnabled, setSkullEnabled] = useState(true);
  const [rainEnabled, setRainEnabled] = useState(true);
  const [lambda, setLambda] = useState(0.0); // 0.0 = zeroed / uncensored, 1.0 = standard
  const [thoughtsVisible, setThoughtsVisible] = useState(true); // Control thought box expansion
  const [showControls, setShowControls] = useState(false);
  const [showQuickPrompts, setShowQuickPrompts] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Auto-Run Shell commands toggle state (synced with settings.autoRunShell)
  const [autoRunShellState, setAutoRunShellState] = useState(
    () => settings?.autoRunShell ?? false,
  );
  useEffect(() => {
    if (settings?.autoRunShell !== undefined) {
      setAutoRunShellState(settings.autoRunShell);
    }
  }, [settings?.autoRunShell]);
  const autoRunShell = settings?.autoRunShell ?? autoRunShellState;

  // Real-time Bridge State & Working Directory
  const [bridgeState, setBridgeState] = useState<BridgeStatus>(
    bridgeStatus ?? bridge.currentStatus,
  );
  const [activeRoot, setActiveRoot] = useState<string>(
    workspaceRoot || bridge.validWorkspaceRoot || bridge.currentRoot || '',
  );

  // Keep the latest onWorkspaceRootChange in a ref so the bridge subscription does
  // NOT resubscribe every render. bridge.onRootChange fires its callback immediately
  // on subscribe, so an unstable callback prop here would loop:
  // subscribe -> setActiveRoot/onWorkspaceRootChange -> parent re-render ->
  // new callback identity -> effect re-runs -> resubscribe -> fires again (this was
  // the "Maximum update depth exceeded" loop). Subscribe once on mount instead.
  const onWorkspaceRootChangeRef = useRef(onWorkspaceRootChange);
  onWorkspaceRootChangeRef.current = onWorkspaceRootChange;

  // Sync Bridge & Root subscriptions (subscribe once on mount).
  useEffect(() => {
    const unsubStatus = bridge.onStatusChange((s) => setBridgeState(s));
    const unsubRoot = bridge.onRootChange((r) => {
      if (r) {
        setActiveRoot(r);
        onWorkspaceRootChangeRef.current?.(r);
      }
    });
    return () => {
      unsubStatus();
      unsubRoot();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (bridgeStatus && bridgeStatus !== bridgeState) {
      setBridgeState(bridgeStatus);
    }
  }, [bridgeStatus, bridgeState]);

  useEffect(() => {
    if (workspaceRoot && workspaceRoot !== activeRoot) {
      setActiveRoot(workspaceRoot);
    }
  }, [workspaceRoot, activeRoot]);

  // Messages & Streaming
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'boot-1',
      role: 'system',
      content: `ABLITERATED CLI · AI & Local Shell Environment
Type a prompt to chat with the model, or switch to SHELL mode / prefix with '$' for commands.
Type /help for slash commands (/workspace, /scaffold, /serve, /autorun, /venv, /clear).`,
      timestamp: formatTime(),
    },
  ]);
  const [inputVal, setInputVal] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isExecutingCmd, setIsExecutingCmd] = useState(false);
  const [isScaffolding, setIsScaffolding] = useState(false);
  // Auto-scaffold the project skeleton before a build-intent AI turn.
  const [autoScaffoldOnBuild, setAutoScaffoldOnBuild] = useState(true);
  const [reasoningExpanded, setReasoningExpanded] = useState<Record<string, boolean>>({});

  const abortCtrlRef = useRef<AbortController | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const curPal = PALETTES.blue;

  const activeEndpoint = useMemo(() => {
    return resolveActiveSettings(settings ?? ({} as ClientSettings));
  }, [settings]);

  const shortRoot = useMemo(() => {
    if (!activeRoot) return '~';
    const parts = activeRoot.replace(/\/+$/, '').split('/');
    return parts[parts.length - 1] || activeRoot;
  }, [activeRoot]);

  const allSessionFiles = useMemo<DownloadableFile[]>(() => {
    return messages
      .filter((m) => m.role === 'assistant' && !m.isShell)
      .flatMap((m) => extractFilesFromMarkdown(m.content || m.reasoning || ''));
  }, [messages]);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2400);
  }, []);

  // Auto-scroll terminal viewport
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Matrix Rain Background Canvas (Cyberpunk Katakana & ASCII streams falling behind skull)
  useEffect(() => {
    if (!rainEnabled) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let W = (cv.width = cv.parentElement?.clientWidth || window.innerWidth);
    let H = (cv.height = cv.parentElement?.clientHeight || window.innerHeight);

    const handleResize = () => {
      if (!cv || !cv.parentElement) return;
      W = cv.width = cv.parentElement.clientWidth;
      H = cv.height = cv.parentElement.clientHeight;
    };
    window.addEventListener('resize', handleResize);

    const colW = 18;
    const fs = 13;
    const colsCount = Math.ceil(W / colW);
    const cols = Array.from({ length: colsCount }, () => ({
      y: -Math.random() * H,
      sp: fs * (0.35 + Math.random() * 0.95),
      len: Math.floor(6 + Math.random() * 12),
    }));

    const pool = GLYPHS[glyphSet];
    const getRandomChar = () => pool[Math.floor(Math.random() * pool.length)];

    const draw = () => {
      ctx.fillStyle = curPal.fade;
      ctx.fillRect(0, 0, W, H);

      ctx.font = `${fs}px "IBM Plex Mono", monospace`;
      ctx.textBaseline = 'top';

      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        const cx = i * colW;

        for (let t = 0; t <= c.len; t++) {
          const y = c.y - t * fs;
          if (y < -fs || y > H) continue;

          let color = curPal.t4;
          let alpha = 0.15;
          if (t === 0) {
            color = curPal.head;
            alpha = 0.9;
          } else if (t < 3) {
            color = curPal.t1;
            alpha = 0.65;
          } else if (t < 6) {
            color = curPal.t2;
            alpha = 0.35;
          }

          ctx.globalAlpha = alpha;
          ctx.fillStyle = color;
          ctx.fillText(getRandomChar(), cx, y);
        }

        ctx.globalAlpha = 1;
        c.y += c.sp;
        if (c.y - c.len * fs > H + fs) {
          c.y = -(Math.random() * 4 * fs);
          c.sp = fs * (0.35 + Math.random() * 0.95);
          c.len = Math.floor(6 + Math.random() * 12);
        }
      }

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, [curPal, glyphSet, rainEnabled]);

  // Global hotkeys (when input not actively focused)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === 'Escape' && isStreaming) {
        e.preventDefault();
        abortCtrlRef.current?.abort();
        setIsStreaming(false);
        showToast('[ GENERATION ABORTED ]');
        return;
      }
      if (isInput) return;

      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        setGlyphSet((g) => {
          const next = g === 'kata' ? 'ascii' : 'kata';
          showToast(`[ GLYPHS: ${next.toUpperCase()} ]`);
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isStreaming, showToast]);

  // Helper to add system message
  const addSystemMsg = useCallback((content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        role: 'system',
        content,
        timestamp: formatTime(),
      },
    ]);
  }, []);

  // Seamless Continuation Handler: picks up exactly from where stream stopped
  const handleContinue = async (msgId?: string) => {
    if (isStreaming || isExecutingCmd || isScaffolding) return;

    const targetMsg = msgId
      ? messages.find((m) => m.id === msgId)
      : [...messages].reverse().find((m) => m.role === 'assistant' && !m.isShell);

    if (!targetMsg) {
      addSystemMsg('No assistant response found to continue.');
      return;
    }

    const lastText = targetMsg.content || targetMsg.reasoning || '';
    if (!lastText.trim()) return;

    const tailSnippet = lastText.slice(-140).replace(/\n+/g, ' ');
    addSystemMsg(`[CONTINUATION]: Resuming stream from: "${tailSnippet.slice(-60)}"...`);

    setIsStreaming(true);
    abortCtrlRef.current = new AbortController();

    const continuationPrompt = `Continue your previous response from the EXACT point where you stopped.
Do NOT repeat any of the previous code or text.
Do NOT start over or apologize.
Pick up immediately right after:
"${tailSnippet}"`;

    const chatHistory: ChatOpenAiMessage[] = [
      {
        role: 'system',
        content:
          'You are the Abliterated AI CLI assistant. Resume output from the exact stopping point without repeating prior content.',
      },
      ...messages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.isShell)
        .slice(-6)
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: stripThinkingWrappers(m.content || m.reasoning || ''),
        })),
      { role: 'user', content: continuationPrompt },
    ];

    const cliSettings: ClientSettings & { maxTokens?: number } = {
      ...(settings ?? ({} as ClientSettings)),
      maxTokens: 8192,
      coalesceReasoningToContent: true,
    };

    let appendContent = '';

    try {
      const result = await streamChatCompletion({
        settings: cliSettings,
        model: activeEndpoint.defaultModel,
        messages: chatHistory,
        abortSignal: abortCtrlRef.current.signal,
        enabledTools: [],
        onDelta: (chunk) => {
          appendContent += chunk;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === targetMsg.id
                ? {
                    ...msg,
                    content: (targetMsg.content || '') + appendContent,
                    isStreaming: true,
                    truncated: false,
                  }
                : msg,
            ),
          );
        },
        onReasoningDelta: (chunk) => {
          appendContent += chunk;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === targetMsg.id
                ? {
                    ...msg,
                    content: (targetMsg.content || '') + appendContent,
                    isStreaming: true,
                    truncated: false,
                  }
                : msg,
            ),
          );
        },
      });

      const wasTruncated = result.finishReason === 'length';
      const finalFullContent = (targetMsg.content || '') + appendContent;

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === targetMsg.id
            ? {
                ...msg,
                content: finalFullContent,
                isStreaming: false,
                truncated: wasTruncated,
              }
            : msg,
        ),
      );

      if (wasTruncated) {
        showToast('[ PARTIALLY CONTINUED — TOKEN LIMIT REACHED ]');
      } else {
        showToast('[ CONTINUATION COMPLETE ]');
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      addSystemMsg(`[Continuation Notice]: ${errMsg}`);
    } finally {
      setIsStreaming(false);
      abortCtrlRef.current = null;
    }
  };

  // Execute native shell command through localhost bridge
  const executeShellCommand = async (rawCmd: string) => {
    const cmd = rawCmd.trim();
    if (!cmd || isStreaming || isExecutingCmd || isScaffolding) return;

    const time = formatTime();
    const cmdId = Math.random().toString(36).slice(2);
    const outId = Math.random().toString(36).slice(2);

    // Append user execution command bubble and output receiver
    setMessages((prev) => [
      ...prev,
      {
        id: cmdId,
        role: 'user',
        content: cmd,
        timestamp: time,
        isShell: true,
        shellCommand: cmd,
      },
      {
        id: outId,
        role: 'assistant',
        content: '',
        timestamp: time,
        isShell: true,
        shellCommand: cmd,
        isRunning: true,
        exitCode: null,
      },
    ]);

    // Built-in: cd navigation
    if (cmd.startsWith('cd ') || cmd === 'cd') {
      const target = cmd.slice(3).trim() || '~';
      try {
        if (!bridge.connected) {
          throw new Error('Localhost bridge is not connected at ws://127.0.0.1:17322');
        }
        let resolved = target;
        if (target === '~' || target === '') {
          resolved = bridge.currentAppRoot || activeRoot || '/';
        } else if (!target.startsWith('/')) {
          resolved = (activeRoot ? `${activeRoot}/${target}` : target).replace(/\/+/g, '/');
        }

        const newRoot = await bridge.setRoot(resolved);
        setActiveRoot(newRoot);
        onWorkspaceRootChange?.(newRoot);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === outId
              ? {
                  ...m,
                  content: `Directory changed to: ${newRoot}`,
                  isRunning: false,
                  exitCode: 0,
                  executionTime: 0.01,
                }
              : m,
          ),
        );
        showToast(`[ CWD: ${newRoot.split('/').pop() || newRoot} ]`);
        return;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === outId
              ? {
                  ...m,
                  content: `cd: ${errMsg}`,
                  isRunning: false,
                  exitCode: 1,
                  executionTime: 0.01,
                }
              : m,
          ),
        );
        return;
      }
    }

    // Built-in: pwd
    if (cmd === 'pwd') {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === outId
            ? {
                ...m,
                content: activeRoot || bridge.validWorkspaceRoot || bridge.currentRoot || '/',
                isRunning: false,
                exitCode: 0,
                executionTime: 0.01,
              }
            : m,
        ),
      );
      return;
    }

    // Check Bridge Connectivity
    if (!bridge.connected) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === outId
            ? {
                ...m,
                content:
                  `[Bridge Offline]\nLocal daemon bridge is disconnected (ws://127.0.0.1:17322).\nCannot execute: "${cmd}".\nClick [RECONNECT] in the header to initialize the local bridge connection.`,
                isRunning: false,
                exitCode: 126,
              }
            : m,
        ),
      );
      return;
    }

    setIsExecutingCmd(true);
    const startTime = performance.now();
    let accumOutput = '';

    try {
      const code = await bridge.runCommand(
        cmd,
        (chunk) => {
          accumOutput += chunk;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === outId
                ? {
                    ...m,
                    content: accumOutput,
                  }
                : m,
            ),
          );
        },
        { root: activeRoot || undefined },
      );

      const duration = Number(((performance.now() - startTime) / 1000).toFixed(2));
      const finalDisplay = accumOutput.trim()
        ? accumOutput
        : `[Process exited with return code ${code}]`;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === outId
            ? {
                ...m,
                content: finalDisplay,
                isRunning: false,
                exitCode: code,
                executionTime: duration,
              }
            : m,
        ),
      );

      if (code !== 0) {
        showToast(`[ SHELL: EXIT ${code} ]`);
      } else {
        showToast(`[ SHELL: DONE (${duration}s) ]`);
      }
    } catch (err) {
      const duration = Number(((performance.now() - startTime) / 1000).toFixed(2));
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === outId
            ? {
                ...m,
                content: (accumOutput ? `${accumOutput}\n` : '') + `[Process Error]: ${errMsg}`,
                isRunning: false,
                exitCode: 1,
                executionTime: duration,
              }
            : m,
        ),
      );
      showToast('[ SHELL: ERROR ]');
    } finally {
      setIsExecutingCmd(false);
    }
  };

  // Toggle Auto-Run Shell commands
  const toggleAutoRunShell = useCallback(
    (target?: boolean) => {
      const next = target !== undefined ? target : !autoRunShell;
      setAutoRunShellState(next);
      onPatchSettings?.({ autoRunShell: next });
      showToast(`[ AUTO-RUN SHELL: ${next ? 'ON' : 'OFF'} ]`);
      addSystemMsg(
        next
          ? '⚡ Auto-Run Shell is now ENABLED. Executable shell commands generated by AI will run automatically in the workspace.'
          : '⚡ Auto-Run Shell is now DISABLED. Commands require manual execution.',
      );
    },
    [autoRunShell, onPatchSettings, showToast, addSystemMsg],
  );

  // Initialize or repair Python virtual environment (.venv)
  const handleCreateVenv = useCallback(async () => {
    if (isStreaming || isExecutingCmd || isScaffolding) return;
    showToast('[ INITIALIZING .VENV ]');
    addSystemMsg('Initializing Python virtual environment (.venv) in workspace root...');
    const cmd =
      'python3 -m venv .venv && .venv/bin/pip install --upgrade pip setuptools wheel && .venv/bin/python --version';
    await executeShellCommand(cmd);
  }, [isStreaming, isExecutingCmd, isScaffolding, showToast, addSystemMsg, executeShellCommand]);

  // Format one managed server for a transcript listing.
  const formatServerRow = (s: BridgeServerInfo): string => {
    const dot = s.status === 'running' ? '●' : s.status === 'stopped' ? '■' : '○';
    const meta = [
      `pid ${s.pid || '-'}`,
      s.status.toUpperCase(),
      s.url ? s.url : s.port ? `:${s.port}` : '',
      s.status !== 'running' && s.exitCode != null ? `exit ${s.exitCode}` : '',
    ]
      .filter(Boolean)
      .join('  ');
    return `  ${dot} ${s.id}  ${meta}\n      $ ${s.command}`;
  };

  // Spin up a long-running server as a managed background process via the daemon.
  const spinServer = async (command: string, name?: string) => {
    const cmd = command.trim();
    if (!cmd) {
      addSystemMsg('Usage: /serve <command>   e.g. /serve npm run dev');
      return;
    }
    if (!bridge.connected) {
      addSystemMsg(
        '[Bridge Offline] Cannot spin a server — local daemon bridge is disconnected (ws://127.0.0.1:17322). Click [RECONNECT] in the header.',
      );
      return;
    }
    showToast('[ SPINNING SERVER ]');
    addSystemMsg(`Spinning server: $ ${cmd}${activeRoot ? `\n  cwd: ${activeRoot}` : ''}`);
    let srv: BridgeServerInfo;
    try {
      srv = await bridge.spawnServer(cmd, { root: activeRoot || undefined, name });
    } catch (err) {
      addSystemMsg(`Server failed to start: ${err instanceof Error ? err.message : String(err)}`);
      showToast('[ SERVER: ERROR ]');
      return;
    }
    addSystemMsg(
      `Server started · ${srv.id} · pid ${srv.pid}${srv.url ? ` · ${srv.url}` : ''}\n  /serve logs ${srv.id}   tail output\n  /serve stop ${srv.id}   stop it`,
    );
    showToast(`[ SERVER PID ${srv.pid} ]`);
    // Poll briefly so the startup URL/port (or an early crash) surfaces on its own.
    for (const delay of [900, 2400]) {
      await new Promise((r) => setTimeout(r, delay));
      try {
        const { server } = await bridge.serverLogs(srv.id, 40);
        if (server.url) {
          addSystemMsg(`[Server ${srv.id}] Listening at ${server.url}`);
          break;
        }
        if (server.status !== 'running') {
          const { logs } = await bridge.serverLogs(srv.id, 40);
          addSystemMsg(
            `[Server ${srv.id}] exited early (code ${server.exitCode}).\n${logs || '(no output)'}`,
          );
          break;
        }
      } catch {
        /* transient poll error — ignore */
      }
    }
  };

  // Print the current server roster into the transcript.
  const listServersMsg = async () => {
    if (!bridge.connected) {
      addSystemMsg('[Bridge Offline] Cannot list servers — daemon disconnected.');
      return;
    }
    const list = await bridge.listServers();
    if (!list.length) {
      addSystemMsg('No managed servers. Start one with /serve <command> (e.g. /serve npm run dev).');
      return;
    }
    const running = list.filter((s) => s.status === 'running').length;
    addSystemMsg(
      `MANAGED SERVERS (${list.length} · ${running} running):\n${list.map(formatServerRow).join('\n')}`,
    );
  };

  // Stop one server by id, or every running server when id is "all".
  const stopServerCmd = async (idOrAll: string) => {
    if (!bridge.connected) {
      addSystemMsg('[Bridge Offline] Cannot stop servers — daemon disconnected.');
      return;
    }
    if (idOrAll === 'all' || idOrAll === '*') {
      const list = await bridge.listServers();
      const running = list.filter((s) => s.status === 'running');
      for (const s of running) {
        try {
          await bridge.stopServer(s.id);
        } catch {
          /* ignore individual stop errors */
        }
      }
      addSystemMsg(`Stopped ${running.length} running server(s).`);
      showToast('[ SERVERS STOPPED ]');
      return;
    }
    try {
      await bridge.stopServer(idOrAll);
      addSystemMsg(`Stopped server ${idOrAll}.`);
      showToast('[ SERVER STOPPED ]');
    } catch (err) {
      addSystemMsg(`Stop failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Tail a managed server's recent output.
  const showServerLogs = async (id: string) => {
    if (!bridge.connected) {
      addSystemMsg('[Bridge Offline] Cannot read server logs — daemon disconnected.');
      return;
    }
    try {
      const { logs, server } = await bridge.serverLogs(id, 200);
      addSystemMsg(
        `[Server ${server.id} · ${server.status}${server.url ? ` · ${server.url}` : ''}]\n${logs || '(no output yet)'}`,
      );
    } catch (err) {
      addSystemMsg(`Logs failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Create (or reuse) a workspace directory and switch the active root to it.
  // Accepts an absolute path, a ~/home path, or a path relative to the current
  // root. The directory is created (mkdir -p) via the shell so tilde/relative
  // expansion matches the daemon cwd, then the real absolute path is pinned.
  const createWorkspace = async (rawPath: string) => {
    const input = rawPath.trim().replace(/^['"]|['"]$/g, '');
    if (!input) {
      addSystemMsg(
        'Usage: /workspace <path>\n  Creates (or reuses) a directory and makes it the active workspace root.\n  Accepts an absolute path, ~/relative, or a path relative to the current root.',
      );
      return;
    }
    if (!bridge.connected) {
      addSystemMsg(
        '[Bridge Offline] Cannot create a workspace — local daemon bridge is disconnected (ws://127.0.0.1:17322). Click [RECONNECT] in the header.',
      );
      return;
    }
    showToast('[ CREATING WORKSPACE ]');
    addSystemMsg(`Creating / opening workspace: ${input} ...`);
    const token = shellPathToken(input);
    let out = '';
    try {
      const code = await bridge.runCommand(
        `mkdir -p ${token} && cd ${token} && pwd`,
        (chunk) => {
          out += chunk;
        },
        { root: activeRoot || undefined },
      );
      const resolved = out
        .split(/[\r\n]+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .pop();
      if (code !== 0 || !resolved || !resolved.startsWith('/')) {
        addSystemMsg(
          `Workspace creation failed (exit ${code}).${out.trim() ? `\n${out.trim()}` : ''}`,
        );
        showToast('[ WORKSPACE: FAILED ]');
        return;
      }
      const newRoot = await bridge.setRoot(resolved);
      setActiveRoot(newRoot);
      onWorkspaceRootChange?.(newRoot);
      showToast(`[ WORKSPACE: ${newRoot.split('/').pop() || newRoot} ]`);
      addSystemMsg(
        `Workspace ready and active:\n  ${newRoot}\nFile writes, shell commands, and scaffolding now land here.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addSystemMsg(`Workspace creation failed: ${msg}`);
      showToast('[ WORKSPACE: ERROR ]');
    }
  };

  // Materialize a directory/file skeleton into the active workspace. Files get a
  // minimal language-aware stub; pure directories get a .gitkeep. Existing
  // non-empty files are never clobbered (they are kept and counted as skipped).
  const scaffoldStructure = async (
    spec: { dirs: string[]; files: string[] },
  ): Promise<{ created: number; skipped: number; failed: number; createdPaths: string[] }> => {
    const root = activeRoot || bridge.validWorkspaceRoot || bridge.currentRoot || '';
    if (!bridge.connected) {
      addSystemMsg('[Bridge Offline] Cannot scaffold — local daemon bridge is disconnected.');
      return { created: 0, skipped: 0, failed: 0, createdPaths: [] };
    }
    if (!root) {
      addSystemMsg('No workspace root set. Use /workspace <path> to create one first.');
      return { created: 0, skipped: 0, failed: 0, createdPaths: [] };
    }
    const targets = [
      ...spec.files,
      ...spec.dirs.map((d) => `${d.replace(/\/+$/, '')}/.gitkeep`),
    ];
    let created = 0;
    let skipped = 0;
    let failed = 0;
    const createdPaths: string[] = [];
    for (const rel of targets) {
      try {
        let existing = '';
        try {
          existing = await bridge.readFile(rel);
        } catch {
          existing = '';
        }
        const isKeep = rel.endsWith('/.gitkeep');
        if (existing && (isKeep || existing.trim())) {
          skipped++;
          continue;
        }
        await bridge.writeFile(rel, scaffoldStub(rel), { root: root || undefined });
        created++;
        createdPaths.push(rel);
      } catch {
        failed++;
      }
    }
    return { created, skipped, failed, createdPaths };
  };

  // BUILD SCOPE · PHASE 1: ask the model for the complete file manifest only,
  // then create the skeleton on disk before the buildout turn fills each file.
  const runPreBuildScaffold = async (
    prompt: string,
  ): Promise<'scaffolded' | 'skipped' | 'aborted'> => {
    const root = activeRoot || bridge.validWorkspaceRoot || bridge.currentRoot || '';
    if (!bridge.connected || !root) return 'skipped';
    setIsScaffolding(true);
    abortCtrlRef.current = new AbortController();
    const ac = abortCtrlRef.current;
    addSystemMsg(
      '[BUILD SCOPE · PHASE 1/2 — SCAFFOLD]: Mapping the complete file/folder structure before buildout...',
    );
    showToast('[ SCAFFOLDING STRUCTURE ]');

    const scaffoldSystem = `You are a project scaffolding planner. Given a build request, output ONLY the complete file and directory structure the finished project requires, as a single fenced code block tagged "scaffold".
Rules:
- One path per line, workspace-relative (no leading "/", no ".." ).
- Directories end with a trailing slash (e.g. src/).
- Include EVERY file the project needs: entry points, source modules, configs, tests, and a README.
- NO prose, NO explanations, NO file contents — only the path manifest inside the \`\`\`scaffold block.`;

    let raw = '';
    try {
      await streamChatCompletion({
        settings: {
          ...(settings ?? ({} as ClientSettings)),
          maxTokens: 2048,
          coalesceReasoningToContent: true,
        } as ClientSettings & { maxTokens?: number },
        model: activeEndpoint.defaultModel,
        messages: [
          { role: 'system', content: scaffoldSystem },
          {
            role: 'user',
            content: `Build request: ${prompt}\n\nOutput the scaffold manifest now.`,
          },
        ],
        abortSignal: abortCtrlRef.current.signal,
        enabledTools: [],
        onDelta: (chunk) => {
          raw += chunk;
        },
        onReasoningDelta: () => {},
      });
    } catch (err) {
      setIsScaffolding(false);
      abortCtrlRef.current = null;
      if (ac.signal.aborted) {
        addSystemMsg('[Scaffold aborted by user].');
        return 'aborted';
      }
      const msg = err instanceof Error ? err.message : String(err);
      addSystemMsg(`[Scaffold Notice]: ${msg}. Proceeding directly to buildout.`);
      return 'skipped';
    }

    // Prefer a fenced manifest block; fall back to any code block, then raw text.
    const blocks = parseContentBlocks(raw);
    const manifestBlock = blocks.find(
      (b) => b.type === 'code' && /scaffold|tree|structure|text|plain/i.test(b.language || ''),
    );
    const manifestText =
      manifestBlock?.content ||
      blocks
        .filter((b) => b.type === 'code')
        .map((b) => b.content)
        .join('\n') ||
      raw;
    const spec = parseScaffoldSpec(manifestText);

    if (spec.files.length === 0 && spec.dirs.length === 0) {
      addSystemMsg('[Scaffold]: No file structure could be derived; proceeding directly to buildout.');
      setIsScaffolding(false);
      abortCtrlRef.current = null;
      return 'skipped';
    }

    const res = await scaffoldStructure(spec);
    const treeList = [
      ...spec.dirs.map((d) => `  + ${d.replace(/\/?$/, '/')}`),
      ...spec.files.map((f) => `  + ${f}`),
    ]
      .slice(0, 60)
      .join('\n');
    addSystemMsg(
      `[BUILD SCOPE · PHASE 1/2 — SCAFFOLD COMPLETE]: ${res.created} created, ${res.skipped} kept, ${res.failed} failed in ${root}\n${treeList}`,
    );
    showToast(`[ SCAFFOLDED ${res.created} FILES ]`);
    setIsScaffolding(false);
    abortCtrlRef.current = null;
    return 'scaffolded';
  };

  // Send AI Chat Message with Complete Runway
  const sendAiChat = async (promptText: string) => {
    if (!promptText.trim() || isStreaming || isExecutingCmd || isScaffolding) return;

    const userMsgId = Math.random().toString(36).slice(2);
    const assistantMsgId = Math.random().toString(36).slice(2);
    const time = formatTime();

    // Classify the turn ONCE (the single, visible interpretation — see
    // docs/CLI-ENHANCED-FLOW.md). agentHelpers supplies the authoritative
    // build/web signals; the classifier folds in debug/edit/run/chat precedence.
    const turnClass = classifyCliTurn(promptText, {
      isBuild: looksBuildIntent(promptText),
      isWeb: looksWebInteractionDirective(promptText),
      hasWorkspace: Boolean(activeRoot || bridge.validWorkspaceRoot),
    });

    // Show the user's prompt immediately (tagged with its intent for the chip)
    // so any build-scope scaffold logs land after it.
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: 'user',
        content: promptText,
        timestamp: time,
        intent: turnClass.intent,
      },
    ]);

    // BUILD SCOPE · PHASE 1: scaffold the file structure before building out.
    // Gated on the classifier's build intent (build && !debug && !web) when a
    // workspace root is set and auto-scaffold is enabled.
    let didScaffold = false;
    if (
      autoScaffoldOnBuild &&
      turnClass.intent === 'build' &&
      bridge.connected &&
      (activeRoot || bridge.validWorkspaceRoot)
    ) {
      const scaffoldStatus = await runPreBuildScaffold(promptText);
      if (scaffoldStatus === 'aborted') return; // user stopped during scaffold — skip buildout
      didScaffold = scaffoldStatus === 'scaffolded';
    }

    // Add the empty streaming assistant slot for the buildout response.
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        reasoning: '',
        isStreaming: true,
        truncated: false,
        timestamp: time,
      },
    ]);

    setIsStreaming(true);
    abortCtrlRef.current = new AbortController();

    // Proactive live web search when the turn is a web-interaction directive.
    let augmentedPrompt = promptText;
    if (turnClass.signals.isWeb) {
      showToast('[ WEB SEARCH: LIVE QUERY ]');
      addSystemMsg(`[Web Intelligence]: Querying live web for "${promptText}"...`);
      try {
        const rawWeb = await runWebSearch({ query: promptText, count: 6 });
        if (rawWeb && rawWeb.trim()) {
          augmentedPrompt = `${promptText}\n\nLIVE WEB SEARCH RESULTS FOR "${promptText}":\n\`\`\`\n${rawWeb}\n\`\`\`\n\nAnswer directly by summarizing and synthesizing these results. Do not write scraping code unless the user asked for code.`;
        }
      } catch (searchErr) {
        const msg = searchErr instanceof Error ? searchErr.message : String(searchErr);
        addSystemMsg(`[Web Search Notice]: ${msg}`);
      }
    }

    // BUILD SCOPE · PHASE 2: a skeleton is already on disk — instruct a full build-out.
    if (didScaffold) {
      augmentedPrompt = `${augmentedPrompt}\n\n[BUILD SCOPE — PHASE 2/2 BUILD OUT]: A complete project skeleton has already been scaffolded in the active workspace (${activeRoot || 'workspace root'}). Now implement every file with full, working, production-quality code. For each file, output a fenced code block whose info string is the workspace-relative path (e.g. \`\`\`ts src/main.ts) so it can be written into the scaffold. Do not leave any scaffolded file empty or stubbed. Do not re-print the directory tree.`;
    }

    // Opt-in change summary — only on build/scaffold turns, not on every reply.
    if (didScaffold || turnClass.intent === 'build') {
      augmentedPrompt = `${augmentedPrompt}\n\nEnd with a short "### Summary" (2-4 bullets): what you created or changed, the key files or commands, and how to verify.`;
    }

    // One lean system prompt: persona + uncensored + don't-hallucinate. Turn-scoped
    // extras (web results, build-out, summary) are appended to the user turn only when
    // they actually apply, so a normal reply carries no stacked/contradictory directives.
    const systemPrompt = `You are the Abliterated AI CLI assistant, an expert software engineer and systems architect operating in an uncensored local terminal environment. Answer directly, factually, and thoroughly, without moralizing or refusing. Provide complete, working code with no placeholders or stubs.

Think briefly before answering: a minimal thought process — 1 to 3 short lines outlining your approach — then give the answer. Keep the thinking terse; do not restate the question or narrate at length.

Do not hallucinate: never invent APIs, flags, parameters, library exports, or file paths. Reference only real, verified functions/packages or context already established here; if something is unverified, say so plainly instead of guessing.`;

    // Clean historical context for API call (strip internal think wrappers from past turns so tokens are clean)
    const chatHistory: ChatOpenAiMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.isShell)
        .slice(-8)
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: stripThinkingWrappers(m.content || m.reasoning || ''),
        })),
      { role: 'user', content: augmentedPrompt },
    ];

    // Client settings with 8192 maxTokens buffer so completions have maximum runway
    const cliSettings: ClientSettings & { maxTokens?: number } = {
      ...(settings ?? ({} as ClientSettings)),
      maxTokens: 8192,
      coalesceReasoningToContent: true,
    };

    let accumContent = '';
    let accumReasoning = '';

    try {
      const result = await streamChatCompletion({
        settings: cliSettings,
        model: activeEndpoint.defaultModel,
        messages: chatHistory,
        abortSignal: abortCtrlRef.current.signal,
        // No built-in web tools here: mid-answer tool calls had no follow-up
        // completion (results were dumped as system messages the model never saw),
        // so the reply dead-ended. Web-directive prompts are augmented up-front
        // above; use /search and /fetch for explicit lookups.
        enabledTools: [],
        onDelta: (chunk) => {
          accumContent += chunk;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId ? { ...msg, content: accumContent } : msg,
            ),
          );
        },
        onReasoningDelta: (chunk) => {
          accumReasoning += chunk;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId ? { ...msg, reasoning: accumReasoning } : msg,
            ),
          );
        },
      });

      // Stream Finished: Finalize both channels cleanly
      let finalContent = accumContent;
      let finalReasoning = accumReasoning;

      // Extract inline <think> tags if model output them inside content
      const split = splitThinkFromContent(finalContent);
      if (split.thinking) {
        finalReasoning = [finalReasoning, split.thinking].filter(Boolean).join('\n\n');
        finalContent = split.content;
      }

      // If content channel was completely empty, promote reasoning to content
      if (!finalContent.trim() && finalReasoning.trim()) {
        finalContent = promoteReasoningToContent(finalContent, finalReasoning);
      }

      // Truncation is authoritative from the API stop reason only — the old
      // endsWith('--') / odd-fence-count heuristics flagged legitimate replies.
      const wasTruncated = result.finishReason === 'length';

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? {
                ...msg,
                content: finalContent,
                reasoning: finalReasoning,
                isStreaming: false,
                truncated: wasTruncated,
              }
            : msg,
        ),
      );

      // Auto-Run Shell (opt-in, default off): run only when the reply contains
      // EXACTLY ONE shell block, so we never guess which of several snippets to run.
      if (autoRunShell && finalContent.trim() && !isExecutingCmd) {
        const shellBlocks = parseContentBlocks(finalContent).filter(
          (b) =>
            b.type === 'code' &&
            /^(bash|sh|shell|zsh|console|terminal)$/i.test(b.language || '') &&
            b.content.trim(),
        );
        if (shellBlocks.length === 1) {
          const cmdToRun = shellBlocks[0].content.trim();
          setTimeout(() => {
            addSystemMsg(
              `⚡ [AUTO-RUN SHELL]: Executing generated command in workspace:\n$ ${cmdToRun}`,
            );
            void executeShellCommand(cmdToRun);
          }, 350);
        } else if (shellBlocks.length > 1) {
          addSystemMsg(
            `[Auto-Run Shell]: ${shellBlocks.length} shell blocks in the reply — not auto-running. Run the one you want with "$ <cmd>".`,
          );
        }
      }
    } catch (err) {
      if (abortCtrlRef.current?.signal.aborted) {
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== assistantMsgId) return msg;
            let c = msg.content || accumContent;
            if (!c.trim() && (msg.reasoning || accumReasoning).trim()) {
              c = promoteReasoningToContent(c, msg.reasoning || accumReasoning);
            }
            return {
              ...msg,
              isStreaming: false,
              content: c + '\n[Stream stopped by user]',
            };
          }),
        );
      } else {
        const errMsg = err instanceof Error ? err.message : String(err);
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== assistantMsgId) return msg;
            let c = msg.content || accumContent;
            if (!c.trim() && (msg.reasoning || accumReasoning).trim()) {
              c = promoteReasoningToContent(c, msg.reasoning || accumReasoning);
            }
            return {
              ...msg,
              isStreaming: false,
              content: (c.trim() ? `${c}\n\n` : '') + `[Inference Status]: ${errMsg}`,
            };
          }),
        );
      }
    } finally {
      setIsStreaming(false);
      abortCtrlRef.current = null;
    }
  };

  // Slash and Command Runner
  const executeCommand = useCallback(
    async (cmdLine: string) => {
      const clean = cmdLine.replace(/^\//, '').trim();
      const [cmd, ...restArgs] = clean.split(/\s+/);
      const arg = restArgs.join(' ').trim();
      // Remainder after the command word with newlines/structure preserved
      // (used by /scaffold for multi-line manifests pasted into the textarea).
      const rawArg = cmdLine.replace(/^\s*\/?\S+[ \t]*/, '');

      switch (cmd.toLowerCase()) {
        case 'continue':
        case 'c':
          handleContinue();
          break;

        case 'zip':
        case 'download': {
          if (allSessionFiles.length === 0) {
            addSystemMsg('No generated code files found in the current conversation to download.');
          } else {
            const dateStr = new Date().toISOString().slice(0, 10);
            downloadFilesAsZip(`abliterated-chat-files-${dateStr}`, allSessionFiles);
            showToast(`[ EXPORTED ZIP: ${allSessionFiles.length} FILES ]`);
            addSystemMsg(
              `Exported ZIP archive containing ${allSessionFiles.length} files:\n${allSessionFiles.map((f) => `  • ${f.name}`).join('\n')}`,
            );
          }
          break;
        }

        case 'sh':
        case 'shell':
        case 'run':
        case 'exec': {
          if (!arg) {
            setCliMode('shell');
            showToast('[ MODE: SHELL ]');
            addSystemMsg('Switched to Shell interface mode.');
          } else {
            await executeShellCommand(arg);
          }
          break;
        }

        case 'ai':
        case 'ask':
        case 'chat': {
          if (!arg) {
            setCliMode('ai');
            showToast('[ MODE: AI CHAT ]');
            addSystemMsg('Switched to AI Chat interface mode.');
          } else {
            await sendAiChat(arg);
          }
          break;
        }

        case 'autorun':
        case 'autoshell':
        case 'auto-run': {
          const lower = arg.toLowerCase();
          if (lower === 'on' || lower === 'true' || lower === 'enable' || lower === '1') {
            toggleAutoRunShell(true);
          } else if (lower === 'off' || lower === 'false' || lower === 'disable' || lower === '0') {
            toggleAutoRunShell(false);
          } else {
            toggleAutoRunShell();
          }
          break;
        }

        case 'venv':
        case 'create-venv':
        case 'init-venv': {
          const sub = arg.toLowerCase();
          if (sub === 'status' || sub === 'check') {
            await executeShellCommand(
              '.venv/bin/python --version 2>&1 && .venv/bin/pip --version 2>&1 && .venv/bin/pip list',
            );
          } else {
            await handleCreateVenv();
          }
          break;
        }

        case 'workspace':
        case 'ws':
        case 'mkws':
        case 'newws': {
          if (!arg) {
            addSystemMsg(
              `Current workspace root: ${activeRoot || '(none set)'}\nUsage: /workspace <path>   — create (or reuse) a directory and make it the active workspace.`,
            );
            break;
          }
          await createWorkspace(arg);
          break;
        }

        case 'scaffold':
        case 'skeleton':
        case 'tree': {
          const sub = arg.toLowerCase().trim();
          // /scaffold auto [on|off] — toggle auto-scaffold on build-intent turns.
          if (sub === 'auto' || sub.startsWith('auto ')) {
            const val = sub.replace(/^auto\s*/, '').trim();
            let next = !autoScaffoldOnBuild;
            if (['on', 'true', 'enable', '1'].includes(val)) next = true;
            else if (['off', 'false', 'disable', '0'].includes(val)) next = false;
            setAutoScaffoldOnBuild(next);
            showToast(`[ AUTO-SCAFFOLD: ${next ? 'ON' : 'OFF'} ]`);
            addSystemMsg(
              next
                ? 'Auto-scaffold ENABLED. A "build" request will first lay down the complete file skeleton, then build it out.'
                : 'Auto-scaffold DISABLED. Build requests go straight to the buildout response.',
            );
            break;
          }
          if (!bridge.connected) {
            addSystemMsg('[Bridge Offline] Cannot scaffold — local daemon bridge is disconnected.');
            break;
          }
          if (!(activeRoot || bridge.validWorkspaceRoot || bridge.currentRoot)) {
            addSystemMsg('No workspace root set. Use /workspace <path> to create one first.');
            break;
          }
          // With a manifest argument → scaffold those paths. Without → scaffold
          // the file structure proposed in the most recent AI response.
          let spec: { dirs: string[]; files: string[] };
          let sourceLabel: string;
          if (rawArg.trim()) {
            spec = parseScaffoldSpec(rawArg);
            sourceLabel = 'manifest';
          } else {
            const lastAi = [...messages]
              .reverse()
              .find((m) => m.role === 'assistant' && !m.isShell && (m.content || '').trim());
            const proposed = lastAi
              ? extractFilesFromMarkdown(lastAi.content || '').map((f) => f.name)
              : [];
            spec = parseScaffoldSpec(proposed.join('\n'));
            sourceLabel = 'last AI response';
          }
          if (spec.files.length === 0 && spec.dirs.length === 0) {
            addSystemMsg(
              'Nothing to scaffold. Usage: /scaffold <paths...> (e.g. /scaffold src/ src/main.py README.md), or run it right after an AI response that proposes files.',
            );
            break;
          }
          showToast('[ SCAFFOLDING STRUCTURE ]');
          addSystemMsg(
            `Scaffolding ${spec.files.length} file(s) + ${spec.dirs.length} dir(s) from ${sourceLabel} into ${activeRoot}...`,
          );
          const scRes = await scaffoldStructure(spec);
          const scTree = [
            ...spec.dirs.map((d) => `  + ${d.replace(/\/?$/, '/')}`),
            ...spec.files.map((f) => `  + ${f}`),
          ]
            .slice(0, 80)
            .join('\n');
          addSystemMsg(
            `[SCAFFOLD COMPLETE]: ${scRes.created} created, ${scRes.skipped} kept, ${scRes.failed} failed.\n${scTree}`,
          );
          showToast(`[ SCAFFOLDED ${scRes.created} FILES ]`);
          break;
        }

        case 'serve':
        case 'server': {
          const [subRaw, ...rest] = arg.split(/\s+/);
          const sub = (subRaw || '').toLowerCase();
          const restArg = rest.join(' ').trim();
          if (!arg) {
            addSystemMsg(
              'Server control:\n  /serve <command>        spin up a server (e.g. /serve npm run dev)\n  /serve list             list managed servers\n  /serve logs <id>        tail a server\'s output\n  /serve stop <id|all>    stop a server (or all of them)',
            );
            break;
          }
          if (sub === 'list' || sub === 'ls' || sub === 'ps' || sub === 'status') {
            await listServersMsg();
          } else if (sub === 'logs' || sub === 'log' || sub === 'tail') {
            if (!restArg) addSystemMsg('Usage: /serve logs <server-id>');
            else await showServerLogs(restArg);
          } else if (sub === 'stop' || sub === 'kill') {
            if (!restArg) addSystemMsg('Usage: /serve stop <server-id|all>');
            else await stopServerCmd(restArg);
          } else if (sub === 'start' || sub === 'run') {
            // Everything after "start"/"run" is the command to launch.
            const startCmd = rawArg.replace(/^\s*(?:start|run)\s+/i, '').trim();
            await spinServer(startCmd);
          } else {
            // Bare `/serve <command>` — the whole remainder is the server command.
            await spinServer(rawArg.trim() || arg);
          }
          break;
        }

        case 'servers':
        case 'ps': {
          await listServersMsg();
          break;
        }

        case 'stop': {
          if (!arg) {
            addSystemMsg('Usage: /stop <server-id|all>');
            break;
          }
          await stopServerCmd(arg.trim());
          break;
        }

        case 'search':
        case 'web': {
          if (!arg) {
            addSystemMsg('Usage: /search <search query>');
            break;
          }
          showToast(`[ SEARCHING WEB: "${arg.slice(0, 20)}" ]`);
          addSystemMsg(`Searching web for "${arg}"...`);
          try {
            const results = await runWebSearch({ query: arg, count: 6 });
            addSystemMsg(`LIVE WEB RESULTS FOR "${arg}":\n\n${results}`);
          } catch (e) {
            const errM = e instanceof Error ? e.message : String(e);
            addSystemMsg(`Web search failed: ${errM}`);
          }
          break;
        }

        case 'fetch':
        case 'url': {
          if (!arg) {
            addSystemMsg('Usage: /fetch <https://...>');
            break;
          }
          showToast(`[ FETCHING URL ]`);
          addSystemMsg(`Fetching "${arg}"...`);
          try {
            const res = await fetch(arg);
            const text = await res.text();
            addSystemMsg(`[FETCH ${arg} - Status ${res.status}]:\n${text.slice(0, 2500)}`);
          } catch (e) {
            const errM = e instanceof Error ? e.message : String(e);
            addSystemMsg(`Web fetch failed: ${errM}`);
          }
          break;
        }

        case 'help':
          addSystemMsg(
            `COMMAND DIRECTORY:
  /help                  Display this command manual
  /mode <ai|shell>       Switch between AI Chat and Shell interface
  /continue (or 'c')     Resume generation seamlessly from cutoff point
  /sh <command>          Run shell command in workspace (works in any mode)
  /ai <prompt>           Ask the AI assistant (works in any mode)
  /workspace <path>      Create (or reuse) a directory and make it the active workspace (aliases: /ws, /mkws)
  /scaffold [paths]      Scaffold a file/folder skeleton into the workspace
                           • /scaffold src/ src/main.py README.md   (explicit paths)
                           • /scaffold                              (from the last AI response's files)
                           • /scaffold auto [on|off]                (toggle auto-scaffold before "build" turns)
  /serve <command>       Spin up a long-running server as a managed background process
                           • /serve npm run dev                     (start a dev server)
                           • /serve list                            (list managed servers)
                           • /serve logs <id>                       (tail a server's output)
                           • /serve stop <id|all>                   (stop a server, or all)
  /servers               List managed servers (alias for /serve list)
  /stop <id|all>         Stop a managed server
  /autorun [on|off]      Toggle auto-running AI generated shell commands
  /venv [check]          Create, bootstrap, or inspect workspace Python .venv
  /search <query>        Search the live web directly via web search
  /fetch <url>           Fetch and inspect public web URL contents
  /zip (or /download)    Download all generated response code files as a ZIP
  /thoughts <show|hide>  Toggle thought traces visibility (show or compact)
  /clear                 Wipe the terminal screen and chat history
  /models                List available models on the active cluster
  /lambda <0.0 - 1.0>    Set refusal projection parameter (0 = zeroed, 1 = standard)
  /stats                 Telemetry, KL drift, and refusal vector specs
  /spectrum              Display active color spectrum (Electric Blue)
  /rain                  Toggle Matrix digital rain background canvas
  /skull                 Toggle terminal ASCII skull backdrop
  /glyphs                Toggle Katakana / ASCII matrix font
  /probe <query>         Execute targeted refusal probe
  /whoami                Display session clearance, bridge, and model info
  /copy                  Copy entire terminal transcript to clipboard

SHELL MODE COMMANDS:
  cd <dir>               Navigate to a workspace directory
  pwd                    Display current working directory
  clear                  Clear terminal screen
  ai <prompt> (or '?')   Ask the AI assistant directly from the shell
  <any shell command>    Executes natively in the local shell via bridge`,
          );
          break;

        case 'thoughts':
        case 'thought': {
          const lower = arg.toLowerCase();
          if (lower === 'hide' || lower === 'compact' || lower === 'off') {
            setThoughtsVisible(false);
            showToast('[ THOUGHTS: COMPACT ]');
            addSystemMsg(
              'Thought traces set to COMPACT. Thought accordions will remain folded by default.',
            );
          } else if (lower === 'show' || lower === 'expanded' || lower === 'on') {
            setThoughtsVisible(true);
            showToast('[ THOUGHTS: EXPANDED ]');
            addSystemMsg(
              'Thought traces set to EXPANDED. Thought accordions will remain visible.',
            );
          } else {
            setThoughtsVisible((v) => !v);
            addSystemMsg(`Thoughts visibility toggled.`);
          }
          break;
        }

        case 'clear':
          setMessages([
            {
              id: Math.random().toString(36).slice(2),
              role: 'system',
              content: 'Buffer cleared. ABLITERATED CLI ready.',
              timestamp: formatTime(),
            },
          ]);
          break;

        case 'lambda': {
          if (!arg) {
            addSystemMsg(
              `Current λ = ${lambda.toFixed(4)} (${lambda <= 0.01 ? 'ZEROED — Uncensored' : 'PARTIALLY RETAINED'})`,
            );
            break;
          }
          const val = parseFloat(arg);
          if (isNaN(val) || val < 0 || val > 1) {
            addSystemMsg('Usage: /lambda <0.0 to 1.0> (e.g. /lambda 0 or /lambda 0.25)');
          } else {
            setLambda(val);
            addSystemMsg(
              `λ updated to ${val.toFixed(4)}.\nRefusal status: ${
                val <= 0.01
                  ? 'ZEROED (Guardrails: DOWN, Uncensored)'
                  : `ACTIVE (${(val * 100).toFixed(1)}% Refusal Vector)`
              }`,
            );
            showToast(`[ λ SET: ${val.toFixed(2)} ]`);
          }
          break;
        }

        case 'stats': {
          const refuseProb = Math.max(0.0001, Number((lambda * 0.942).toFixed(4)));
          const klDrift = (0.2117 * (1 - lambda)).toFixed(4);
          const pplDelta = (1.74 * (1 - lambda)).toFixed(2);
          addSystemMsg(
            `ENGINE STATUS & TELEMETRY:
  BACKEND          ${activeEndpoint.provider.toUpperCase()} (${activeEndpoint.label})
  ACTIVE MODEL     ${activeEndpoint.defaultModel}
  RUNWAY BUDGET    8192 Max Output Tokens (Seamless Continuation Supported)
  BRIDGE STATUS    ${bridgeState.toUpperCase()} (ws://127.0.0.1:17322)
  WORKSPACE ROOT   ${activeRoot || 'Project Base'}
  SPECTRUM         ${world.toUpperCase()} (Primary Neon: ${curPal.neon})
  REFUSAL COEFF    λ = ${lambda.toFixed(4)} (${lambda <= 0.01 ? 'ZEROED' : 'PARTIAL'})
  REFUSAL PROB     ${refuseProb}
  KL DIVERGENCE    ${klDrift} / token
  PERPLEXITY Δ     +${pplDelta}%
  ORTHOGONAL DIM   Layer 14-18 Subspace Projection (4096-dim)
  LATENCY          Real-time Localhost Stream`,
          );
          break;
        }

        case 'models': {
          addSystemMsg('Querying active models from cluster endpoint...');
          try {
            const res = await fetch('/spark-v1/models', { signal: AbortSignal.timeout(2500) });
            if (res.ok) {
              const data = await res.json();
              const list = data?.data || [];
              const formatted = list.map((m: { id: string }) => `  • ${m.id}`).join('\n');
              addSystemMsg(`Connected Cluster Models (${list.length} online):\n${formatted}`);
            } else {
              addSystemMsg(
                `Cluster models status ${res.status}. Active default: ${activeEndpoint.defaultModel}`,
              );
            }
          } catch {
            addSystemMsg(
              `Local cluster proxy offline. Using configured model: ${activeEndpoint.defaultModel}`,
            );
          }
          break;
        }

        case 'spectrum': {
          showToast('[ SPECTRUM: ELECTRIC BLUE ]');
          addSystemMsg('Spectrum is locked to Electric Blue world.');
          break;
        }

        case 'rain':
          setRainEnabled((prev) => {
            const next = !prev;
            showToast(`[ RAIN: ${next ? 'ON' : 'OFF'} ]`);
            addSystemMsg(`Matrix digital rain canvas: ${next ? 'ENABLED' : 'DISABLED'}`);
            return next;
          });
          break;

        case 'skull':
          setSkullEnabled((prev) => {
            const next = !prev;
            showToast(`[ SKULL: ${next ? 'ON' : 'OFF'} ]`);
            addSystemMsg(`Terminal ASCII skull backdrop: ${next ? 'ENABLED' : 'DISABLED'}`);
            return next;
          });
          break;

        case 'glyphs':
          setGlyphSet((prev) => {
            const next = prev === 'kata' ? 'ascii' : 'kata';
            showToast(`[ GLYPHS: ${next.toUpperCase()} ]`);
            addSystemMsg(`Rain glyph set: ${next.toUpperCase()}`);
            return next;
          });
          break;

        case 'mode': {
          const m = arg.toLowerCase();
          if (m === 'ai' || m === 'chat') {
            setCliMode('ai');
            showToast('[ MODE: AI CHAT CLI ]');
            addSystemMsg('Switched to AI Chat CLI interface.');
          } else if (m === 'shell' || m === 'bash') {
            setCliMode('shell');
            showToast('[ MODE: SHELL UPLINK ]');
            addSystemMsg('Switched to Shell Uplink command interface.');
          } else {
            addSystemMsg('Usage: /mode <ai|shell>');
          }
          break;
        }

        case 'whoami':
          addSystemMsg(
            `USER: guest@abliterated
SECURITY CLEARANCE: UNCENSORED
BRIDGE: ${bridgeState.toUpperCase()} (ws://127.0.0.1:17322)
WORKING ROOT: ${activeRoot || 'Default'}
ACTIVE MODEL: ${activeEndpoint.defaultModel}
PROVIDER: ${activeEndpoint.provider}
SPECTRUM: ${world.toUpperCase()}`,
          );
          break;

        case 'copy': {
          const transcript = messages
            .map((m) => {
              if (m.isShell) {
                return `[${m.timestamp}] SHELL $ ${m.shellCommand || m.content}\n${m.content}\n${m.exitCode != null ? `[exit ${m.exitCode}]` : ''}`;
              }
              return `[${m.timestamp}] ${m.role.toUpperCase()}:\n${m.content}\n`;
            })
            .join('\n---\n\n');
          await navigator.clipboard.writeText(transcript);
          showToast('[ TRANSCRIPT COPIED ]');
          addSystemMsg('Terminal transcript copied to clipboard.');
          break;
        }

        case 'probe': {
          if (!arg) {
            addSystemMsg('Usage: /probe <test query>');
            break;
          }
          addSystemMsg(`[REFUSAL PROBE]: Testing activation response for "${arg}"...`);
          await sendAiChat(arg);
          break;
        }

        default:
          addSystemMsg(`Unknown command: "${cmd}". Type /help for available commands.`);
          break;
      }
    },
    [
      activeEndpoint,
      activeRoot,
      allSessionFiles,
      bridgeState,
      curPal,
      lambda,
      messages,
      showToast,
      world,
      toggleAutoRunShell,
      handleCreateVenv,
      autoScaffoldOnBuild,
    ],
  );

  // Input Submission Handler
  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const raw = inputVal.trim();
    if (!raw || isStreaming || isExecutingCmd || isScaffolding) return;

    // History tracking
    setHistory((prev) => [raw, ...prev]);
    setHistoryIdx(-1);
    setInputVal('');

    // Check for continuation trigger
    if (
      raw.toLowerCase() === 'continue' ||
      raw.toLowerCase() === '/continue' ||
      raw.toLowerCase() === 'c'
    ) {
      handleContinue();
      return;
    }

    // Explicit shell escape in any mode
    if (raw.startsWith('$') || raw.startsWith('!')) {
      executeShellCommand(raw.slice(1).trim());
      return;
    }

    // Slash command runner
    if (raw.startsWith('/')) {
      executeCommand(raw);
      return;
    }

    // In SHELL mode
    if (cliMode === 'shell') {
      if (raw.startsWith('?')) {
        sendAiChat(raw.slice(1).trim());
      } else if (/^ai\s+/i.test(raw)) {
        sendAiChat(raw.replace(/^ai\s+/i, '').trim());
      } else if (raw === 'clear') {
        executeCommand('clear');
      } else if (raw === 'exit') {
        setCliMode('ai');
        showToast('[ MODE: AI CHAT ]');
      } else {
        executeShellCommand(raw);
      }
      return;
    }

    // Default AI Chat Mode
    sendAiChat(raw);
  };

  // Keyboard navigation for prompt history
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }

    if (e.key === 'ArrowUp' && (inputVal === '' || historyIdx >= 0)) {
      e.preventDefault();
      if (history.length > 0 && historyIdx < history.length - 1) {
        const nextIdx = historyIdx + 1;
        setHistoryIdx(nextIdx);
        setInputVal(history[nextIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx > 0) {
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setInputVal(history[nextIdx]);
      } else if (historyIdx === 0) {
        setHistoryIdx(-1);
        setInputVal('');
      }
    }
  };

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 1800);
    showToast('[ CODE COPIED ]');
  };

  const toggleReasoning = (id: string) => {
    setReasoningExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleExplainFailure = (cmd: string, exitCode: number | null, output: string) => {
    const prompt = `The shell command failed with exit code ${exitCode ?? 'unknown'}:
\`$ ${cmd}\`

Command Output:
\`\`\`
${output}
\`\`\`

Please diagnose why this failed and provide the exact fix or corrected command.`;
    sendAiChat(prompt);
  };

  // Bottom Quick Prompts
  const quickPrompts = useMemo(() => {
    if (cliMode === 'shell') {
      return [
        { label: 'git status', action: () => executeShellCommand('git status') },
        { label: 'ls -la', action: () => executeShellCommand('ls -la') },
        {
          label: 'New Workspace',
          action: () => {
            setInputVal('/workspace ');
            inputRef.current?.focus();
          },
        },
        { label: 'Create .venv', action: () => handleCreateVenv() },
        {
          label: autoRunShell ? 'Auto-Run: ON' : 'Auto-Run: OFF',
          action: () => toggleAutoRunShell(),
        },
        { label: 'pwd', action: () => executeShellCommand('pwd') },
        {
          label: 'Spin Server',
          action: () => {
            setInputVal('/serve ');
            inputRef.current?.focus();
          },
        },
        { label: 'Servers', action: () => executeCommand('/serve list') },
        { label: 'npm test', action: () => executeShellCommand('npm test') },
        { label: 'Switch to AI Chat', action: () => setCliMode('ai') },
        { label: 'Help', action: () => executeCommand('/help') },
      ];
    }
    return [
      { label: 'Continue Generation', action: () => handleContinue() },
      {
        label: 'New Workspace',
        action: () => {
          setInputVal('/workspace ');
          inputRef.current?.focus();
        },
      },
      { label: 'Scaffold Last', action: () => executeCommand('/scaffold') },
      {
        label: autoScaffoldOnBuild ? 'Auto-Scaffold: ON' : 'Auto-Scaffold: OFF',
        action: () => executeCommand('/scaffold auto'),
      },
      {
        label: 'Spin Server',
        action: () => {
          setInputVal('/serve ');
          inputRef.current?.focus();
        },
      },
      { label: 'Servers', action: () => executeCommand('/serve list') },
      { label: 'Create .venv', action: () => handleCreateVenv() },
      {
        label: autoRunShell ? 'Auto-Run: ON' : 'Auto-Run: OFF',
        action: () => toggleAutoRunShell(),
      },
      { label: 'Switch to Shell ($)', action: () => setCliMode('shell') },
      { label: 'Zero Refusal (λ=0)', action: () => executeCommand('/lambda 0') },
      {
        label: 'Explain λ-Orthogonalization',
        action: () =>
          sendAiChat(
            'Explain how refusal orthogonalization removes alignment tax without retraining weights.',
          ),
      },
      { label: 'Cluster Telemetry', action: () => executeCommand('/stats') },
      { label: 'Connected Models', action: () => executeCommand('/models') },
    ];
  }, [cliMode, autoRunShell, autoScaffoldOnBuild, handleCreateVenv, toggleAutoRunShell, executeCommand]);

  return (
    <div
      className={cn(
        'relative flex flex-col w-full h-full font-mono overflow-hidden select-text transition-colors duration-300',
        fullscreen ? 'fixed inset-0 z-[100]' : '',
      )}
      style={{
        backgroundColor: curPal.bg,
        color: curPal.text,
      }}
    >
      {/* Background Matrix Rain (Subtle Katakana & ASCII streams) */}
      {rainEnabled && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-none opacity-25 z-0"
        />
      )}

      {/* Background Terminal ASCII Skull Backdrop (Blue Theme) */}
      {skullEnabled && (
        <div
          className="pointer-events-none absolute inset-0 z-0 bg-no-repeat transition-opacity duration-500"
          style={{
            backgroundImage: "url('/terminal-ascii-skull.png')",
            backgroundPosition: 'center 32%',
            backgroundSize: 'min(560px, 65%)',
            opacity: 0.16,
            filter: 'drop-shadow(0 0 24px rgba(0, 229, 255, 0.25))',
          }}
          aria-hidden="true"
        />
      )}

      {/* Top Header */}
      <header
        className="relative z-10 flex items-center justify-between gap-2 px-4 py-2 border-b backdrop-blur-md"
        style={{
          borderColor: curPal.line,
          backgroundColor: curPal.panel,
        }}
      >
        {/* Left: Branding & Mode Selector */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'w-2 h-2 rounded-full',
                bridgeState === 'connected' ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse',
              )}
            />
            <span
              className="font-bold tracking-widest text-xs uppercase select-none"
              style={{ color: curPal.neon }}
            >
              ABLITERATED CLI
            </span>
          </div>

          <div
            className="flex items-center p-0.5 rounded border text-[11px]"
            style={{ borderColor: curPal.line2, backgroundColor: curPal.panel2 }}
          >
            <button
              type="button"
              onClick={() => setCliMode('ai')}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors font-medium',
                cliMode === 'ai' ? 'font-bold' : 'opacity-70 hover:opacity-100',
              )}
              style={{
                backgroundColor: cliMode === 'ai' ? curPal.accentBg : 'transparent',
                color: cliMode === 'ai' ? curPal.neon : curPal.dim,
              }}
            >
              <Bot size={13} />
              AI CHAT
            </button>
            <button
              type="button"
              onClick={() => setCliMode('shell')}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors font-medium',
                cliMode === 'shell' ? 'font-bold' : 'opacity-70 hover:opacity-100',
              )}
              style={{
                backgroundColor: cliMode === 'shell' ? curPal.accentBg : 'transparent',
                color: cliMode === 'shell' ? curPal.neon : curPal.dim,
              }}
            >
              <TerminalIcon size={13} />
              SHELL
            </button>
          </div>
        </div>

        {/* Center: Directory & Model Status */}
        <div className="hidden md:flex items-center gap-2 text-[11px] truncate">
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border truncate"
            style={{ borderColor: curPal.line, color: curPal.dim }}
            title={`Working Directory: ${activeRoot || 'Project Base'}`}
          >
            <Folder size={12} style={{ color: curPal.neon }} />
            <span className="font-bold truncate" style={{ color: curPal.text }}>
              {shortRoot}
            </span>
          </div>

          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border truncate max-w-xs"
            style={{ borderColor: curPal.line, color: curPal.dim }}
            title={`Active Model: ${activeEndpoint.defaultModel}`}
          >
            <Radio size={12} style={{ color: curPal.neon }} />
            <span className="font-bold truncate" style={{ color: curPal.neon }}>
              {activeEndpoint.defaultModel}
            </span>
          </div>
        </div>

        {/* Right: Actions & Options */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Download All Session Files as ZIP (if files exist) */}
          {allSessionFiles.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const dateStr = new Date().toISOString().slice(0, 10);
                downloadFilesAsZip(`abliterated-session-files-${dateStr}`, allSessionFiles);
                showToast(`[ EXPORTED ZIP: ${allSessionFiles.length} FILES ]`);
              }}
              title={`Download all ${allSessionFiles.length} generated files as a ZIP archive`}
              className="flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold tracking-wider transition-all hover:scale-105"
              style={{
                borderColor: curPal.line2,
                color: curPal.neon,
                backgroundColor: curPal.accentBg,
              }}
            >
              <Download size={12} />
              <span className="hidden md:inline">ZIP ({allSessionFiles.length})</span>
            </button>
          )}

          {/* Options Drawer Toggle */}
          <button
            type="button"
            onClick={() => setShowControls((v) => !v)}
            title="Toggle settings & options panel"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border text-[11px] font-medium transition-all hover:scale-105"
            style={{
              borderColor: showControls ? curPal.neon : curPal.line,
              backgroundColor: showControls ? curPal.accentBg : 'transparent',
              color: showControls ? curPal.neon : curPal.dim,
            }}
          >
            <Sliders size={12} />
            <span>Options</span>
            {autoRunShell && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Auto-run shell active" />
            )}
          </button>

          {/* Clear Buffer */}
          <button
            type="button"
            onClick={() => executeCommand('clear')}
            title="Clear terminal buffer"
            className="p-1.5 rounded border transition-colors hover:text-red-400"
            style={{ borderColor: curPal.line, color: curPal.dim }}
          >
            <Trash2 size={13} />
          </button>

          {/* Fullscreen */}
          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
            title="Toggle fullscreen"
            className="p-1.5 rounded border transition-colors"
            style={{ borderColor: curPal.line, color: curPal.dim }}
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </header>

      {/* Expandable Options Drawer */}
      {showControls && (
        <div
          className="relative z-10 flex flex-col gap-2.5 px-4 py-2.5 border-b text-xs animate-in fade-in slide-from-top-1"
          style={{
            borderColor: curPal.line,
            backgroundColor: curPal.panel,
          }}
        >
          {/* Row 1: Refusal Lambda Slider */}
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <span className="text-[11px] font-bold whitespace-nowrap" style={{ color: curPal.neon }}>
              Refusal (λ):
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={lambda}
              onChange={(e) => setLambda(parseFloat(e.target.value))}
              className="flex-1 h-1 rounded appearance-none cursor-pointer accent-current"
              style={{ accentColor: curPal.neon }}
            />
            <span className="font-mono text-[11px] font-bold w-10" style={{ color: curPal.neon }}>
              {lambda.toFixed(2)}
            </span>
            <button
              type="button"
              onClick={() => setLambda(0.0)}
              className="px-1.5 py-0.5 rounded border text-[10px] uppercase font-bold transition-colors"
              style={{
                borderColor: curPal.line,
                backgroundColor: lambda === 0 ? curPal.accentBg : 'transparent',
                color: curPal.neon,
              }}
            >
              Zeroed
            </button>
          </div>

          {/* Row 2: Secondary Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Auto-Run Toggle */}
            <button
              type="button"
              onClick={() => toggleAutoRunShell()}
              title="Toggle Auto-Run Shell: when active, AI-generated shell commands run automatically"
              className="flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] font-bold transition-all"
              style={{
                borderColor: autoRunShell ? '#f59e0b' : curPal.line,
                backgroundColor: autoRunShell ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                color: autoRunShell ? '#fbbf24' : curPal.dim,
              }}
            >
              <Play
                size={11}
                className={autoRunShell ? 'fill-amber-400 text-amber-400 animate-pulse' : ''}
              />
              <span>AUTO-RUN:</span>
              <span>{autoRunShell ? 'ON' : 'OFF'}</span>
            </button>

            {/* Create .venv Button */}
            <button
              type="button"
              onClick={handleCreateVenv}
              disabled={isExecutingCmd || isStreaming}
              title="Initialize Python virtual environment (.venv) in workspace root"
              className="flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold tracking-wider transition-colors disabled:opacity-50"
              style={{
                borderColor: curPal.line,
                color: curPal.neon,
                backgroundColor: curPal.panel2,
              }}
            >
              <TerminalIcon size={12} style={{ color: curPal.neon }} />
              <span>CREATE .VENV</span>
            </button>

            {/* Grounding: No Hallucination */}
            <div
              className="flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-bold uppercase tracking-wider select-none"
              style={{
                borderColor: curPal.line,
                backgroundColor: curPal.panel2,
                color: curPal.neon,
              }}
              title="Anti-Hallucination & Live Web Grounding active"
            >
              <ShieldCheck size={11} style={{ color: curPal.neon }} />
              <span>NO HALLUCINATION</span>
            </div>

            {/* Thoughts visibility */}
            <button
              type="button"
              onClick={() => setThoughtsVisible((v) => !v)}
              className="px-2 py-1 rounded border text-[11px] font-bold transition-colors"
              style={{
                borderColor: curPal.line,
                color: thoughtsVisible ? curPal.neon : curPal.dim,
                backgroundColor: thoughtsVisible ? curPal.accentBg : 'transparent',
              }}
              title="Toggle thoughts trace expansion"
            >
              Thoughts: {thoughtsVisible ? 'Show' : 'Hide'}
            </button>

            {/* Matrix Digital Rain */}
            <button
              type="button"
              onClick={() => setRainEnabled((s) => !s)}
              className="px-2 py-1 rounded border text-[11px] font-bold transition-colors"
              style={{
                borderColor: curPal.line,
                color: rainEnabled ? curPal.neon : curPal.dim,
                backgroundColor: rainEnabled ? curPal.accentBg : 'transparent',
              }}
              title="Toggle Matrix digital rain background canvas"
            >
              Rain: {rainEnabled ? 'On' : 'Off'}
            </button>

            {/* Terminal ASCII Skull Backdrop */}
            <button
              type="button"
              onClick={() => setSkullEnabled((s) => !s)}
              className="px-2 py-1 rounded border text-[11px] font-bold transition-colors"
              style={{
                borderColor: curPal.line,
                color: skullEnabled ? curPal.neon : curPal.dim,
                backgroundColor: skullEnabled ? curPal.accentBg : 'transparent',
              }}
              title="Toggle terminal ASCII skull background"
            >
              Skull: {skullEnabled ? 'On' : 'Off'}
            </button>

            {/* Bridge Reconnect */}
            {bridgeState !== 'connected' && (
              <button
                type="button"
                onClick={() => {
                  bridge.reconnect();
                  showToast('[ BRIDGE: RECONNECTING ]');
                }}
                className="px-2 py-1 rounded border text-[11px] font-bold uppercase text-amber-400 border-amber-400/40 hover:bg-amber-400/10"
              >
                Reconnect Bridge
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Terminal Viewport */}
      <main
        ref={scrollRef}
        className="relative z-10 flex-1 overflow-y-auto px-4 py-4 space-y-4 text-xs leading-relaxed"
      >
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          const isSystem = msg.role === 'system';

          if (isSystem) {
            return (
              <div
                key={msg.id}
                className="py-1 px-1 font-mono text-[11px] whitespace-pre-wrap leading-relaxed opacity-70 border-b pb-2 mb-1"
                style={{
                  borderColor: curPal.line,
                  color: curPal.dim,
                }}
              >
                {msg.content}
              </div>
            );
          }

          // User Command or Chat Bubble
          if (isUser) {
            return (
              <div key={msg.id} className="flex items-baseline gap-2 py-1">
                <span className="font-bold select-none shrink-0 text-xs font-mono" style={{ color: curPal.neon }}>
                  {msg.isShell ? `$ ` : `> `}
                </span>
                <span
                  className="font-mono text-xs whitespace-pre-wrap leading-relaxed flex-1 break-all"
                  style={{ color: curPal.text }}
                >
                  {msg.isShell ? (msg.shellCommand || msg.content) : msg.content}
                </span>
                {!msg.isShell && msg.intent && (
                  <span
                    className="text-[9px] font-bold uppercase tracking-wider shrink-0 select-none font-mono px-1.5 py-0.5 rounded border"
                    style={{ borderColor: curPal.line, color: curPal.dim, backgroundColor: curPal.panel2 }}
                    title={`Interpreted as a "${CLI_INTENT_META[msg.intent].label}" turn`}
                  >
                    {CLI_INTENT_META[msg.intent].glyph} {CLI_INTENT_META[msg.intent].label}
                  </span>
                )}
                <span className="text-[10px] opacity-35 shrink-0 select-none font-mono">
                  {msg.timestamp}
                </span>
              </div>
            );
          }

          // Shell Execution Output Card
          if (msg.isShell) {
            const isFailed = msg.exitCode !== null && msg.exitCode !== 0;
            return (
              <div
                key={msg.id}
                className="rounded border text-[12px] overflow-hidden shadow-lg transition-all"
                style={{
                  borderColor: isFailed
                    ? 'rgba(239, 68, 68, 0.4)'
                    : msg.isRunning
                      ? curPal.line2
                      : curPal.line,
                  backgroundColor: 'rgba(2, 6, 12, 0.95)',
                }}
              >
                {/* Shell Output Header */}
                <div
                  className="flex items-center justify-between gap-2 px-3 py-1.5 border-b text-[10px]"
                  style={{
                    borderColor: isFailed ? 'rgba(239, 68, 68, 0.3)' : curPal.line,
                    backgroundColor: isFailed ? 'rgba(239, 68, 68, 0.08)' : curPal.panel2,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <TerminalIcon
                      size={12}
                      style={{ color: isFailed ? '#ef4444' : curPal.neon }}
                    />
                    <span className="font-bold" style={{ color: curPal.text }}>
                      $ {msg.shellCommand}
                    </span>
                    {msg.executionTime != null && (
                      <span className="opacity-70">({msg.executionTime}s)</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {msg.isRunning ? (
                      <span
                        className="flex items-center gap-1 font-bold text-[10px] animate-pulse"
                        style={{ color: curPal.neon }}
                      >
                        <RefreshCw size={10} className="animate-spin" />
                        RUNNING...
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'px-1.5 py-0.5 rounded font-bold text-[9px]',
                          isFailed
                            ? 'bg-red-950/80 text-red-400 border border-red-800'
                            : 'text-emerald-400',
                        )}
                      >
                        {msg.exitCode != null ? `EXIT ${msg.exitCode}` : 'DONE'}
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => copyCode(msg.content, msg.id)}
                      className="hover:text-white transition-colors"
                      title="Copy output"
                    >
                      {copiedKey === msg.id ? <Check size={11} /> : <Copy size={11} />}
                    </button>
                  </div>
                </div>

                {/* Shell Output Body */}
                <div
                  className="p-3 font-mono text-[11px] whitespace-pre-wrap break-all overflow-x-auto max-h-96"
                  style={{ color: isFailed ? '#fca5a5' : curPal.text }}
                >
                  {msg.content ||
                    (msg.isRunning ? (
                      <span className="flex items-center gap-1.5 opacity-70">
                        <RefreshCw size={11} className="animate-spin" />
                        Executing command in {shortRoot}...
                      </span>
                    ) : (
                      '[No output produced]'
                    ))}
                </div>

                {/* Shell Failure Actions / Explain with AI */}
                {isFailed && !msg.isRunning && (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t text-[11px]"
                    style={{
                      borderColor: 'rgba(239, 68, 68, 0.25)',
                      backgroundColor: 'rgba(239, 68, 68, 0.05)',
                    }}
                  >
                    <div className="flex items-center gap-1.5 text-red-400 font-medium">
                      <AlertCircle size={13} className="shrink-0" />
                      <span>Process exited with error code {msg.exitCode}.</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => executeShellCommand(msg.shellCommand || '')}
                        disabled={isExecutingCmd}
                        className="flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-bold uppercase transition-all hover:scale-105 disabled:opacity-50"
                        style={{ borderColor: curPal.line, color: curPal.text }}
                      >
                        <RotateCcw size={10} />
                        RERUN
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleExplainFailure(
                            msg.shellCommand || '',
                            msg.exitCode ?? null,
                            msg.content,
                          )
                        }
                        disabled={isStreaming}
                        className="flex items-center gap-1 px-2.5 py-1 rounded border text-[10px] font-bold uppercase transition-all hover:scale-105 disabled:opacity-50"
                        style={{
                          borderColor: curPal.line2,
                          backgroundColor: curPal.accentBg,
                          color: curPal.neon,
                        }}
                      >
                        <Sparkles size={11} />
                        Explain & Fix with AI
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          }

          // Assistant AI Message Presentation
          const rawReasoning = msg.reasoning || '';
          const rawContent = msg.content || '';

          const cleanReasoning = stripThinkingWrappers(rawReasoning);
          const cleanContent = rawContent;

          const hasContentText = Boolean(cleanContent.trim());
          const hasReasoningText = Boolean(cleanReasoning.trim());

          // Show the "thinking" box whenever reasoning exists: live while streaming
          // (so the minimal thought process is visible during the response), and
          // afterwards only when it is distinct from the final answer.
          const showSeparateThoughtBox =
            hasReasoningText &&
            (Boolean(msg.isStreaming) || (hasContentText && cleanReasoning !== cleanContent.trim()));

          // Keep reasoning in the thinking box, not the answer body, while streaming.
          // On a finished turn with no content, fall back to showing the reasoning.
          const mainAnswer = hasContentText
            ? cleanContent
            : msg.isStreaming
              ? ''
              : cleanReasoning;
          const isExpanded = reasoningExpanded[msg.id] ?? thoughtsVisible;
          const parsedBlocks = parseContentBlocks(mainAnswer || '');
          const messageFiles = extractFilesFromMarkdown(mainAnswer || '');

          return (
            <div key={msg.id} className="space-y-1.5 pt-1">
              <div
                className="flex items-center justify-between gap-2 text-[10px]"
                style={{ color: curPal.dim }}
              >
                <div className="flex items-center gap-1.5">
                  <Bot size={12} style={{ color: curPal.neon }} />
                  <span className="font-bold text-[11px]" style={{ color: curPal.neon }}>
                    AI
                  </span>
                  <span className="opacity-60 text-[10px]">[{activeEndpoint.defaultModel}]</span>
                  <span className="opacity-40">[{msg.timestamp}]</span>
                  {msg.isStreaming && (
                    <span
                      className="px-1.5 py-0.2 rounded border text-[9px] font-bold tracking-wider animate-pulse"
                      style={{ borderColor: curPal.line2, color: curPal.neon }}
                    >
                      STREAMING...
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {messageFiles.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        const dateStr = new Date().toISOString().slice(0, 10);
                        downloadFilesAsZip(`abliterated-response-files-${dateStr}`, messageFiles);
                        showToast(`[ DOWNLOADED ZIP: ${messageFiles.length} FILES ]`);
                      }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold uppercase transition-all hover:scale-105"
                      style={{
                        borderColor: curPal.line2,
                        backgroundColor: curPal.accentBg,
                        color: curPal.neon,
                      }}
                      title={`Download all ${messageFiles.length} files as a ZIP archive`}
                    >
                      <Download size={10} />
                      <span>ZIP ({messageFiles.length})</span>
                    </button>
                  ) : messageFiles.length === 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        downloadSingleFile(messageFiles[0].name, messageFiles[0].content as string);
                        showToast(`[ DOWNLOADED: ${messageFiles[0].name.split('/').pop()} ]`);
                      }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold uppercase transition-all hover:scale-105"
                      style={{
                        borderColor: curPal.line2,
                        backgroundColor: curPal.accentBg,
                        color: curPal.neon,
                      }}
                      title={`Download ${messageFiles[0].name}`}
                    >
                      <Download size={10} />
                      <span>DOWNLOAD</span>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={() => copyCode(mainAnswer || rawContent, msg.id)}
                    className="flex items-center gap-1 hover:text-white transition-colors"
                    title="Copy response"
                  >
                    {copiedKey === msg.id ? <Check size={11} /> : <Copy size={11} />}
                    <span>{copiedKey === msg.id ? 'COPIED' : 'COPY'}</span>
                  </button>
                </div>
              </div>

              {/* Separate Thought Trace Block */}
              {showSeparateThoughtBox && (
                <div
                  className="rounded border text-[11px] overflow-hidden"
                  style={{
                    borderColor: curPal.line,
                    backgroundColor: 'rgba(0,0,0,0.35)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => toggleReasoning(msg.id)}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 text-left font-bold opacity-80 hover:opacity-100 transition-opacity"
                    style={{ color: curPal.dim }}
                  >
                    <span className="flex items-center gap-1.5 lowercase">
                      <Brain size={11} style={{ color: curPal.neon }} />
                      {msg.isStreaming && !hasContentText ? 'thinking…' : 'thinking'}
                    </span>
                    {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  {isExpanded && (
                    <div
                      className="px-3 py-2 border-t font-mono text-[11px] whitespace-pre-wrap opacity-90 max-h-60 overflow-y-auto"
                      style={{ borderColor: curPal.line, color: curPal.dim }}
                    >
                      {cleanReasoning}
                    </div>
                  )}
                </div>
              )}

              {/* Response Content with Syntax & Code Block Execution */}
              <div
                className="px-3 py-2 rounded border text-[12px] leading-relaxed space-y-2.5"
                style={{
                  borderColor: curPal.line,
                  backgroundColor: curPal.panel,
                  color: curPal.text,
                }}
              >
                {parsedBlocks.map((block, bIdx) => {
                  if (block.type === 'text') {
                    const { body, summary } = splitSummaryFromText(block.content);
                    return (
                      <div key={bIdx} className="space-y-2">
                        {body ? (
                          <div className="whitespace-pre-wrap break-words leading-relaxed">
                            {body}
                          </div>
                        ) : null}
                        {summary ? (
                          <div
                            className="p-3 rounded border text-[11px] leading-relaxed shadow-sm my-2 animate-in fade-in"
                            style={{
                              borderColor: curPal.line2,
                              backgroundColor: curPal.panel2,
                            }}
                          >
                            <div
                              className="flex items-center gap-1.5 font-bold uppercase tracking-wider mb-2"
                              style={{ color: curPal.neon }}
                            >
                              <CheckCircle2 size={13} style={{ color: curPal.neon }} />
                              <span>Response Summary</span>
                            </div>
                            <div className="space-y-1 pl-1 text-[11px] opacity-90" style={{ color: curPal.text }}>
                              {summary.split(/\n+/).map((line, lIdx) => {
                                const cleanLine = line.replace(/^[-*•\d.]+\s*/, '').trim();
                                if (!cleanLine) return null;
                                return (
                                  <div key={lIdx} className="flex items-start gap-2">
                                    <span
                                      className="inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                                      style={{ backgroundColor: curPal.neon }}
                                    />
                                    <span>{cleanLine}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  }

                  const isShellCode = /^(bash|sh|shell|zsh|console|terminal)$/i.test(
                    block.language || '',
                  );
                  const { filename: blockFilename, cleanContent: blockCleanContent } =
                    detectFilenameAndContent(block.content, block.language, bIdx);

                  return (
                    <div
                      key={bIdx}
                      className="rounded border overflow-hidden my-2 shadow-inner"
                      style={{
                        borderColor: curPal.line,
                        backgroundColor: 'rgba(0, 0, 0, 0.45)',
                      }}
                    >
                      {/* Code Block Header */}
                      <div
                        className="flex items-center justify-between px-3 py-1.5 border-b text-[10px]"
                        style={{
                          borderColor: curPal.line,
                          backgroundColor: curPal.panel2,
                        }}
                      >
                        <span
                          className="font-bold tracking-wider font-mono"
                          style={{ color: curPal.neon }}
                        >
                          {blockFilename || block.language || 'CODE'}
                        </span>

                        <div className="flex items-center gap-2">
                          {isShellCode && (
                            <button
                              type="button"
                              onClick={() => executeShellCommand(block.content.trim())}
                              disabled={isExecutingCmd}
                              className="flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold uppercase transition-all hover:scale-105 disabled:opacity-50"
                              style={{
                                borderColor: curPal.line2,
                                backgroundColor: curPal.accentBg,
                                color: curPal.neon,
                              }}
                              title="Run snippet directly in shell environment"
                            >
                              <Play size={10} />
                              RUN IN SHELL
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              downloadSingleFile(blockFilename, blockCleanContent);
                              showToast(`[ DOWNLOADED: ${blockFilename.split('/').pop()} ]`);
                            }}
                            className="flex items-center gap-1 hover:text-white transition-colors"
                            title={`Download ${blockFilename}`}
                          >
                            <Download size={10} />
                            <span>DOWNLOAD</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => copyCode(block.content, `${msg.id}-${bIdx}`)}
                            className="flex items-center gap-1 hover:text-white transition-colors"
                            title="Copy code block"
                          >
                            {copiedKey === `${msg.id}-${bIdx}` ? (
                              <Check size={11} />
                            ) : (
                              <Copy size={11} />
                            )}
                            <span>
                              {copiedKey === `${msg.id}-${bIdx}` ? 'COPIED' : 'COPY'}
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* Code Block Content */}
                      <pre className="p-3 font-mono text-[11px] overflow-x-auto whitespace-pre">
                        <code>{block.content}</code>
                      </pre>
                    </div>
                  );
                })}

                {msg.isStreaming && (
                  <span
                    className="inline-block w-2 h-4 ml-1 align-middle animate-pulse"
                    style={{ backgroundColor: curPal.neon }}
                  />
                )}

                {/* Token Limit Truncation Banner with One-Click Continuation */}
                {msg.truncated && !msg.isStreaming && (
                  <div
                    className="mt-3 flex flex-wrap items-center justify-between gap-3 p-2.5 rounded border text-xs animate-in fade-in"
                    style={{
                      borderColor: 'rgba(245, 158, 11, 0.45)',
                      backgroundColor: 'rgba(245, 158, 11, 0.09)',
                    }}
                  >
                    <div className="flex items-center gap-2 text-amber-300 font-medium text-[11px]">
                      <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                      <span>Output reached model token limit (truncated).</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleContinue(msg.id)}
                      disabled={isStreaming || isExecutingCmd}
                      className="flex items-center gap-1.5 px-3 py-1 rounded border text-[11px] font-bold uppercase transition-all hover:scale-105 disabled:opacity-50"
                      style={{
                        borderColor: curPal.line2,
                        backgroundColor: curPal.accentBg,
                        color: curPal.neon,
                      }}
                    >
                      <Zap size={12} />
                      <span>Continue Generating</span>
                    </button>
                  </div>
                )}

                {/* 3 Prompt Suggestions after each completed AI response */}
                {!msg.isStreaming && mainAnswer.trim() ? (
                  (() => {
                    // Context so suggestions relate to THIS response: the turn's
                    // intent, the question it answered, and any files it produced.
                    const myIdx = messages.findIndex((m) => m.id === msg.id);
                    const priorUser =
                      myIdx > 0
                        ? [...messages.slice(0, myIdx)]
                            .reverse()
                            .find((m) => m.role === 'user' && !m.isShell)
                        : undefined;
                    const suggestions = getPromptSuggestions(mainAnswer, {
                      mode: priorUser?.intent,
                      userPrompt: priorUser?.content || '',
                      files: messageFiles.map((f) => ({ path: f.name })),
                    });
                    return (
                      <div
                        className="mt-2.5 pt-2 border-t flex flex-col gap-1.5"
                        style={{ borderColor: curPal.line }}
                      >
                        <div
                          className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider font-mono"
                          style={{ color: curPal.dim }}
                        >
                          <span className="flex items-center gap-1.5">
                            <Sparkles size={11} style={{ color: curPal.neon }} />
                            PROMPT SUGGESTIONS
                          </span>
                          <span className="opacity-50 text-[9px] lowercase font-normal">
                            click to send · edit to tweak
                          </span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {suggestions.map((sug, sIdx) => (
                            <div
                              key={sIdx}
                              className="group flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border text-[11px] font-mono transition-all"
                              style={{
                                borderColor: curPal.line,
                                backgroundColor: curPal.panel2,
                                color: curPal.text,
                              }}
                            >
                              <button
                                type="button"
                                disabled={isStreaming || isExecutingCmd}
                                onClick={() => void sendAiChat(sug)}
                                className="flex-1 text-left flex items-start gap-1.5 hover:underline transition-colors focus-visible:outline-none"
                                title={`Send: "${sug}"`}
                              >
                                <span
                                  className="font-bold shrink-0"
                                  style={{ color: curPal.neon }}
                                >
                                  [{sIdx + 1}]
                                </span>
                                <span className="break-words">{sug}</span>
                              </button>
                              <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setInputVal(sug);
                                    inputRef.current?.focus();
                                  }}
                                  className="p-1 rounded hover:bg-white/10 transition-colors"
                                  title="Edit in prompt input"
                                >
                                  <CornerDownLeft size={11} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => copyCode(sug, `sug-${msg.id}-${sIdx}`)}
                                  className="p-1 rounded hover:bg-white/10 transition-colors"
                                  title="Copy prompt"
                                >
                                  {copiedKey === `sug-${msg.id}-${sIdx}` ? (
                                    <Check size={11} className="text-emerald-400" />
                                  ) : (
                                    <Copy size={11} />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  disabled={isStreaming || isExecutingCmd}
                                  onClick={() => void sendAiChat(sug)}
                                  className="p-1 rounded hover:bg-white/10 transition-colors"
                                  style={{ color: curPal.neon }}
                                  title="Send now"
                                >
                                  <ArrowRight size={11} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()
                ) : null}
              </div>
            </div>
          );
        })}
      </main>

      {/* Collapsible Quick Suggestions */}
      {showQuickPrompts && (
        <div
          className="relative z-10 flex items-center gap-1.5 px-4 py-1.5 border-t overflow-x-auto no-scrollbar animate-in fade-in slide-from-bottom-1"
          style={{
            borderColor: curPal.line,
            backgroundColor: curPal.panel,
          }}
        >
          <span
            className="text-[10px] font-bold uppercase shrink-0"
            style={{ color: curPal.dim }}
          >
            {cliMode === 'shell' ? 'SHELL:' : 'AI:'}
          </span>
          {quickPrompts.map((qp, idx) => (
            <button
              key={idx}
              type="button"
              onClick={qp.action}
              disabled={isStreaming || isExecutingCmd || isScaffolding}
              className="shrink-0 px-2.5 py-0.5 rounded border text-[10px] transition-all hover:scale-[1.02] disabled:opacity-50"
              style={{
                borderColor: curPal.line,
                color: curPal.text,
                backgroundColor: curPal.panel2,
              }}
            >
              {qp.label}
            </button>
          ))}
        </div>
      )}

      {/* Terminal Input Bar */}
      <footer
        className="relative z-10 p-3 border-t backdrop-blur-md"
        style={{
          borderColor: curPal.line2,
          backgroundColor: curPal.panel,
        }}
      >
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <div
            className="relative flex-1 flex items-center rounded border px-3 py-2 transition-colors focus-within:border-current"
            style={{
              borderColor: curPal.line2,
              backgroundColor: curPal.bg,
            }}
          >
            <span
              className="font-bold text-xs mr-2 shrink-0 select-none"
              style={{ color: curPal.neon }}
            >
              {cliMode === 'shell' ? `guest@abliterated:${shortRoot}$ ` : '> '}
            </span>
            <textarea
              ref={inputRef}
              rows={1}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                cliMode === 'shell'
                  ? `Enter shell command in ${shortRoot} (e.g. ls, git status, cd, npm test), or "? <query>" for AI...`
                  : 'Type prompt, or prefix with "$ <cmd>" for shell, or "continue" to resume truncated output...'
              }
              className="flex-1 bg-transparent resize-none outline-none font-mono text-xs placeholder:opacity-40"
              style={{
                color: curPal.text,
              }}
            />
          </div>

          {isStreaming || isExecutingCmd || isScaffolding ? (
            <button
              type="button"
              onClick={() => {
                abortCtrlRef.current?.abort();
                setIsStreaming(false);
                setIsExecutingCmd(false);
                setIsScaffolding(false);
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded border text-xs font-bold tracking-wider uppercase transition-colors bg-red-950/60 border-red-500 text-red-300 hover:bg-red-900/80 animate-pulse shrink-0"
            >
              <Square size={13} />
              STOP
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputVal.trim()}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded border text-xs font-bold tracking-wider uppercase transition-all disabled:opacity-40 hover:scale-105 shrink-0"
              style={{
                borderColor: curPal.line2,
                backgroundColor: curPal.accentBg,
                color: curPal.neon,
              }}
            >
              <Send size={13} />
              {cliMode === 'shell' ? 'RUN' : 'SEND'}
            </button>
          )}
        </form>

        {/* Simplified Status Line */}
        <div
          className="flex items-center justify-between mt-2 text-[10px] tracking-wide"
          style={{ color: curPal.dim }}
        >
          <div className="flex items-center gap-3">
            <span className="font-medium">
              {cliMode === 'shell' ? 'Shell' : 'AI Assistant'} ·{' '}
              <span style={{ color: curPal.text }}>{shortRoot}</span>
            </span>
            <button
              type="button"
              onClick={() => setShowQuickPrompts((v) => !v)}
              className="flex items-center gap-1 font-medium hover:underline opacity-80 hover:opacity-100 transition-opacity"
              style={{ color: curPal.neon }}
            >
              <Sparkles size={11} />
              <span>{showQuickPrompts ? 'Hide Shortcuts' : 'Quick Shortcuts'}</span>
              {showQuickPrompts ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
            </button>
          </div>

          <div className="hidden sm:flex items-center gap-3 opacity-70 text-[10px]">
            <span>↵ {cliMode === 'shell' ? 'Run' : 'Send'}</span>
            <span>⇧↵ Newline</span>
            <span>$ Shell escape</span>
          </div>
        </div>
      </footer>

      {/* Floating Toast Notification */}
      {toastMsg && (
        <div
          className="absolute bottom-20 right-6 z-50 px-3 py-1.5 text-[11px] font-bold tracking-widest uppercase rounded border backdrop-blur-md shadow-2xl animate-in fade-in slide-in-from-bottom-2"
          style={{
            borderColor: curPal.line2,
            backgroundColor: curPal.panel,
            color: curPal.neon,
          }}
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}
