declare const process: { env: Record<string, string | undefined> };

import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Serve public/docs/index.html for /docs and /docs/ (before SPA fallback). */
function docsStaticIndex(): Plugin {
  const indexPath = path.join(__dirname, "public/docs/index.html");
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const raw = (req.url || "").split("?")[0];
    if (raw !== "/docs" && raw !== "/docs/") return next();
    if (req.method && req.method !== "GET" && req.method !== "HEAD") return next();
    try {
      const html = fs.readFileSync(indexPath, "utf8");
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(req.method === "HEAD" ? undefined : html);
    } catch {
      next();
    }
  };
  return {
    name: "docs-static-index",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}


type ProxyResLike = {
  writeHead?: (code: number, h: Record<string, string>) => void;
  end?: (b: string) => void;
  headersSent?: boolean;
};
/** Quiet 502 when local Featherless (3000) is down. */
function featherlessLocalProxyConfigure(proxy: {
  on: (event: string, listener: (...args: never[]) => void) => void;
}) {
  proxy.on(
    'error',
    ((err: Error, _req: unknown, res: unknown) => {
      const r = res as ProxyResLike;
      if (!r?.writeHead || !r.end || r.headersSent) return;
      r.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      r.end(
        'Featherless OAuth proxy not running on :3000 (' +
          String(err?.message || err) +
          '). Run: npm run featherless-oauth (set FEATHERLESS_CLIENT_ID/SECRET). Or use https://api.featherless.ai/v1 + API key.',
      );
    }) as (...args: never[]) => void,
  );
}

const abliterationProxy = {
  '/v1': {
    target: 'https://api.abliteration.ai',
    changeOrigin: true,
    secure: true,
  },
  '/spark-v1': {
    target: process.env.DGX_SPARK_URL || 'http://127.0.0.1:8000',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/spark-v1/, '/v1'),
  },

  /** Cloud Featherless API (CORS bypass in DEV). */
  '/featherless-api': {
    target: 'https://api.featherless.ai',
    changeOrigin: true,
    secure: true,
    rewrite: (p: string) => p.replace(/^\/featherless-api/, ''),
  },
  '/featherless-v1': {
    target: process.env.FEATHERLESS_URL || 'http://127.0.0.1:3000',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/featherless-v1/, '/v1'),
    configure: featherlessLocalProxyConfigure,
  },
  '/featherless-oauth': {
    target: process.env.FEATHERLESS_URL || 'http://127.0.0.1:3000',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/featherless-oauth/, ''),
    configure: featherlessLocalProxyConfigure,
  },
  '/image-v1': {
    target: process.env.ABLITERATED_IMAGE_URL || 'http://127.0.0.1:7860',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/image-v1/, '/v1'),
    configure: (proxy: { on: (event: string, listener: (...args: never[]) => void) => void }) => {
      proxy.on('error', ((err: Error, _req: unknown, res: unknown) => {
        const r = res as { writeHead?: (code: number, h: Record<string, string>) => void; end?: (b: string) => void; headersSent?: boolean };
        if (!r?.writeHead || !r.end || r.headersSent) return;
        r.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        r.end(
          'Image proxy target down (' +
            String(err?.message || err) +
            '). Start: cd spark-image && ABLITERATED_IMAGE_MOCK=1 python3 serve-openai-bridge.py',
        );
      }) as (...args: never[]) => void);
    },
  },
};

export default defineConfig({
  plugins: [react(), docsStaticIndex()],
  server: { host: '127.0.0.1', port: 5173, proxy: abliterationProxy },
  preview: { host: '127.0.0.1', port: 4173, proxy: abliterationProxy },
});
