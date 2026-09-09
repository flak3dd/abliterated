/**
 * Abliterated desktop shell (Electron).
 * Loads Vite dist/ in production, or http://127.0.0.1:5173 when ABLITERATED_ELECTRON_DEV=1.
 * Spawns daemon/bridge.js on 17322 if the port is free; kills only the child we spawned on quit.
 */
import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, '..');
/** Real FS root for daemon spawn (asar.unpacked when packaged). */
const APP_ROOT_FS =
  APP_ROOT.includes(path.sep + 'app.asar') && !APP_ROOT.includes('app.asar.unpacked')
    ? APP_ROOT.replace(path.sep + 'app.asar', path.sep + 'app.asar.unpacked')
    : APP_ROOT;
const BRIDGE_PORT = Number(process.env.ABLIT_PORT || 17322);
const DEV = process.env.ABLITERATED_ELECTRON_DEV === '1';

/** @type {import('node:child_process').ChildProcess | null} */
let bridgeChild = null;
/** Pid of the bridge we spawned (null if we reused an existing listener). */
let bridgeSpawnedPid = null;
let bridgeQuitting = false;
let bridgeRespawnTimer = null;
/** In-flight ensureBridge so Restart now cannot double-spawn. */
let bridgeEnsureLock = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const deep = findLicenseDeepLink(argv || []);
    if (deep) queueLicenseDeepLink(deep);
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function licenseStorePath() {
  return path.join(app.getPath('userData'), 'license.json');
}

function deviceStorePath() {
  return path.join(app.getPath('userData'), 'device.json');
}

function readStoredDeviceId() {
  try {
    const raw = fs.readFileSync(deviceStorePath(), 'utf8');
    const j = JSON.parse(raw);
    return typeof j?.deviceId === 'string' ? j.deviceId.trim() : '';
  } catch {
    return '';
  }
}

function writeStoredDeviceId(deviceId) {
  const dir = path.dirname(deviceStorePath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    deviceStorePath(),
    JSON.stringify({ deviceId: String(deviceId || '') }, null, 2),
    'utf8',
  );
}

/** Stable per-install id (UUID persisted in userData). */
function getOrCreateStoredDeviceId() {
  const existing = readStoredDeviceId();
  if (existing) return existing;
  const id = randomUUID();
  writeStoredDeviceId(id);
  return id;
}

function readStoredLicense() {
  try {
    const raw = fs.readFileSync(licenseStorePath(), 'utf8');
    const j = JSON.parse(raw);
    return typeof j?.key === 'string' ? j.key : '';
  } catch {
    return '';
  }
}

function writeStoredLicense(key) {
  const dir = path.dirname(licenseStorePath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(licenseStorePath(), JSON.stringify({ key: String(key || '') }, null, 2), 'utf8');
}


const PROTOCOL = 'abliterated';

function findLicenseDeepLink(argv) {
  for (const arg of argv || []) {
    if (typeof arg === 'string' && arg.startsWith(`${PROTOCOL}:`)) return arg;
  }
  return null;
}

function parseLicenseKeyFromDeepLink(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== `${PROTOCOL}:`) return '';
    const host = (u.hostname || '').toLowerCase();
    const pathPart = (u.pathname || '').replace(/^\/+/, '').toLowerCase();
    if (host !== 'license' && pathPart !== 'license') return '';
    return (u.searchParams.get('key') || '').trim();
  } catch {
    return '';
  }
}

function applyLicenseDeepLink(url) {
  const key = parseLicenseKeyFromDeepLink(url);
  if (!key) return false;
  writeStoredLicense(key);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ablit:licenseDeepLink', key);
  }
  return true;
}

function registerProtocolClient() {
  try {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
          path.resolve(process.argv[1]),
        ]);
      }
    } else {
      app.setAsDefaultProtocolClient(PROTOCOL);
    }
  } catch (err) {
    console.warn('[ablit] protocol register failed', err);
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function ensureBridge() {
  if (bridgeEnsureLock) return bridgeEnsureLock;
  bridgeEnsureLock = ensureBridgeUnlocked().finally(() => {
    bridgeEnsureLock = null;
  });
  return bridgeEnsureLock;
}

async function ensureBridgeUnlocked() {
  const free = await portFree(BRIDGE_PORT);
  if (!free) {
    if (bridgeChild) {
      console.log(`[ablit] bridge port ${BRIDGE_PORT} already ours pid=${bridgeSpawnedPid}`);
      return;
    }
    console.log(`[ablit] bridge port ${BRIDGE_PORT} already in use — reusing (no spawn)`);
    return;
  }
  if (bridgeChild) return;
  // asarUnpack puts daemon under app.asar.unpacked — spawn needs a real path.
  let bridgeJs = path.join(APP_ROOT, 'daemon', 'bridge.js');
  if (bridgeJs.includes('app.asar' + path.sep) && !bridgeJs.includes('app.asar.unpacked')) {
    bridgeJs = bridgeJs.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  }
  if (!fs.existsSync(bridgeJs)) {
    console.warn(`[ablit] bridge missing at ${bridgeJs}`);
    return;
  }
  // Run bridge via Electron-as-Node so Windows end users need no system Node.
  // daemon is asarUnpack'd so bridgeJs is a real filesystem path when packaged.
  bridgeChild = spawn(process.execPath, [bridgeJs], {
    cwd: APP_ROOT_FS,
    env: {
      ...process.env,
      ABLIT_PORT: String(BRIDGE_PORT),
      ABLIT_APP_ROOT: APP_ROOT_FS,
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  bridgeSpawnedPid = bridgeChild.pid ?? null;
  bridgeChild.stdout?.on('data', (d) => process.stdout.write(`[bridge] ${d}`));
  bridgeChild.stderr?.on('data', (d) => process.stderr.write(`[bridge] ${d}`));
  bridgeChild.on('exit', (code, signal) => {
    console.log(`[ablit] bridge exited code=${code} signal=${signal}`);
    bridgeChild = null;
    bridgeSpawnedPid = null;
    if (!bridgeQuitting) {
      if (bridgeRespawnTimer) clearTimeout(bridgeRespawnTimer);
      bridgeRespawnTimer = setTimeout(() => {
        bridgeRespawnTimer = null;
        if (!bridgeQuitting) void ensureBridge();
      }, 400);
    }
  });
  console.log(`[ablit] spawned bridge pid=${bridgeSpawnedPid} on ${BRIDGE_PORT}`);
}

function stopBridge() {
  // Only kill the child we spawned — never touch a pre-existing bridge.
  if (!bridgeChild || bridgeChild.killed) {
    bridgeChild = null;
    bridgeSpawnedPid = null;
    return;
  }
  const pid = bridgeSpawnedPid ?? bridgeChild.pid;
  try {
    bridgeChild.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  if (pid && pid > 0) {
    try {
      process.kill(pid, 0);
      // still alive briefly — SIGKILL as fallback after short grace is overkill here
    } catch {
      /* already gone */
    }
  }
  bridgeChild = null;
  bridgeSpawnedPid = null;
}

/** Minimal CSP for production file:// loads. */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* https:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function installCsp() {
  if (DEV) return;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...(details.responseHeaders || {}) };
    headers['Content-Security-Policy'] = [PROD_CSP];
    callback({ responseHeaders: headers });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'Abliterated',
    backgroundColor: '#09090b',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:') {
        void shell.openExternal(url);
      }
    } catch {
      /* deny malformed */
    }
    return { action: 'deny' };
  });

  // Block in-window navigation away from the packaged app / Vite origin.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const u = new URL(url);
      if (DEV) {
        if (u.origin === 'http://127.0.0.1:5173' || u.origin === 'http://localhost:5173') return;
      } else if (u.protocol === 'file:') {
        return;
      }
    } catch {
      /* fall through to prevent */
    }
    event.preventDefault();
  });

  if (DEV) {
    void mainWindow.loadURL('http://127.0.0.1:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexHtml = path.join(APP_ROOT, 'dist', 'index.html');
    void mainWindow.loadFile(indexHtml);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sparkInstallDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'spark-install');
  }
  return path.join(APP_ROOT, 'spark-install');
}

function registerIpc() {
  ipcMain.handle('ablit:getLicense', () => readStoredLicense());
  ipcMain.handle('ablit:setLicense', (_e, key) => {
    writeStoredLicense(typeof key === 'string' ? key : '');
    return true;
  });
  ipcMain.handle('ablit:getDeviceId', () => getOrCreateStoredDeviceId());
  ipcMain.handle('ablit:getVersion', () => app.getVersion());
  ipcMain.handle('ablit:openExternal', async (_e, url) => {
    const s = String(url || '').trim();
    let parsed;
    try {
      parsed = new URL(s);
    } catch {
      return false;
    }
    if (parsed.protocol === 'https:' || parsed.protocol === 'solana:') {
      await shell.openExternal(s);
      return true;
    }
    // http: only loopback (local OAuth / Spark helpers) — never arbitrary LAN/WAN http.
    if (parsed.protocol === 'http:') {
      const host = (parsed.hostname || '').toLowerCase();
      if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]') {
        await shell.openExternal(s);
        return true;
      }
      return false;
    }
    return false;
  });
  ipcMain.handle('ablit:webSearch', async (_e, opts) => {
    const modPath = path.join(APP_ROOT_FS, 'daemon', 'webSearch.js');
    const mod = await import(pathToFileURL(modPath).href);
    return mod.searchWeb(opts && typeof opts === 'object' ? opts : {});
  });
  ipcMain.handle('ablit:sparkInstallPath', () => sparkInstallDir());
  ipcMain.handle('ablit:revealSparkInstall', async () => {
    const dir = sparkInstallDir();
    if (!fs.existsSync(dir)) return { ok: false, path: dir };
    await shell.openPath(dir);
    return { ok: true, path: dir };
  });
  ipcMain.handle('ablit:ensureBridge', async () => {
    await ensureBridge();
    return { ok: true, pid: bridgeSpawnedPid };
  });
  ipcMain.handle('ablit:startSparkImage', async (_e, alias) => {
    const host = String(alias || '').trim();
    if (!/^[A-Za-z0-9._-]+$/.test(host)) return { ok: false, error: 'invalid ssh alias' };
    const { spawn: sp } = await import('node:child_process');
    return await new Promise((resolve) => {
      const child = sp('ssh', [host, 'bash', '~/abliterated-spark/spark-image/spark_ctl.sh', 'start'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout?.on('data', (b) => {
        out += String(b);
      });
      child.stderr?.on('data', (b) => {
        out += String(b);
      });
      child.on('close', (code) => resolve({ ok: code === 0, log: out.slice(-4000) }));
      child.on('error', (err) => resolve({ ok: false, error: err.message }));
    });
  });
  ipcMain.handle('ablit:checkUpdate', async () => {
    if (!app.isPackaged) return { ok: false, reason: 'dev' };
    try {
      autoUpdater.allowPrerelease = true;
      const result = await autoUpdater.checkForUpdates();
      const info = result?.updateInfo;
      return {
        ok: true,
        version: info?.version || '',
        current: app.getVersion(),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('ablit:downloadUpdate', async () => {
    if (!app.isPackaged) return { ok: false, reason: 'dev' };
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('ablit:quitAndInstall', () => {
    if (!app.isPackaged) return false;
    autoUpdater.quitAndInstall();
    return true;
  });
}

function wireAutoUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.allowPrerelease = true;
  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('ablit:updateStatus', { state: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('ablit:updateStatus', { state: 'none' });
  });
  autoUpdater.on('download-progress', (p) => {
    mainWindow?.webContents.send('ablit:updateStatus', { state: 'downloading', percent: p.percent });
  });
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('ablit:updateStatus', { state: 'ready', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('ablit:updateStatus', { state: 'error', error: err.message });
  });
  void autoUpdater.checkForUpdates().catch(() => undefined);
}

if (gotLock) {
  registerProtocolClient();

  // macOS deep link while running
  app.on('open-url', (event, url) => {
    event.preventDefault();
    applyLicenseDeepLink(url);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    installCsp();
    registerIpc();
    await ensureBridge();
    createWindow();
    wireAutoUpdater();
    // Cold-start deep link (Windows / Linux argv, or macOS open-url queued)
    const deep = findLicenseDeepLink(process.argv);
    if (deep) applyLicenseDeepLink(deep);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    bridgeQuitting = true;
    stopBridge();
  });

  app.on('will-quit', () => {
    stopBridge();
  });
}
