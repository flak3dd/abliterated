import {
  APP_ROOT_REFUSED,
  isPathInsideAppRoot,
  workspaceGate,
} from './workspaceGuard';

export type BridgeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type BridgeDirEntry = {
  name: string;
  path: string;
  dir: boolean;
};

type Incoming =
  | { runId: string; type: 'stdout' | 'stderr'; data: string }
  | { runId: string; type: 'exit'; code: number }
  | { runId: string; status: 'ok' | 'error'; error?: string; root?: string; path?: string; content?: string; encoding?: string; eol?: string; entries?: BridgeDirEntry[]; branch?: string; dirty?: boolean; porcelain?: string; text?: string; hash?: string }
  | { type: 'pong' }
  | { type: 'hello'; root?: string; port?: number; appRoot?: string; workspaceOk?: boolean; runId?: string }
  | Record<string, unknown>;

type Pending = {
  onStdout?: (chunk: string, stream: 'stdout' | 'stderr') => void;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export class BridgeClient {
  url: string;
  private ws: WebSocket | null = null;
  private status: BridgeStatus = 'disconnected';
  private listeners = new Set<(status: BridgeStatus) => void>();
  private rootListeners = new Set<(root: string) => void>();
  private appRootListeners = new Set<(appRoot: string) => void>();
  private pending = new Map<string, Pending>();
  private reconnectTimer: number | null = null;
  private closedByUser = false;
  private daemonRoot = '';
  private daemonAppRoot = '';
  private daemonPort = 17322;

  constructor(url = 'ws://127.0.0.1:17322') {
    this.url = url;
  }

  get connected(): boolean {
    return this.status === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  waitUntilConnected(timeoutMs = 4000): Promise<boolean> {
    if (this.connected) return Promise.resolve(true);
    this.connect();
    return new Promise((resolve) => {
      if (this.connected) { resolve(true); return; }
      const started = Date.now();
      const unsub = this.onStatusChange((s) => {
        if (s === 'connected' && this.connected) {
          window.clearInterval(timer);
          unsub();
          resolve(true);
        }
      });
      const timer = window.setInterval(() => {
        if (this.connected) {
          window.clearInterval(timer);
          unsub();
          resolve(true);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          window.clearInterval(timer);
          unsub();
          resolve(false);
        }
      }, 100);
    });
  }

  get currentStatus(): BridgeStatus {
    return this.status;
  }

  get currentRoot(): string {
    return this.daemonRoot;
  }

  get currentPort(): number {
    return this.daemonPort;
  }

  get currentAppRoot(): string {
    return this.daemonAppRoot;
  }

  /** Daemon cwd if it is a valid project folder; empty when it is the install. */
  get validWorkspaceRoot(): string {
    return workspaceGate(this.daemonRoot, this.daemonAppRoot).ok ? this.daemonRoot : '';
  }

  onStatusChange(cb: (status: BridgeStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.status);
    return () => {
      this.listeners.delete(cb);
    };
  }

  onRootChange(cb: (root: string) => void): () => void {
    this.rootListeners.add(cb);
    cb(this.daemonRoot);
    return () => {
      this.rootListeners.delete(cb);
    };
  }

  onAppRootChange(cb: (appRoot: string) => void): () => void {
    this.appRootListeners.add(cb);
    cb(this.daemonAppRoot);
    return () => {
      this.appRootListeners.delete(cb);
    };
  }

  private setStatus(next: BridgeStatus) {
    this.status = next;
    this.listeners.forEach((cb) => cb(next));
  }

  private setDaemonRoot(root: string, port?: number) {
    if (typeof port === 'number' && Number.isFinite(port)) this.daemonPort = port;
    if (root === this.daemonRoot) return;
    this.daemonRoot = root;
    this.rootListeners.forEach((cb) => cb(root));
  }

  private setDaemonAppRoot(appRoot: string) {
    if (!appRoot || appRoot === this.daemonAppRoot) return;
    this.daemonAppRoot = appRoot;
    this.appRootListeners.forEach((cb) => cb(appRoot));
  }

  private workspaceGateFor(root = this.daemonRoot) {
    return workspaceGate(root, this.daemonAppRoot);
  }

  private assertWritableWorkspace(file?: string): void {
    const gate = this.workspaceGateFor();
    if (!gate.ok) throw new Error(gate.message);
    if (file && isPathInsideAppRoot(file, this.daemonRoot, this.daemonAppRoot)) {
      throw new Error(APP_ROOT_REFUSED);
    }
  }

  connect(): void {
    this.closedByUser = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.setStatus('connecting');
    try {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      ws.onopen = () => {
        // Ignore stale sockets (React StrictMode remount / reconnect race).
        if (this.ws !== ws) return;
        this.setStatus('connected');
        try {
          this.sendRaw({ type: 'ping' });
          this.sendRaw({ type: 'hello' });
        } catch (err) {
          console.warn('[bridge] handshake send failed', err);
        }
      };
      ws.onmessage = (ev) => {
        if (this.ws !== ws) return;
        try {
          const msg = JSON.parse(String(ev.data)) as Incoming;
          this.handleIncoming(msg);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onerror = () => {
        if (this.ws !== ws) return;
        this.setStatus('error');
      };
      ws.onclose = () => {
        // Do not clear a newer socket that already replaced this one.
        if (this.ws !== ws) return;
        this.failAll(new Error('Bridge disconnected'));
        this.ws = null;
        if (!this.closedByUser) {
          this.setStatus('disconnected');
          this.scheduleReconnect();
        }
      };
    } catch {
      this.setStatus('error');
      this.scheduleReconnect();
    }
  }

  cleanup(): void {
    this.closedByUser = true;
    if (this.reconnectTimer != null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.failAll(new Error('Bridge cleanup'));
    this.setStatus('disconnected');
  }

  private scheduleReconnect() {
    if (this.closedByUser || this.reconnectTimer != null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.connect();
    }, 2500);
  }

  private failAll(err: Error) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private sendRaw(payload: unknown) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Bridge disconnected');
    }
    this.ws.send(JSON.stringify(payload));
  }

  private handleIncoming(msg: Incoming) {
    if ('type' in msg && msg.type === 'pong') return;

    if ('type' in msg && msg.type === 'hello') {
      const root = typeof msg.root === 'string' ? msg.root : '';
      const port = typeof msg.port === 'number' ? msg.port : undefined;
      const appRoot = typeof msg.appRoot === 'string' ? msg.appRoot : '';
      if (appRoot) this.setDaemonAppRoot(appRoot);
      if (root) this.setDaemonRoot(root, port);
      const helloRunId = typeof msg.runId === 'string' ? msg.runId : '';
      if (helloRunId) {
        const pendingHello = this.pending.get(helloRunId);
        if (pendingHello) {
          this.pending.delete(helloRunId);
          pendingHello.resolve(msg);
        }
      }
      return;
    }

    const runId = 'runId' in msg && typeof msg.runId === 'string' ? msg.runId : '';
    const pending = runId ? this.pending.get(runId) : undefined;
    if (!pending) return;

    if ('type' in msg && (msg.type === 'stdout' || msg.type === 'stderr') && 'data' in msg) {
      pending.onStdout?.(String(msg.data ?? ''), msg.type);
      return;
    }
    if ('type' in msg && msg.type === 'exit' && 'code' in msg) {
      this.pending.delete(runId);
      pending.resolve(Number(msg.code ?? 1));
      return;
    }
    if ('status' in msg) {
      this.pending.delete(runId);
      if (msg.status === 'ok') {
        const okMsg = msg as { root?: string; appRoot?: string };
        if (typeof okMsg.appRoot === 'string' && okMsg.appRoot) this.setDaemonAppRoot(okMsg.appRoot);
        if (typeof msg.root === 'string' && msg.root) this.setDaemonRoot(msg.root);
        pending.resolve(msg);
      } else {
        pending.reject(new Error(String(msg.error || 'bridge error')));
      }
    }
  }

  private runId(): string {
    return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private request(payload: Record<string, unknown>, onStdout?: (chunk: string, stream: 'stdout' | 'stderr') => void): Promise<unknown> {
    const runId = this.runId();
    return new Promise((resolve, reject) => {
      this.pending.set(runId, {
        onStdout: onStdout ? (chunk, stream) => onStdout(chunk, stream) : undefined,
        resolve,
        reject,
      });
      try {
        this.sendRaw({ ...payload, runId });
      } catch (err) {
        this.pending.delete(runId);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  runCommand(command: string, onStdout?: (chunk: string, stream?: 'stdout' | 'stderr') => void): Promise<number> {
    if (!this.connected) {
      return Promise.resolve(126);
    }
    const gate = this.workspaceGateFor();
    if (!gate.ok) {
      onStdout?.(`${gate.message}\n`, 'stderr');
      return Promise.resolve(126);
    }
    return this.request({ type: 'exec', command }, (chunk, stream) => onStdout?.(chunk, stream)).then((v) => Number(v));
  }

  applyPatch(file: string, patch: string): Promise<boolean> {
    if (!this.connected) return Promise.resolve(false);
    try {
      this.assertWritableWorkspace(file);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    return this.request({ type: 'apply_patch', file, patch }).then((v) => Boolean(v));
  }

  writeFile(file: string, content: string, opts?: { encoding?: string; eol?: string }): Promise<boolean> {
    if (!this.connected) return Promise.resolve(false);
    try {
      this.assertWritableWorkspace(file);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    return this.request({ type: 'write_file', file, content, encoding: opts?.encoding, eol: opts?.eol }).then((v) =>
      Boolean(v),
    );
  }


  createDirectory(dirPath: string): Promise<string> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    const gate = this.workspaceGateFor(dirPath);
    if (!gate.ok) return Promise.reject(new Error(gate.message));
    return this.request({ type: 'create_dir', path: dirPath }).then((v) => {
      const msg = v as { path?: string };
      return String(msg.path || dirPath);
    });
  }

  setRoot(path: string): Promise<string> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    const gate = this.workspaceGateFor(path);
    if (!gate.ok) return Promise.reject(new Error(gate.message));
    return this.request({ type: 'set_root', path }).then((v) => {
      const msg = v as { root?: string; appRoot?: string };
      if (typeof msg.appRoot === 'string' && msg.appRoot) this.setDaemonAppRoot(msg.appRoot);
      const root = String(msg.root || path);
      const after = this.workspaceGateFor(root);
      if (!after.ok) return Promise.reject(new Error(after.message));
      this.setDaemonRoot(root);
      return root;
    });
  }

  listDir(dirPath = '.'): Promise<BridgeDirEntry[]> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({ type: 'ls', path: dirPath }).then((v) => {
      const msg = v as { entries?: BridgeDirEntry[] };
      return Array.isArray(msg.entries) ? msg.entries : [];
    });
  }

  readFile(file: string, opts?: { encoding?: string }): Promise<string> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({ type: 'read_file', file, encoding: opts?.encoding }).then((v) => {
      const msg = v as { content?: string };
      return String(msg.content ?? '');
    });
  }


  readProjectMemory(): Promise<Array<{ path: string; text: string }>> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({ type: 'project_memory' }).then((v) => {
      const msg = v as { files?: Array<{ path: string; text: string }> };
      return Array.isArray(msg.files) ? msg.files : [];
    });
  }

  listSkills(): Promise<Array<{ id: string; name: string; description: string; path: string; body: string; source?: string }>> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({ type: 'list_skills' }).then((v) => {
      const msg = v as { skills?: Array<{ id: string; name: string; description: string; path: string; body: string; source?: string }> };
      return Array.isArray(msg.skills) ? msg.skills : [];
    });
  }

  readSkill(skillId: string): Promise<{ id: string; name: string; description: string; path: string; body: string; source?: string }> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({ type: 'read_skill', skill_id: skillId }).then((v) => {
      const msg = v as { skill?: { id: string; name: string; description: string; path: string; body: string; source?: string } };
      if (!msg.skill) throw new Error('skill not found');
      return msg.skill;
    });
  }

  writeSkill(input: {
    name: string;
    description: string;
    body: string;
    scope?: 'workspace' | 'user';
  }): Promise<{ id: string; name: string; description: string; path: string; body: string; source?: string }> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({
      type: 'write_skill',
      name: input.name,
      description: input.description,
      body: input.body,
      scope: input.scope || 'workspace',
    }).then((v) => {
      const msg = v as { skill?: { id: string; name: string; description: string; path: string; body: string; source?: string } };
      if (!msg.skill) throw new Error('write_skill failed');
      return msg.skill;
    });
  }

  deleteFile(file: string): Promise<boolean> {
    if (!this.connected) return Promise.resolve(false);
    try {
      this.assertWritableWorkspace(file);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    return this.request({ type: 'delete_file', file }).then((v) => Boolean(v));
  }

  grep(pattern: string, opts?: { path?: string; glob?: string; maxMatches?: number }): Promise<string> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({
      type: 'grep',
      pattern,
      path: opts?.path,
      glob: opts?.glob,
      maxMatches: opts?.maxMatches,
    }).then((v) => {
      const msg = v as { content?: string };
      return String(msg.content ?? '');
    });
  }

  glob(pattern: string): Promise<string> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({ type: 'glob', pattern }).then((v) => {
      const msg = v as { content?: string };
      return String(msg.content ?? '');
    });
  }

  fileOutline(file: string): Promise<string> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({ type: 'file_outline', file }).then((v) => {
      const msg = v as { content?: string };
      return String(msg.content ?? '');
    });
  }

  semanticSearch(
    query: string,
    opts?: { path?: string; glob?: string; maxSnippets?: number },
  ): Promise<string> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({
      type: 'semantic_search',
      query,
      path: opts?.path,
      glob: opts?.glob,
      maxSnippets: opts?.maxSnippets,
    }).then((v) => {
      const msg = v as { content?: string };
      return String(msg.content ?? '');
    });
  }

  gitStatus(): Promise<{ branch: string; dirty: boolean; porcelain: string; text: string }> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({ type: 'git_status' }).then((v) => {
      const msg = v as { branch?: string; dirty?: boolean; porcelain?: string; text?: string; content?: string };
      return {
        branch: String(msg.branch ?? ''),
        dirty: Boolean(msg.dirty),
        porcelain: String(msg.porcelain ?? ''),
        text: String(msg.text ?? msg.content ?? ''),
      };
    });
  }

  gitCommit(message: string, paths?: string[]): Promise<string> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({ type: 'git_commit', message, paths }).then((v) => {
      const msg = v as { content?: string; text?: string };
      return String(msg.text ?? msg.content ?? '');
    });
  }


  gitDiff(opts?: { staged?: boolean; path?: string }): Promise<string> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({ type: 'git_diff', staged: Boolean(opts?.staged), path: opts?.path }).then((v) => {
      const msg = v as { content?: string; text?: string };
      return String(msg.text ?? msg.content ?? '');
    });
  }

  createPr(opts: { title: string; body?: string; base?: string }): Promise<string> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({
      type: 'create_pr',
      title: opts.title,
      body: opts.body || '',
      base: opts.base,
    }).then((v) => {
      const msg = v as { content?: string; text?: string };
      return String(msg.text ?? msg.content ?? '');
    });
  }

  checkpointSave(label?: string): Promise<string> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({ type: 'checkpoint_save', label: label || '' }).then((v) => {
      const msg = v as { content?: string; text?: string; id?: string };
      return String(msg.text ?? msg.content ?? msg.id ?? '');
    });
  }

  checkpointRestore(id: string): Promise<string> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({ type: 'checkpoint_restore', id }).then((v) => {
      const msg = v as { content?: string; text?: string };
      return String(msg.text ?? msg.content ?? '');
    });
  }

  mcpConnect(cfg: {
    id: string;
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
  }): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({
      type: 'mcp_connect',
      id: cfg.id,
      name: cfg.name,
      command: cfg.command,
      args: cfg.args,
      env: cfg.env,
    }).then((v) => {
      const msg = v as { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> };
      return { tools: Array.isArray(msg.tools) ? msg.tools : [] };
    });
  }

  mcpDisconnect(id: string): Promise<void> {
    if (!this.connected) return Promise.resolve();
    return this.request({ type: 'mcp_disconnect', id }).then(() => undefined);
  }

  webSearch(opts: { query: string; count?: number; braveKey?: string; searxUrl?: string }): Promise<string> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({
      type: 'web_search',
      query: opts.query,
      count: opts.count,
      braveKey: opts.braveKey || '',
      searxUrl: opts.searxUrl || '',
    }).then((v) => {
      const msg = v as { content?: string; text?: string };
      return String(msg.text ?? msg.content ?? '');
    });
  }

  mcpCallTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({ type: 'mcp_call_tool', id: serverId, toolName, arguments: args }).then((v) => {
      const msg = v as { content?: string; text?: string };
      return String(msg.text ?? msg.content ?? '');
    });
  }

  hello(): Promise<{ root: string; port: number; appRoot: string; workspaceOk: boolean }> {
    if (!this.connected) return Promise.reject(new Error('Bridge disconnected'));
    return this.request({ type: 'hello' }).then((v) => {
      const msg = v as { root?: string; port?: number; appRoot?: string; workspaceOk?: boolean };
      const appRoot = String(msg.appRoot ?? this.daemonAppRoot);
      if (appRoot) this.setDaemonAppRoot(appRoot);
      const root = String(msg.root ?? this.daemonRoot);
      const port = Number(msg.port ?? this.daemonPort);
      if (root) this.setDaemonRoot(root, port);
      const workspaceOk = msg.workspaceOk !== false && this.workspaceGateFor(root).ok;
      return { root, port, appRoot, workspaceOk };
    });
  }
}

export const bridge = new BridgeClient();
