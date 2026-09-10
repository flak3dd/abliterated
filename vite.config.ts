declare const process: { env: Record<string, string | undefined> };

import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ABLITERATED_TEMPLATES } from "./src/lib/mailersendTemplates";

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

/** DEV/preview: Node-side web_search so the renderer is not CORS-bound. */
function webSearchDevPlugin(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const raw = (req.url || "").split("?")[0];
    if (raw !== "/web-search") return next();
    const method = (req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") return next();

    const send = (code: number, body: string, type = "text/plain; charset=utf-8") => {
      res.statusCode = code;
      res.setHeader("Content-Type", type);
      res.end(body);
    };

    const run = async (opts: { query?: string; count?: number; braveKey?: string; searxUrl?: string }) => {
      try {
        const mod = await import("./daemon/webSearch.js");
        const text = await mod.searchWeb(opts);
        send(200, text);
      } catch (err) {
        send(502, err instanceof Error ? err.message : String(err));
      }
    };

    if (method === "GET") {
      const u = new URL(req.url || "", "http://127.0.0.1");
      const query = u.searchParams.get("q") || u.searchParams.get("query") || "";
      const countRaw = u.searchParams.get("count");
      void run({ query, count: countRaw ? Number(countRaw) : undefined });
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => {
      let opts: { query?: string; count?: number; braveKey?: string; searxUrl?: string } = {};
      try {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        if (rawBody.trim()) opts = JSON.parse(rawBody) as typeof opts;
      } catch {
        send(400, "invalid json");
        return;
      }
      void run(opts);
    });
  };
  return {
    name: "web-search-dev",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
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
    timeout: 0,
    proxyTimeout: 0,
    rewrite: (p: string) => p.replace(/^\/featherless-api/, ''),
    configure: (proxy: { on: (event: string, listener: (...args: never[]) => void) => void }) => {
      proxy.on(
        'proxyRes',
        ((
          proxyRes: { headers: Record<string, unknown> },
          _req: unknown,
          res: { setHeader: (k: string, v: string) => void },
        ) => {
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('X-Accel-Buffering', 'no');
          const ct = String(proxyRes.headers['content-type'] || '');
          if (ct.includes('text/event-stream')) {
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          }
        }) as (...args: never[]) => void,
      );
    },
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
  '/xai-v1': {
    target: 'https://api.x.ai',
    changeOrigin: true,
    secure: true,
    timeout: 0,
    proxyTimeout: 0,
    rewrite: (p: string) => p.replace(/^\/xai-v1/, '/v1'),
  },
  '/image-v1': {
    target: process.env.ABLITERATED_IMAGE_URL || 'http://127.0.0.1:7860',
    changeOrigin: true,
    timeout: 0,
    proxyTimeout: 0,
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

/** DEV/preview: Node-side MailerSend proxy to verify domains and send test emails. */
function mailerSendDevPlugin(): Plugin {
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    const raw = (req.url || "").split("?")[0];
    if (!raw.startsWith("/api/mailersend")) return next();

    const sendJson = (code: number, data: unknown) => {
      res.statusCode = code;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(data, null, 2));
    };

    const getApiKey = () => {
      let key = process.env.MAILERSEND_API_KEY || "";
      if (!key) {
        try {
          const envLocal = fs.readFileSync(path.join(__dirname, ".env.local"), "utf8");
          const m = envLocal.match(/MAILERSEND_API_KEY=([^\r\n]+)/);
          if (m) key = m[1].trim();
        } catch {
          // ignore
        }
      }
      return key;
    };

    const apiKey = getApiKey();
    if (!apiKey) {
      return sendJson(400, { ok: false, error: "MAILERSEND_API_KEY not configured in environment or .env.local" });
    }

    if (raw === "/api/mailersend/check" || raw === "/api/mailersend/domains") {
      try {
        const dRes = await fetch("https://api.mailersend.com/v1/domains", {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });
        const dJson = await dRes.json();
        console.log("MAILERSEND_DOMAINS_LOG:", JSON.stringify(dJson));
        try {
          fs.writeFileSync(path.join(__dirname, "scripts/mailersend_domains.json"), JSON.stringify(dJson, null, 2), "utf8");
        } catch (e) {
          console.error("WRITE ERROR:", e);
        }
        return sendJson(dRes.status, { ok: dRes.ok, status: dRes.status, domains: (dJson as any)?.data || [], raw: dJson });
      } catch (err: unknown) {
        return sendJson(500, { ok: false, error: String(err) });
      }
    }

    if (raw === "/api/mailersend/templates") {
      try {
        const tRes = await fetch("https://api.mailersend.com/v1/templates", {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        });
        const tJson = await tRes.json();
        try {
          fs.writeFileSync(path.join(__dirname, "scripts/mailersend_templates.json"), JSON.stringify(tJson, null, 2), "utf8");
        } catch (e) {
          console.error("WRITE ERROR:", e);
        }
        return sendJson(tRes.status, { ok: tRes.ok, status: tRes.status, templates: (tJson as any)?.data || [], raw: tJson });
      } catch (err: unknown) {
        return sendJson(500, { ok: false, error: String(err) });
      }
    }

    if (raw === "/api/mailersend/templates-catalog") {
      return sendJson(200, {
        ok: true,
        count: ABLITERATED_TEMPLATES.length,
        templates: ABLITERATED_TEMPLATES.map((t) => ({
          type: t.type,
          name: t.name,
          subject: t.subject,
          defaultPayload: t.defaultPayload,
        })),
      });
    }

    if (raw === "/api/mailersend/run-tests") {
      try {
        const { execFileSync } = await import("child_process");
        const out = execFileSync("node", ["scripts/test-mailersend.mjs"], { cwd: __dirname, encoding: "utf8" });
        return sendJson(200, { ok: true, output: out });
      } catch (err: unknown) {
        return sendJson(500, { ok: false, error: String(err) });
      }
    }

    if (raw === "/api/mailersend/send-templates") {
      const u = new URL(req.url || "", "http://127.0.0.1");
      const toEmail = u.searchParams.get("to") || process.env.MAILERSEND_TO || "jdjduncan@outlook.com";
      const toName = u.searchParams.get("toName") || "JD Duncan";
      const fromEmail = u.searchParams.get("from") || process.env.MAILERSEND_FROM || "test@abliterated.app";
      const fromName = u.searchParams.get("fromName") || process.env.MAILERSEND_FROM_NAME || "Abliterated Workbench";

      const results = [];
      for (const t of ABLITERATED_TEMPLATES) {
        const payload = {
          from: { email: fromEmail, name: fromName },
          to: [{ email: toEmail, name: toName }],
          subject: t.subject,
          text: t.getText(t.defaultPayload),
          html: t.getHtml(t.defaultPayload),
          tags: ["abliterated-template", t.type],
        };

        try {
          const mRes = await fetch("https://api.mailersend.com/v1/email", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: JSON.stringify(payload),
          });
          const text = await mRes.text();
          let json: unknown = {};
          try { json = JSON.parse(text); } catch { json = { text }; }
          const msgId = mRes.headers.get("x-message-id") || undefined;
          results.push({
            type: t.type,
            name: t.name,
            subject: t.subject,
            to: toEmail,
            from: fromEmail,
            ok: mRes.ok,
            status: mRes.status,
            messageId: msgId,
            response: json,
          });
        } catch (err: unknown) {
          results.push({
            type: t.type,
            name: t.name,
            subject: t.subject,
            to: toEmail,
            from: fromEmail,
            ok: false,
            status: 500,
            error: String(err),
          });
        }
      }

      try {
        fs.writeFileSync(
          path.join(__dirname, "scripts/mailersend_templates_sent.json"),
          JSON.stringify(results, null, 2),
          "utf8"
        );
      } catch (e) {
        console.error("WRITE ERROR:", e);
      }

      return sendJson(200, {
        ok: results.every((r) => r.ok),
        count: results.length,
        results,
      });
    }

    if (raw === "/api/mailersend/send-test" || (raw === "/api/mailersend/send" && (req.method || "").toUpperCase() === "GET")) {
      const u = new URL(req.url || "", "http://127.0.0.1");
      const toEmail = u.searchParams.get("to") || process.env.MAILERSEND_TO || "jdjduncan@outlook.com";
      const fromEmail = u.searchParams.get("from") || process.env.MAILERSEND_FROM || "test@abliterated.app";
      const fromName = u.searchParams.get("fromName") || process.env.MAILERSEND_FROM_NAME || "Abliterated Workbench";
      const subject = u.searchParams.get("subject") || "This is a Subject";
      const bodyText = u.searchParams.get("text") || "Greetings from the team, you got this message through MailerSend.";

      const payload = {
        from: { email: fromEmail, name: fromName || "Your name" },
        to: [{ email: toEmail, name: "Your Client" }],
        subject,
        text: bodyText,
        html: `<p>${bodyText}</p>`,
      };

      try {
        const mRes = await fetch("https://api.mailersend.com/v1/email", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify(payload),
        });
        const text = await mRes.text();
        let json = {};
        try { json = JSON.parse(text); } catch { json = { text }; }
        const msgId = mRes.headers.get("x-message-id") || undefined;
        const result = { ok: mRes.ok, status: mRes.status, messageId: msgId, response: json, payload: { from: payload.from, to: payload.to, subject: payload.subject } };
        try {
          fs.writeFileSync(path.join(__dirname, "scripts/mailersend_last_send.json"), JSON.stringify(result, null, 2), "utf8");
        } catch {
          // ignore
        }
        return sendJson(mRes.status, result);
      } catch (err: unknown) {
        return sendJson(500, { ok: false, error: String(err) });
      }
    }

    if (raw === "/api/mailersend/send" && (req.method || "").toUpperCase() === "POST") {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      req.on("end", async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const mRes = await fetch("https://api.mailersend.com/v1/email", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: JSON.stringify(body),
          });
          const text = await mRes.text();
          let json = {};
          try { json = JSON.parse(text); } catch { json = { text }; }
          const msgId = mRes.headers.get("x-message-id") || undefined;
          return sendJson(mRes.status, { ok: mRes.ok, status: mRes.status, messageId: msgId, response: json });
        } catch (err: unknown) {
          return sendJson(400, { ok: false, error: String(err) });
        }
      });
      return;
    }

    next();
  };

  return {
    name: "mailersend-dev",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

/** DEV/preview: Spark vLLM control (SSH + local :8000 probe). */
function vllmCtlDevPlugin(): Plugin {
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const raw = (req.url || "").split("?")[0];
    if (!raw.startsWith("/vllm-ctl")) return next();
    const sendJson = (code: number, data: unknown) => {
      res.statusCode = code;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(data));
    };
    const op = raw.replace(/^\/vllm-ctl\/?/, "") || "status";
    const run = async (payload: Record<string, unknown>) => {
      try {
        // @ts-expect-error local daemon module
        const mod: any = await import("./daemon/vllmControl.js");
        const out = await mod.handleVllmCtl(op, payload);
        sendJson(200, out);
      } catch (err) {
        sendJson(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    };
    if ((req.method || "GET").toUpperCase() === "GET") {
      const u = new URL(req.url || "", "http://127.0.0.1");
      void run({ alias: u.searchParams.get("alias") || undefined, port: u.searchParams.get("port") || undefined });
      return;
    }
    if ((req.method || "").toUpperCase() !== "POST") return next();
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => {
      let payload: Record<string, unknown> = {};
      try {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        if (rawBody.trim()) payload = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        sendJson(400, { ok: false, error: "invalid json" });
        return;
      }
      void run(payload);
    });
  };
  return {
    name: "vllm-ctl-dev",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), docsStaticIndex(), webSearchDevPlugin(), mailerSendDevPlugin(), vllmCtlDevPlugin()],
  resolve: {
    alias: {
      mailersend: path.resolve(__dirname, "src/lib/mailersend.ts"),
    },
  },
  server: { host: '127.0.0.1', port: 5173, proxy: abliterationProxy },
  preview: { host: '127.0.0.1', port: 4173, proxy: abliterationProxy },
});
