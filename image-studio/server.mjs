#!/usr/bin/env node
/**
 * Image Studio Standalone Web Server
 * Serves the generative diffusion & image intelligence web application on port 17326.
 * Connects to the NVIDIA DGX Spark image bridge (:7860) or xAI Grok API.
 * Automatically persists generated artwork to .ablit/images/ with metadata.
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sparkImageCtl } from '../daemon/vllmControl.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const WORKSPACE_DIR = path.resolve(__dirname, '..');
const GALLERY_DIR = path.join(WORKSPACE_DIR, '.ablit', 'images');

const PORT = Number(process.env.PORT || 17326);
const HOST = process.env.HOST || '127.0.0.1';

// Ensure gallery directory exists
if (!fs.existsSync(GALLERY_DIR)) {
  fs.mkdirSync(GALLERY_DIR, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(json);
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(text);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`Invalid JSON payload: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

function httpGetJson(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch {
          json = { raw: body.slice(0, 400) };
        }
        resolve({ ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300, status: res.statusCode || 0, json });
      });
    });
    req.on('error', (err) => resolve({ ok: false, status: 0, error: err.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, error: 'timeout' });
    });
  });
}

function httpPostJson(url, payload, headers = {}, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;
    const parsedUrl = new URL(url);
    const bodyStr = JSON.stringify(payload);

    const req = client.request(
      parsedUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            const json = JSON.parse(raw);
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json, raw });
          } catch {
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, raw });
          }
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeoutMs / 1000}s`));
    });

    req.write(bodyStr);
    req.end();
  });
}

function fetchBuffer(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'Abliterated-Studio/1.0' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location, timeoutMs).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Fetch failed with HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Fetch timed out'));
    });
  });
}

function serveStatic(req, res, pathname) {
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '') safePath = '/index.html';

  const fullPath = path.join(PUBLIC_DIR, safePath);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, 'Forbidden');
  }

  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return fs.createReadStream(indexPath).pipe(res);
      }
      return sendText(res, 404, 'File Not Found');
    }

    const ext = path.extname(fullPath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(fullPath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = url.pathname;

  try {
    // API: GET /api/status - Probe Image Bridge
    if (pathname === '/api/status' && req.method === 'GET') {
      const bridgeHost = url.searchParams.get('host') || '127.0.0.1';
      const bridgePort = Number(url.searchParams.get('port') || 7860);

      const [health, modelsApi] = await Promise.all([
        httpGetJson(`http://${bridgeHost}:${bridgePort}/health`, 2000),
        httpGetJson(`http://${bridgeHost}:${bridgePort}/v1/models`, 2000),
      ]);

      const liveModels = Array.isArray(modelsApi.json?.data)
        ? modelsApi.json.data.map((m) => (typeof m === 'string' ? m : (m && m.id) || ''))
        : [];

      return sendJson(res, 200, {
        ok: true,
        bridgePort,
        healthy: health.ok,
        healthStatus: health.status,
        models: liveModels.filter(Boolean),
      });
    }

    // API: POST /api/generate - Generate Image (via local Spark bridge or xAI Grok or Pollinations fallback)
    if (pathname === '/api/generate' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const prompt = body.prompt || '';
      const model = body.model || 'krea2-raw-fp8';
      const bridgeUrl = body.bridgeUrl || 'http://127.0.0.1:7860/v1';
      const isXai = model.startsWith('grok') || !!body.xaiApiKey;

      let result = null;

      if (isXai) {
        // xAI Grok Cloud mode
        const xaiKey = body.xaiApiKey || process.env.XAI_API_KEY || '';
        if (!xaiKey) throw new Error('xAI API key required for Grok generation');

        const xaiRes = await httpPostJson(
          'https://api.x.ai/v1/images/generations',
          {
            model: 'grok-imagine-2.0',
            prompt,
            response_format: 'b64_json',
            n: 1,
            aspect_ratio: body.aspectRatio || '1:1',
          },
          { Authorization: `Bearer ${xaiKey}` },
        );

        if (!xaiRes.ok) throw new Error(xaiRes.json?.error?.message || `xAI HTTP ${xaiRes.status}`);
        result = xaiRes.json;
      } else {
        // Local DGX Spark Bridge Mode
        const isEdit = Boolean(body.image || (body.images && body.images.length > 0));
        const endpoint = isEdit ? `${bridgeUrl}/images/edits` : `${bridgeUrl}/images/generations`;

        const bridgePayload = {
          model,
          prompt,
          negative_prompt: body.negativePrompt || '',
          size: body.size || '1024x1024',
          steps: Number(body.steps) || 20,
          guidance_scale: Number(body.guidanceScale) || 5.0,
          seed: body.seed ? Number(body.seed) : undefined,
          response_format: 'b64_json',
          ...(isEdit ? { image: body.image, images: body.images } : {}),
        };

        let bridgeRes = null;
        try {
          bridgeRes = await httpPostJson(endpoint, bridgePayload, {}, 120000);
        } catch (err) {
          console.warn('[image-studio] Bridge call error:', err.message);
        }

        if (bridgeRes && bridgeRes.ok && bridgeRes.json?.data?.[0]?.b64_json) {
          result = bridgeRes.json;
        } else {
          // If bridge is offline or unavailable, fallback directly to Pollinations AI
          console.log('[image-studio] Bridge unavailable, generating via Pollinations...');
          const [pw, ph] = (body.size || '1024x1024').toLowerCase().split('x').map(Number);
          const w = Math.min(1024, Math.max(256, pw || 1024));
          const h = Math.min(1024, Math.max(256, ph || 1024));
          const pModel = model.includes('anime') || model.includes('pony') ? 'flux-anime'
            : model.includes('turbo') || model.includes('draft') || model.includes('fast') ? 'turbo'
            : model.includes('raw') ? 'flux-realism' : 'flux';
          const seedStr = body.seed ? `&seed=${body.seed}` : '';
          const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&model=${pModel}&nologo=true${seedStr}`;

          const imgBuf = await fetchBuffer(pollUrl, 30000);
          if (imgBuf && imgBuf.length > 500) {
            result = {
              created: Math.floor(Date.now() / 1000),
              model,
              data: [{ b64_json: imgBuf.toString('base64') }],
            };
          } else {
            throw new Error(bridgeRes?.json?.error?.message || `Bridge HTTP ${bridgeRes?.status || 500}`);
          }
        }
      }

      // Automatically persist image to .ablit/images/
      const b64Data = result?.data?.[0]?.b64_json;
      let filename = '';
      if (b64Data) {
        const id = crypto.randomBytes(6).toString('hex');
        const ts = Date.now();
        filename = `img_${ts}_${id}.png`;
        const filePath = path.join(GALLERY_DIR, filename);
        const metaPath = path.join(GALLERY_DIR, `img_${ts}_${id}.json`);

        const imgBuffer = Buffer.from(b64Data, 'base64');
        await fs.promises.writeFile(filePath, imgBuffer);

        const metadata = {
          filename,
          prompt,
          model,
          timestamp: ts,
          size: body.size || '1024x1024',
          seed: body.seed || null,
        };
        await fs.promises.writeFile(metaPath, JSON.stringify(metadata, null, 2));
      }

      return sendJson(res, 200, {
        ok: true,
        data: result?.data || [],
        savedFilename: filename,
      });
    }

    // API: GET /api/gallery - Fetch persistent history
    if (pathname === '/api/gallery' && req.method === 'GET') {
      const files = await fs.promises.readdir(GALLERY_DIR);
      const jsonFiles = files.filter((f) => f.endsWith('.json')).sort().reverse().slice(0, 50);

      const items = [];
      for (const jf of jsonFiles) {
        try {
          const metaRaw = await fs.promises.readFile(path.join(GALLERY_DIR, jf), 'utf8');
          const meta = JSON.parse(metaRaw);
          const imgFilename = meta.filename || jf.replace(/\.json$/, '.png');
          if (files.includes(imgFilename)) {
            items.push({
              ...meta,
              imageUrl: `/api/gallery/image/${imgFilename}`,
            });
          }
        } catch {
          // ignore corrupted metadata
        }
      }

      return sendJson(res, 200, {
        ok: true,
        items,
      });
    }

    // API: GET /api/gallery/image/:filename - Stream raw PNG
    if (pathname.startsWith('/api/gallery/image/') && req.method === 'GET') {
      const filename = path.basename(pathname.replace('/api/gallery/image/', ''));
      const filePath = path.join(GALLERY_DIR, filename);

      if (!fs.existsSync(filePath)) {
        return sendText(res, 404, 'Image not found');
      }

      const stat = await fs.promises.stat(filePath);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': stat.size,
        'Cache-Control': 'public, max-age=86400',
      });
      return fs.createReadStream(filePath).pipe(res);
    }

    // API: POST /api/bridge/restart - Restart image bridge daemon
    if (pathname === '/api/bridge/restart' && req.method === 'POST') {
      try {
        await sparkImageCtl('restart');
        return sendJson(res, 200, { ok: true, message: 'Bridge restart signal dispatched' });
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    }

    // Static Assets fallback
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error(`[Server Error] ${req.method} ${pathname}:`, err);
    return sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n======================================================`);
  console.log(`✨ Abliterated Image Studio Web Application`);
  console.log(`📡 URL: http://${HOST}:${PORT}/`);
  console.log(`🖼️  Gallery: ${GALLERY_DIR}`);
  console.log(`⚡ DGX Spark Bridge Target: http://127.0.0.1:7860`);
  console.log(`======================================================\n`);
});
