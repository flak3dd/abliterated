#!/usr/bin/env python3
"""POST one OpenAI-compatible image generation against a local Spark bridge."""
from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--url", default="http://127.0.0.1:7860/v1/images/generations")
    p.add_argument("--model", default="krea2-raw-fp8")
    p.add_argument("--prompt", default="a red ceramic mug on a wooden table, soft daylight, photoreal")
    p.add_argument("--size", default="1328x1328")
    p.add_argument("--steps", type=int, default=24)
    p.add_argument("--guidance", type=float, default=3.5)
    p.add_argument("--lora-strength", type=float, default=0.75)
    p.add_argument(
        "--out",
        default="",
        help="PNG path. Default: <this-dir>/logs/<model>-smoke.png",
    )
    p.add_argument("--timeout", type=int, default=3600)
    p.add_argument("--status-file", default="", help="Write ok/fail one-liner here")
    args = p.parse_args()

    here = Path(__file__).resolve().parent
    out = Path(args.out) if args.out else here / "logs" / f"{args.model.replace('/', '-')}-smoke.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    status_path = Path(args.status_file) if args.status_file else Path("/tmp/quality_post.status")

    body = {
        "prompt": args.prompt,
        "model": args.model,
        "n": 1,
        "size": args.size,
        "response_format": "b64_json",
        "steps": args.steps,
        "guidance": args.guidance,
        "lora_strength": args.lora_strength,
    }
    req = urllib.request.Request(
        args.url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.time()
    print("POST", args.url, "model=" + args.model, flush=True)
    try:
        with urllib.request.urlopen(req, timeout=args.timeout) as resp:
            raw = resp.read()
            code = resp.status
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        line = f"fail {type(e).__name__}: {e}\n"
        status_path.write_text(line)
        print("POST_FAIL", e, flush=True)
        return 2
    try:
        obj = json.loads(raw)
        b64 = obj["data"][0]["b64_json"]
        png = base64.b64decode(b64)
    except (json.JSONDecodeError, KeyError, IndexError, TypeError) as e:
        line = f"fail parse HTTP {code}: {e}\n"
        status_path.write_text(line)
        print("POST_FAIL", line.strip(), flush=True)
        return 2
    out.write_bytes(png)
    line = "ok elapsed=%.1f bytes=%d magic=%s model=%s out=%s\n" % (
        time.time() - t0,
        len(png),
        png[:8].hex(),
        obj.get("model") or args.model,
        out,
    )
    status_path.write_text(line)
    print(line, end="", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
