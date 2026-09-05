/**
 * Abliterated desktop shell (Electron).
 * Loads Vite dist/ in production, or http://127.0.0.1:5173 when ABLITERATED_ELECTRON_DEV=1.
 * Spawns daemon/bridge.js on 17322 if the port is free; kills only the child we spawned on quit.
 */
import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
/** @type {BrowserWindow | null} */
let mainWindow = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function licenseStorePath() {
  return path.join(app.getPath('userData'), 'license.json');
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
  const free = await portFree(BRIDGE_PORT);
  if (!free) {
    console.log(`[ablit] bridge port ${BRIDGE_PORT} already in use — reusing (no spawn)`);
    bridgeChild = null;
    bridgeSpawnedPid = null;
    return;
  }
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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

function registerIpc() {
  ipcMain.handle('ablit:getLicense', () => readStoredLicense());
  ipcMain.handle('ablit:setLicense', (_e, key) => {
    writeStoredLicense(typeof key === 'string' ? key : '');
    return true;
  });
  ipcMain.handle('ablit:getVersion', () => app.getVersion());
  ipcMain.handle('ablit:webSearch', async (_e, opts) => {
    const modPath = path.join(APP_ROOT_FS, 'daemon', 'webSearch.js');
    const mod = await import(pathToFileURL(modPath).href);
    return mod.searchWeb(opts && typeof opts === 'object' ? opts : {});
  });
}

if (gotLock) {
  app.whenReady().then(async () => {
    installCsp();
    registerIpc();
    await ensureBridge();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    stopBridge();
  });

  app.on('will-quit', () => {
    stopBridge();
  });
}
