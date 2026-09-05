from pathlib import Path
p = Path("vite.config.ts")
t = p.read_text()
t = t.replace(
    "import { defineConfig } from 'vite';",
    "import { defineConfig, type Plugin } from 'vite';",
)
t = t.replace(
    "function docsStaticIndex() {",
    "function docsStaticIndex(): Plugin {",
)
t = t.replace(
    "configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {",
    "configureServer(server) {",
)
t = t.replace(
    "configurePreviewServer(server: { middlewares: { use: (fn: unknown) => void } }) {",
    "configurePreviewServer(server) {",
)
p.write_text(t)
print("fixed typings")
