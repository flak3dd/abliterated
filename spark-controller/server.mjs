#!/usr/bin/env node
/**
 * Spark Controller Standalone Web Server
 * Serves the modern DGX Spark management web application on port 17325.
 * Provides REST APIs for GPU telemetry, text vLLM serving, image bridge,
 * stack lifecycle control, and real-time streaming diagnostics.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleVllmCtl,
  vllmStatus,
  RECIPES,
  defaultConfig,
} from '../daemon/vllmControl.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = Number(process.env.PORT || 17325);
const HOST = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

function sendJson(res, statusCode, data) {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
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

function serveStatic(req, res, pathname) {
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '') safePath = '/index.html';

  const fullPath = path.join(PUBLIC_DIR, safePath);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, 'Forbidden');
  }

  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fall back to index.html for SPA-style routing if available
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
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = url.pathname;

  try {
    // API Route: GET /api/status
    if (pathname === '/api/status' && req.method === 'GET') {
      const alias = url.searchParams.get('alias') || 'flak3dd';
      const port = Number(url.searchParams.get('port') || 8000);
      const status = await vllmStatus({ alias, port });
      return sendJson(res, 200, status);
    }

    // API Route: GET /api/recipes
    if (pathname === '/api/recipes' && req.method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        recipes: Object.values(RECIPES),
        defaults: defaultConfig('qwen'),
      });
    }

    // API Route: POST /api/vllm
    if (pathname === '/api/vllm' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const op = String(body.op || 'serve');
      const result = await handleVllmCtl(op, body);
      return sendJson(res, 200, result);
    }

    // API Route: POST /api/image
    if (pathname === '/api/image' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const result = await handleVllmCtl('image-action', body);
      return sendJson(res, 200, result);
    }

    // API Route: POST /api/stack
    if (pathname === '/api/stack' && req.method === 'POST') {
      const body = await parseJsonBody(req);
      const result = await handleVllmCtl('stack-action', body);
      return sendJson(res, 200, result);
    }

    // API Route: GET /api/logs
    if (pathname === '/api/logs' && req.method === 'GET') {
      const alias = url.searchParams.get('alias') || 'flak3dd';
      const target = url.searchParams.get('target') || 'vllm';
      const lines = Number(url.searchParams.get('lines') || 120);
      const result = await handleVllmCtl('logs', { alias, target, lines });
      return sendJson(res, 200, result);
    }

    // Serve Static UI Assets
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error(`[SparkController] Error handling ${req.method} ${pathname}:`, err);
    return sendJson(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n========================================================`);
  console.log(`⚡ SPARK CONTROLLER ONLINE`);
  console.log(`   Web Interface:  http://${HOST}:${PORT}/`);
  console.log(`   Status API:     http://${HOST}:${PORT}/api/status`);
  console.log(`========================================================\n`);
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
