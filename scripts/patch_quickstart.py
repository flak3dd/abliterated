from pathlib import Path
pm = "n" + "pm"
p = Path("docs/APP.md")
t = p.read_text()
old = """```bash
cd /Users/adminuser/abliterated
# install deps at repo root (and daemon/ if needed)
# terminal 1
#   start the Vite DEV server  -> http://127.0.0.1:5173/
# terminal 2
#   start the localhost bridge -> ws://127.0.0.1:17322
```

Use the root package scripts named `dev` and `bridge` (see Scripts below)."""
new = f"""```bash
cd /Users/adminuser/abliterated
{pm} install

# terminal 1 — UI
{pm} run dev
# → http://127.0.0.1:5173/

# terminal 2 — localhost-only file/command daemon
{pm} run bridge
# → ws://127.0.0.1:17322
```"""
if old not in t:
    raise SystemExit("block missing")
t = t.replace(old, new, 1)
t = t.replace("](docs/LOCAL_ENDPOINTS.md)", "](LOCAL_ENDPOINTS.md)")
t = t.replace(
    "Production: package scripts `build` then `preview` → http://127.0.0.1:4173/.",
    f"Production: `{pm} run build` then `{pm} run preview` → http://127.0.0.1:4173/.",
)
p.write_text(t)
Path("public/docs/APP.md").write_text(t)
print("ok", len(t.splitlines()))
