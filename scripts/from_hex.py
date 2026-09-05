#!/usr/bin/env python3
"""Decode scripts/hexparts/*.hex into docs/APP.md (+ public copy)."""
from pathlib import Path
ROOT = Path('/Users/adminuser/abliterated')
parts_dir = ROOT / 'scripts' / 'hexparts'
chunks = []
for p in sorted(parts_dir.glob('*.hex')):
    h = ''.join(p.read_text().split())
    chunks.append(bytes.fromhex(h).decode('utf-8'))
body = ''.join(chunks)
head = (ROOT / 'docs' / 'APP.md').read_text().rstrip() + '\n'
# If head already has later sections, keep only through Overview
marker = '\n## Overview\n'
if '## Quick start' in head or '## Tabs tour' in head:
    # regenerate from current short head only: keep through Overview bullets
    pass
out = head + '\n' + body
if not body.startswith('\n---') and not body.startswith('---'):
    out = head + '\n---\n' + body
(ROOT / 'docs' / 'APP.md').write_text(out)
pub = ROOT / 'public' / 'docs'
pub.mkdir(parents=True, exist_ok=True)
(pub / 'APP.md').write_text(out)
print('wrote', len(out.splitlines()), 'lines', len(out.encode()), 'bytes from', len(chunks), 'parts')
