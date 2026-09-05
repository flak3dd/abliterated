from pathlib import Path
p = Path("vite.config.ts")
t = p.read_text()
# Remove docs redirect plugin; public/docs/index.html is the guide entry.
old_start = "const DOCS_REDIRECTS"
if "docsRedirect" not in t:
    print("no docsRedirect")
else:
    # Replace plugins line and strip redirect helper
    import re
    t2 = re.sub(
        r"\nconst DOCS_REDIRECTS: Record<string, string> = \{[\s\S]*?\n\}\n\nfunction docsRedirect\(\): Plugin \{[\s\S]*?\n\}\n\n",
        "\n",
        t,
        count=1,
    )
    t2 = t2.replace("plugins: [react(), docsRedirect()],", "plugins: [react()],")
    t2 = t2.replace("import { defineConfig, type Plugin } from 'vite';", "import { defineConfig } from 'vite';")
    if t2 == t:
        raise SystemExit("failed to patch")
    p.write_text(t2)
    print("patched vite.config.ts")

# Also expose LOCAL_ENDPOINTS under public/docs for raw links
src = Path("docs/LOCAL_ENDPOINTS.md")
dst = Path("public/docs/LOCAL_ENDPOINTS.md")
if src.exists():
    dst.write_text(src.read_text())
    print("copied LOCAL_ENDPOINTS to public/docs")
print(p.read_text()[:400])
