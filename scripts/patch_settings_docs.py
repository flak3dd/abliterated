from pathlib import Path
p = Path("src/screens/SettingsScreen.tsx")
t = p.read_text()
marker = '        <Section title="Danger zone"'
if "App docs" in t and "/docs/" in t:
    print("already has App docs link")
else:
    block = '''        <Section title="Documentation" hint="In-app guide served by Vite from public/docs while the DEV server runs.">
          <a
            href="/docs/"
            target="_blank"
            rel="noreferrer"
            className="btn-primary inline-flex"
          >
            App docs
          </a>
          <p className="mt-2 font-mono text-[11px] text-muted">
            Opens /docs/ in a new tab (http://127.0.0.1:5173/docs/). Raw markdown: /docs/APP.md
          </p>
        </Section>

'''
    if marker not in t:
        raise SystemExit("danger zone marker missing")
    t = t.replace(marker, block + marker, 1)
    p.write_text(t)
    print("patched SettingsScreen")
print("ok")
