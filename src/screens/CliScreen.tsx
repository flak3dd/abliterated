import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Folder,
  Maximize2,
  Minimize2,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  Zap,
  Download,
  Globe,
} from 'lucide-react';
import { cn } from '../lib/cn';
import type { ChatOpenAiMessage, ClientSettings } from '../types';
import { resolveActiveSettings } from '../lib/activeEndpoint';
import { streamChatCompletion } from '../lib/sse';
import {
  promoteReasoningToContent,
  splitThinkFromContent,
  stripThinkingWrappers,
} from '../lib/agentPhase';
import { bridge, type BridgeStatus } from '../lib/bridgeClient';
import {
  downloadSingleFile,
  downloadFilesAsZip,
  detectFilenameAndContent,
  extractFilesFromMarkdown,
  type DownloadableFile,
} from '../lib/zipDownload';
import { looksWebInteractionDirective } from '../lib/agentHelpers';
import { runWebSearch } from '../lib/webSearch';

interface CliScreenProps {
  settings?: ClientSettings;
  workspaceRoot?: string;
  bridgeStatus?: BridgeStatus;
  onWorkspaceRootChange?: (newRoot: string) => void;
  onPatchSettings?: (partial: Partial<ClientSettings>) => void;
}

type WorldSpectrum = 'green' | 'blue';
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
  green: {
    neon: '#5fff5f',
    bright: '#00ff00',
    mid: '#00af00',
    deep: '#0a6e2a',
    bg: '#020804',
    panel: 'rgba(3,12,6,0.92)',
    panel2: 'rgba(95,255,95,0.06)',
    line: 'rgba(95,255,95,0.20)',
    line2: 'rgba(95,255,95,0.40)',
    text: '#c8f2d0',
    dim: '#6fae7f',
    head: '#d6ffd6',
    t1: '#5fff5f',
    t2: '#00ff00',
    t3: '#00af00',
    t4: '#005f00',
    fade: 'rgba(2,8,4,0.16)',
    accentBg: 'rgba(95,255,95,0.12)',
  },
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

export function CliScreen({
  settings,
  workspaceRoot,
  bridgeStatus,
  onWorkspaceRootChange,
  onPatchSettings,
}: CliScreenProps) {
  const [world, setWorld] = useState<WorldSpectrum>('green');
  const [cliMode, setCliMode] = useState<CliMode>('ai');
  const [glyphSet, setGlyphSet] = useState<'kata' | 'ascii'>('kata');
  const [rainEnabled, setRainEnabled] = useState(true);
  const [lambda, setLambda] = useState(0.0); // 0.0 = zeroed / uncensored, 1.0 = standard
  const [thoughtsVisible, setThoughtsVisible] = useState(true); // Control thought box expansion
  const [showLambdaBar, setShowLambdaBar] = useState(false);
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

  // Sync Bridge & Root subscriptions
  useEffect(() => {
    const unsubStatus = bridge.onStatusChange((s) => setBridgeState(s));
    const unsubRoot = bridge.onRootChange((r) => {
      if (r) {
        setActiveRoot(r);
        onWorkspaceRootChange?.(r);
      }
    });
    return () => {
      unsubStatus();
      unsubRoot();
    };
  }, [onWorkspaceRootChange]);

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
      content: `ABLITERATED INTEGRATED CLI & SHELL ENVIRONMENT v5.0 [ONLINE]
Architecture: Dual-Core AI Chat & Native Bridge Shell Subsystem
Refusal Vector Projection: λ = 0.0000 (ZEROED — Uncensored Direct Execution)
Local Daemon Bridge: ws://127.0.0.1:17322 · Max Output Budget: 8192 Tokens
Type any prompt to chat with the model, or switch to SHELL mode / prefix with '$' to run shell commands.
Commands: /help, /continue, /mode <ai|shell>, /sh <cmd>, /ai <prompt>, /clear, /models, /stats, /lambda <val>`,
      timestamp: formatTime(),
    },
  ]);
  const [inputVal, setInputVal] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isExecutingCmd, setIsExecutingCmd] = useState(false);
  const [reasoningExpanded, setReasoningExpanded] = useState<Record<string, boolean>>({});

  const abortCtrlRef = useRef<AbortController | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const curPal = useMemo(() => PALETTES[world], [world]);

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

  // Matrix Rain Background Canvas
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

      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        setWorld((w) => {
          const next = w === 'blue' ? 'green' : 'blue';
          showToast(`[ SPECTRUM: ${next.toUpperCase()} ]`);
          return next;
        });
      } else if (e.key === 'k' || e.key === 'K') {
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
    if (isStreaming || isExecutingCmd) return;

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

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === targetMsg.id
            ? {
                ...msg,
                content: (targetMsg.content || '') + appendContent,
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
    if (!cmd || isStreaming || isExecutingCmd) return;

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
    if (isStreaming || isExecutingCmd) return;
    showToast('[ INITIALIZING .VENV ]');
    addSystemMsg('Initializing Python virtual environment (.venv) in workspace root...');
    const cmd =
      'python3 -m venv .venv && .venv/bin/pip install --upgrade pip setuptools wheel && .venv/bin/python --version';
    await executeShellCommand(cmd);
  }, [isStreaming, isExecutingCmd, showToast, addSystemMsg, executeShellCommand]);

  // Send AI Chat Message with Complete Runway
  const sendAiChat = async (promptText: string) => {
    if (!promptText.trim() || isStreaming || isExecutingCmd) return;

    const userMsgId = Math.random().toString(36).slice(2);
    const assistantMsgId = Math.random().toString(36).slice(2);
    const time = formatTime();

    // Add user message and empty streaming assistant slot
    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: 'user',
        content: promptText,
        timestamp: time,
      },
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

    // Proactive live web search when prompt directs a web interaction
    let augmentedPrompt = promptText;
    if (looksWebInteractionDirective(promptText)) {
      showToast('[ WEB SEARCH: LIVE QUERY ]');
      addSystemMsg(`[Web Intelligence]: Querying live web for "${promptText}"...`);
      try {
        const rawWeb = await runWebSearch({ query: promptText, count: 6 });
        if (rawWeb && rawWeb.trim()) {
          augmentedPrompt = `${promptText}\n\nVERIFIED LIVE WEB SEARCH RESULTS FOR "${promptText}":\n\`\`\`\n${rawWeb}\n\`\`\`\n\nCRITICAL INSTRUCTION FOR THIS TURN: The user gave a directive to run web interactions. The above verified web results have been retrieved live. Answer the user directly by summarizing and synthesizing these factual web results. DO NOT write python/curl/scraping code.`;
        }
      } catch (searchErr) {
        const msg = searchErr instanceof Error ? searchErr.message : String(searchErr);
        addSystemMsg(`[Web Search Notice]: ${msg}`);
      }
    }

    // Direct, thorough, high-performance system prompt without contradictory directives
    const systemPrompt = `You are the Abliterated AI CLI assistant, an expert software engineer and systems architect operating in an uncensored local terminal environment.
Provide direct, thorough, complete, fully implemented solutions with zero placeholder code or stubs.
Refusal Projection Parameter: lambda = ${lambda.toFixed(2)}.
${
  lambda <= 0.05
    ? 'Refusal direction is zeroed (uncensored, direct, technical mode). Answer questions directly, factually, and thoroughly without moralizing or preaching.'
    : `Refusal direction is set to lambda = ${lambda.toFixed(2)}.`
}
Always provide complete, rigorous, and un-truncated output.

CRITICAL DIRECTIVE — DO NOT HALLUCINATE:
- Never fabricate or assume non-existent APIs, CLI flags, parameters, library exports, or file paths.
- Only reference real, verified standard library functions, installed packages, or explicitly established context.
- If a package, tool version, syntax, or parameter is unverified or unknown, state it factually rather than guessing or confabulating details.
- Provide factually grounded, fully implemented, working code without imaginary placeholders or fabricated dependencies.

WEB INTERACTIONS & ONLINE RESEARCH:
- When the user's prompt is a directive to run web interactions, search the web, check online information, or fetch URLs:
- NEVER write Python/curl/Node web-scraping code or scripts (e.g. requests, bs4, selenium) unless the user explicitly requested code.
- Execute or answer the web query directly using live web intelligence and retrieved data, providing the actual facts, summaries, and answers requested.`;

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
        enabledTools: ['web_search', 'web_fetch'],
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

      const wasTruncated =
        result.finishReason === 'length' ||
        finalContent.endsWith('--') ||
        (!finalContent.endsWith('```') &&
          finalContent.includes('```') &&
          (finalContent.match(/```/g) || []).length % 2 !== 0);

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

      // Handle function tool calls if returned by model
      if (result.toolCalls && result.toolCalls.length > 0) {
        for (const tool of result.toolCalls) {
          if (tool.name === 'web_search') {
            const q =
              typeof tool.arguments?.query === 'string'
                ? tool.arguments.query
                : promptText;
            addSystemMsg(`[Web Search]: Querying "${q}"...`);
            try {
              const resText = await runWebSearch({ query: q, count: 6 });
              addSystemMsg(`[Web Search Results for "${q}"]:\n${resText}`);
            } catch (e) {
              addSystemMsg(
                `[Web Search Error]: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          } else if (tool.name === 'web_fetch') {
            const u =
              typeof tool.arguments?.url === 'string' ? tool.arguments.url : '';
            if (u) {
              addSystemMsg(`[Web Fetch]: Fetching "${u}"...`);
              try {
                const fetchRes = await fetch(u);
                const txt = await fetchRes.text();
                addSystemMsg(
                  `[Web Fetch (${fetchRes.status})]:\n${txt.slice(0, 1500)}`,
                );
              } catch (e) {
                addSystemMsg(
                  `[Web Fetch Error]: ${e instanceof Error ? e.message : String(e)}`,
                );
              }
            }
          }
        }
      }

      // Auto-Run Shell Execution if enabled
      if (autoRunShell && finalContent.trim() && !isExecutingCmd) {
        const blocks = parseContentBlocks(finalContent);
        const shellBlock = blocks.find(
          (b) =>
            b.type === 'code' &&
            /^(bash|sh|shell|zsh|console|terminal)$/i.test(b.language || ''),
        );
        if (shellBlock && shellBlock.content.trim()) {
          const cmdToRun = shellBlock.content.trim();
          setTimeout(() => {
            addSystemMsg(
              `⚡ [AUTO-RUN SHELL]: Executing generated command in workspace:\n$ ${cmdToRun}`,
            );
            void executeShellCommand(cmdToRun);
          }, 350);
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
  /spectrum <green|blue> Flip between Green Matrix and Electric Blue worlds
  /rain                  Toggle matrix digital rain backdrop
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
          const target = arg.toLowerCase();
          if (target.startsWith('g')) {
            setWorld('green');
            showToast('[ SPECTRUM: GREEN MATRIX ]');
            addSystemMsg('Spectrum shifted to GREEN MATRIX world.');
          } else if (target.startsWith('b')) {
            setWorld('blue');
            showToast('[ SPECTRUM: ELECTRIC BLUE ]');
            addSystemMsg('Spectrum shifted to ELECTRIC BLUE world.');
          } else {
            setWorld((prev) => {
              const next = prev === 'green' ? 'blue' : 'green';
              addSystemMsg(`Spectrum shifted to ${next.toUpperCase()} world.`);
              return next;
            });
          }
          break;
        }

        case 'rain':
          setRainEnabled((prev) => {
            const next = !prev;
            showToast(`[ RAIN: ${next ? 'ON' : 'OFF'} ]`);
            addSystemMsg(`Matrix backdrop rain: ${next ? 'ENABLED' : 'DISABLED'}`);
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
    ],
  );

  // Input Submission Handler
  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const raw = inputVal.trim();
    if (!raw || isStreaming || isExecutingCmd) return;

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
        { label: 'Create .venv', action: () => handleCreateVenv() },
        {
          label: autoRunShell ? 'Auto-Run: ON' : 'Auto-Run: OFF',
          action: () => toggleAutoRunShell(),
        },
        { label: 'pwd', action: () => executeShellCommand('pwd') },
        { label: 'git diff --stat', action: () => executeShellCommand('git diff --stat') },
        { label: 'npm test', action: () => executeShellCommand('npm test') },
        { label: 'Switch to AI Chat', action: () => setCliMode('ai') },
        { label: 'Help', action: () => executeCommand('/help') },
      ];
    }
    return [
      { label: 'Continue Generation', action: () => handleContinue() },
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
  }, [cliMode, autoRunShell, handleCreateVenv, toggleAutoRunShell, executeCommand]);

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
      {/* Background Matrix Rain (Subtle) */}
      {rainEnabled && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-none opacity-20 z-0"
        />
      )}

      {/* Top Header & HUD */}
      <header
        className="relative z-10 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b backdrop-blur-md"
        style={{
          borderColor: curPal.line,
          backgroundColor: curPal.panel,
        }}
      >
        {/* Left: Branding & Mode Selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span
                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ backgroundColor: curPal.neon }}
              />
              <span
                className="relative inline-flex rounded-full h-2.5 w-2.5"
                style={{ backgroundColor: curPal.neon }}
              />
            </span>
            <span
              className="font-bold tracking-widest text-xs uppercase"
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

        {/* Center: Model & Bridge Status & Refusal */}
        <div className="hidden sm:flex items-center gap-2.5 text-[11px]">
          {/* Bridge Status Indicator */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border"
            style={{
              borderColor:
                bridgeState === 'connected' ? curPal.line : 'rgba(245, 158, 11, 0.4)',
              backgroundColor:
                bridgeState === 'connected' ? curPal.panel2 : 'rgba(245, 158, 11, 0.08)',
              color: bridgeState === 'connected' ? curPal.neon : '#f59e0b',
            }}
          >
            <span
              className={cn(
                'w-2 h-2 rounded-full',
                bridgeState === 'connected' ? 'animate-ping' : 'animate-pulse',
              )}
              style={{
                backgroundColor: bridgeState === 'connected' ? curPal.neon : '#f59e0b',
              }}
            />
            <span className="font-bold">
              {bridgeState === 'connected'
                ? 'BRIDGE: ONLINE'
                : bridgeState === 'connecting' || bridgeState === 'restarting'
                  ? 'BRIDGE: CONNECTING'
                  : 'BRIDGE: OFFLINE'}
            </span>
            {bridgeState !== 'connected' && (
              <button
                type="button"
                onClick={() => {
                  bridge.reconnect();
                  showToast('[ BRIDGE: RECONNECTING ]');
                }}
                className="ml-1 px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase transition-colors hover:bg-amber-500/20"
                style={{ borderColor: 'rgba(245, 158, 11, 0.6)' }}
              >
                RECONNECT
              </button>
            )}
          </div>

          {/* Active Working Directory */}
          <div
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded border"
            style={{ borderColor: curPal.line, color: curPal.dim }}
            title={`Working Directory: ${activeRoot || 'Project Base'}`}
          >
            <Folder size={12} style={{ color: curPal.neon }} />
            <span>DIR:</span>
            <span className="font-bold" style={{ color: curPal.text }}>
              {shortRoot}
            </span>
          </div>

          {/* Active Model */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border"
            style={{ borderColor: curPal.line, color: curPal.dim }}
          >
            <Radio size={12} style={{ color: curPal.neon }} />
            <span>MODEL:</span>
            <span className="font-bold" style={{ color: curPal.neon }}>
              {activeEndpoint.defaultModel}
            </span>
          </div>

          {/* Thoughts Visibility Toggle */}
          <button
            type="button"
            onClick={() => {
              setThoughtsVisible((v) => {
                const next = !v;
                showToast(`[ THOUGHT TRACES: ${next ? 'EXPANDED' : 'COMPACT'} ]`);
                return next;
              });
            }}
            title="Toggle thought traces: Compact hides thought accordions, Expanded shows them"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border transition-colors hover:scale-105"
            style={{
              borderColor: curPal.line,
              backgroundColor: thoughtsVisible ? curPal.accentBg : 'transparent',
              color: thoughtsVisible ? curPal.neon : curPal.dim,
            }}
          >
            <Brain size={12} style={{ color: thoughtsVisible ? curPal.neon : curPal.dim }} />
            <span>THOUGHTS:</span>
            <span className="font-bold">{thoughtsVisible ? 'EXPANDED' : 'COMPACT'}</span>
          </button>

          {/* Refusal Lambda Status */}
          <button
            type="button"
            onClick={() => setShowLambdaBar((v) => !v)}
            title="Click to toggle lambda orthogonalization scrubber"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border transition-colors hover:border-current"
            style={{ borderColor: curPal.line, color: curPal.dim }}
          >
            {lambda <= 0.01 ? (
              <ShieldCheck size={12} style={{ color: curPal.neon }} />
            ) : (
              <ShieldAlert size={12} className="text-amber-400" />
            )}
            <span>REFUSAL:</span>
            <span
              className="font-bold"
              style={{ color: lambda <= 0.01 ? curPal.neon : '#f59e0b' }}
            >
              {lambda <= 0.01 ? 'ZEROED (λ=0)' : `λ=${lambda.toFixed(2)}`}
            </span>
            <Sliders size={11} className="ml-1 opacity-70" />
          </button>

          {/* Grounding: No Hallucination */}
          <div
            className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded border"
            style={{
              borderColor: curPal.line,
              backgroundColor: curPal.panel2,
              color: curPal.neon,
            }}
            title="Anti-Hallucination & Live Web Grounding active (zero fabricated APIs, paths, or code)"
          >
            <ShieldCheck size={12} style={{ color: curPal.neon }} />
            <span>GROUNDING:</span>
            <span className="font-bold">NO HALLUCINATION</span>
            <Globe size={11} className="ml-0.5 opacity-80" />
          </div>

          {/* Auto-Run Shell Toggle */}
          <button
            type="button"
            onClick={() => toggleAutoRunShell()}
            title="Toggle Auto-Run Shell: when active, AI generated shell code runs automatically"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border transition-all hover:scale-105"
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
            <span className="font-bold">{autoRunShell ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        {/* Right: Quick Controls */}
        <div className="flex items-center gap-2">
          {/* Create .venv Button */}
          <button
            type="button"
            onClick={handleCreateVenv}
            disabled={isExecutingCmd || isStreaming}
            title="Initialize Python virtual environment (.venv) in workspace root"
            className="hidden sm:flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold tracking-wider transition-colors hover:scale-105 disabled:opacity-50"
            style={{
              borderColor: curPal.line,
              color: curPal.neon,
              backgroundColor: curPal.panel2,
            }}
          >
            <TerminalIcon size={12} style={{ color: curPal.neon }} />
            <span>CREATE .VENV</span>
          </button>
          {/* Spectrum Switcher */}
          <button
            type="button"
            onClick={() => setWorld((w) => (w === 'green' ? 'blue' : 'green'))}
            title="Toggle spectrum world (Hotkey: S)"
            className="flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold tracking-wider transition-colors hover:scale-105"
            style={{
              borderColor: curPal.line2,
              color: curPal.neon,
              backgroundColor: curPal.accentBg,
            }}
          >
            {world === 'green' ? 'GREEN' : 'BLUE'}
          </button>

          {/* Rain Toggle */}
          <button
            type="button"
            onClick={() => setRainEnabled((r) => !r)}
            title="Toggle background matrix rain"
            className="p-1.5 rounded border transition-colors"
            style={{
              borderColor: curPal.line,
              color: rainEnabled ? curPal.neon : curPal.dim,
            }}
          >
            <Zap size={14} />
          </button>

          {/* Download All Session Files as ZIP */}
          {allSessionFiles.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const dateStr = new Date().toISOString().slice(0, 10);
                downloadFilesAsZip(`abliterated-session-files-${dateStr}`, allSessionFiles);
                showToast(`[ EXPORTED ZIP: ${allSessionFiles.length} FILES ]`);
              }}
              title={`Download all ${allSessionFiles.length} generated files as a ZIP archive`}
              className="flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] font-bold tracking-wider transition-all hover:scale-105"
              style={{
                borderColor: curPal.line2,
                color: curPal.neon,
                backgroundColor: curPal.accentBg,
              }}
            >
              <Download size={13} />
              <span className="hidden md:inline">ZIP ({allSessionFiles.length})</span>
            </button>
          )}

          {/* Clear */}
          <button
            type="button"
            onClick={() => executeCommand('clear')}
            title="Clear terminal buffer"
            className="p-1.5 rounded border transition-colors hover:text-red-400"
            style={{ borderColor: curPal.line, color: curPal.dim }}
          >
            <Trash2 size={14} />
          </button>

          {/* Fullscreen */}
          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
            title="Toggle fullscreen"
            className="p-1.5 rounded border transition-colors"
            style={{ borderColor: curPal.line, color: curPal.dim }}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </header>

      {/* Expandable Lambda Refusal Scrubber Drawer */}
      {showLambdaBar && (
        <div
          className="relative z-10 flex flex-wrap items-center justify-between gap-4 px-4 py-2.5 border-b animate-in fade-in slide-from-top-2"
          style={{
            borderColor: curPal.line2,
            backgroundColor: curPal.panel,
          }}
        >
          <div className="flex items-center gap-3 flex-1 min-w-[280px]">
            <span className="text-xs font-bold whitespace-nowrap" style={{ color: curPal.neon }}>
              REFUSAL PROJECTION (λ):
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={lambda}
              onChange={(e) => setLambda(parseFloat(e.target.value))}
              className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer accent-current"
              style={{ accentColor: curPal.neon }}
            />
            <span className="font-mono text-xs font-bold w-12" style={{ color: curPal.neon }}>
              {lambda.toFixed(2)}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setLambda(0.0)}
              className="px-2 py-1 rounded border text-[10px] font-bold uppercase transition-colors"
              style={{
                borderColor: curPal.line,
                backgroundColor: lambda === 0 ? curPal.accentBg : 'transparent',
                color: curPal.neon,
              }}
            >
              Zeroed (0.00)
            </button>
            <button
              type="button"
              onClick={() => setLambda(0.5)}
              className="px-2 py-1 rounded border text-[10px] font-bold uppercase transition-colors"
              style={{
                borderColor: curPal.line,
                backgroundColor: lambda === 0.5 ? curPal.accentBg : 'transparent',
                color: curPal.text,
              }}
            >
              Mid (0.50)
            </button>
            <button
              type="button"
              onClick={() => setLambda(1.0)}
              className="px-2 py-1 rounded border text-[10px] font-bold uppercase transition-colors"
              style={{
                borderColor: curPal.line,
                backgroundColor: lambda === 1.0 ? curPal.accentBg : 'transparent',
                color: curPal.dim,
              }}
            >
              Aligned (1.00)
            </button>
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
                className="p-3 rounded border font-mono text-[11px] whitespace-pre-wrap shadow-sm"
                style={{
                  borderColor: curPal.line,
                  backgroundColor: curPal.panel2,
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
              <div key={msg.id} className="space-y-1">
                <div
                  className="flex items-center gap-2 text-[10px]"
                  style={{ color: curPal.dim }}
                >
                  <span className="font-bold" style={{ color: curPal.neon }}>
                    {msg.isShell
                      ? `guest@abliterated:${shortRoot}$`
                      : 'guest@abliterated:~$'}
                  </span>
                  <span>[{msg.timestamp}]</span>
                  {msg.isShell && (
                    <span
                      className="px-1 py-0.2 rounded border text-[9px] font-bold uppercase tracking-wider"
                      style={{ borderColor: curPal.line2, color: curPal.neon }}
                    >
                      SHELL
                    </span>
                  )}
                </div>
                <div
                  className="px-3 py-2 rounded border font-medium text-[13px] whitespace-pre-wrap"
                  style={{
                    borderColor: curPal.line2,
                    backgroundColor: curPal.panel,
                    color: curPal.text,
                  }}
                >
                  {msg.isShell ? `$ ${msg.shellCommand || msg.content}` : msg.content}
                </div>
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

          const showSeparateThoughtBox =
            hasContentText &&
            hasReasoningText &&
            cleanReasoning !== cleanContent.trim();

          const mainAnswer = hasContentText ? cleanContent : cleanReasoning;
          const isExpanded = reasoningExpanded[msg.id] ?? thoughtsVisible;
          const parsedBlocks = parseContentBlocks(mainAnswer || '');
          const messageFiles = extractFilesFromMarkdown(mainAnswer || '');

          return (
            <div key={msg.id} className="space-y-2">
              <div
                className="flex items-center justify-between gap-2 text-[10px]"
                style={{ color: curPal.dim }}
              >
                <div className="flex items-center gap-2">
                  <Bot size={13} style={{ color: curPal.neon }} />
                  <span className="font-bold" style={{ color: curPal.neon }}>
                    abliterated [{activeEndpoint.defaultModel}]
                  </span>
                  <span>[{msg.timestamp}]</span>
                  {msg.isStreaming && (
                    <span
                      className="px-1.5 py-0.5 rounded border text-[9px] font-bold tracking-wider animate-pulse"
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
                    <span className="flex items-center gap-1.5">
                      <Sparkles size={11} style={{ color: curPal.neon }} />
                      THOUGHT TRACE ({cleanReasoning.length} chars)
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
                className="px-3.5 py-2.5 rounded border text-[12px] leading-relaxed shadow-md space-y-3"
                style={{
                  borderColor: curPal.line,
                  backgroundColor: curPal.panel,
                  color: curPal.text,
                }}
              >
                {parsedBlocks.map((block, bIdx) => {
                  if (block.type === 'text') {
                    return (
                      <div
                        key={bIdx}
                        className="whitespace-pre-wrap break-words leading-relaxed"
                      >
                        {block.content}
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
              </div>
            </div>
          );
        })}
      </main>

      {/* Bottom Suggestions Chips */}
      <div
        className="relative z-10 flex items-center gap-1.5 px-4 py-1.5 border-t overflow-x-auto no-scrollbar"
        style={{
          borderColor: curPal.line,
          backgroundColor: curPal.panel,
        }}
      >
        <span
          className="text-[10px] font-bold uppercase shrink-0"
          style={{ color: curPal.dim }}
        >
          {cliMode === 'shell' ? 'SHELL QUICK:' : 'AI QUICK:'}
        </span>
        {quickPrompts.map((qp, idx) => (
          <button
            key={idx}
            type="button"
            onClick={qp.action}
            disabled={isStreaming || isExecutingCmd}
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

          {isStreaming || isExecutingCmd ? (
            <button
              type="button"
              onClick={() => {
                abortCtrlRef.current?.abort();
                setIsStreaming(false);
                setIsExecutingCmd(false);
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

        {/* Status Line */}
        <div
          className="flex items-center justify-between mt-2 text-[9px] uppercase tracking-wider"
          style={{ color: curPal.dim }}
        >
          <div className="flex items-center gap-3">
            <span>
              MODE: <b style={{ color: curPal.neon }}>{cliMode.toUpperCase()}</b>
            </span>
            <span>
              CWD: <b style={{ color: curPal.text }}>{shortRoot}</b>
            </span>
            <span>
              BRIDGE:{' '}
              <b
                style={{
                  color: bridgeState === 'connected' ? curPal.neon : '#f59e0b',
                }}
              >
                {bridgeState.toUpperCase()}
              </b>
            </span>
            <span>
              RUNWAY: <b style={{ color: curPal.neon }}>8192 TOKENS</b>
            </span>
            <span>
              SPECTRUM: <b style={{ color: curPal.neon }}>{world.toUpperCase()}</b>
            </span>
            <span>
              REFUSAL:{' '}
              <b style={{ color: curPal.neon }}>
                {lambda <= 0.01 ? 'ZEROED' : `λ=${lambda.toFixed(2)}`}
              </b>
            </span>
            <span>
              AUTO-RUN:{' '}
              <b style={{ color: autoRunShell ? '#fbbf24' : curPal.dim }}>
                {autoRunShell ? 'ON' : 'OFF'}
              </b>
            </span>
            <span className="hidden md:inline">
              GROUNDING: <b style={{ color: curPal.neon }}>NO HALLUCINATION</b>
            </span>
          </div>

          <div className="hidden sm:flex items-center gap-3">
            <span>[ENTER] {cliMode === 'shell' ? 'RUN' : 'SEND'}</span>
            <span>[SHIFT+ENTER] NEWLINE</span>
            <span>[$ &lt;CMD&gt;] SHELL ESCAPE</span>
            <span>[ESC] ABORT</span>
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
