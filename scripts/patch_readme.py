from pathlib import Path
p = Path("README.md")
t = p.read_text()
needle = "5173/docs/"
if needle in t:
    print("already linked")
else:
    link = (
        "**Documentation:** open http://127.0.0.1:5173/docs/ while the DEV server runs, "
        "or read [`docs/APP.md`](docs/APP.md).\n\n"
    )
    lines = t.splitlines(True)
    out = []
    inserted = False
    for line in lines:
        if not inserted and line.startswith("## Setup"):
            out.append(link)
            inserted = True
        out.append(line)
    if not inserted:
        out.insert(1, "\n" + link)
    p.write_text("".join(out))
    print("updated")
print("--- head ---")
print("".join(p.read_text().splitlines(True)[:12]))
