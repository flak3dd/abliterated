from pathlib import Path
p = Path("vite.config.ts")
lines = p.read_text().splitlines(True)
out = []
skip = False
for i, line in enumerate(lines):
    if line.startswith("const DOCS_REDIRECTS"):
        skip = True
        continue
    if skip:
        if line.startswith("const abliterationProxy"):
            skip = False
            out.append(line)
        continue
    out.append(line)
p.write_text("".join(out))
print("".join(out[:20]))
