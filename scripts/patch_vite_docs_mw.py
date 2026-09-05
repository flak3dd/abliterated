from pathlib import Path
p = Path("vite.config.ts")
t = p.read_text()
if "docs-static-index" in t:
    print("already has docs middleware")
else:
    plugin = r'''
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Serve public/docs/index.html for /docs and /docs/ (before SPA fallback). */
function docsStaticIndex() {
  const indexPath = path.join(__dirname, 'public/docs/index.html');
  const handler = (
    req: { url?: string; method?: string },
    res: { setHeader: (k: string, v: string) => void; end: (b?: string) => void; statusCode: number },
    next: () => void,
  ) => {
    const raw = (req.url || '').split('?')[0];
    if (raw !== '/docs' && raw !== '/docs/') return next();
    if (req.method && req.method !== 'GET' && req.method !== 'HEAD') return next();
    try {
      const html = fs.readFileSync(indexPath, 'utf8');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(req.method === 'HEAD' ? undefined : html);
    } catch {
      next();
    }
  };
  return {
    name: 'docs-static-index',
    configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server: { middlewares: { use: (fn: unknown) => void } }) {
      server.middlewares.use(handler);
    },
  };
}

'''
    # Insert after react import
    needle = "import react from '@vitejs/plugin-react';\n"
    if needle not in t:
        raise SystemExit('import needle missing')
    t = t.replace(needle, needle + "\n" + plugin, 1)
    t = t.replace("plugins: [react()],", "plugins: [react(), docsStaticIndex()],")
    p.write_text(t)
    print("patched")
