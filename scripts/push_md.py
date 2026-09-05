#!/usr/bin/env python3
import sys
from pathlib import Path
path = Path(sys.argv[1])
line = sys.argv[2] if len(sys.argv) > 2 else ""
with path.open("a", encoding="utf-8") as f:
    f.write(line + "\n")
