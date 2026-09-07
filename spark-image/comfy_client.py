"""Queue a ComfyUI txt2img workflow and return PNG bytes."""
from __future__ import annotations

import copy
import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_WORKFLOW = Path(__file__).resolve().parent / "workflows" / "txt2img-krea2-turbo-nvfp4.json"


def _http_json(method: str, url: str, body: dict[str, Any] | None = None, timeout: float = 30) -> Any:
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        raw = res.read()
        if not raw:
            return None
        return json.loads(raw.decode("utf-8"))


def _http_bytes(url: str, timeout: float = 60) -> bytes:
    with urllib.request.urlopen(url, timeout=timeout) as res:
        return res.read()


def load_workflow(path: str | Path | None = None) -> dict[str, Any]:
    p = Path(path) if path else DEFAULT_WORKFLOW
    return json.loads(p.read_text(encoding="utf-8"))


def apply_prompt(
    workflow: dict[str, Any],
    prompt: str,
    *,
    negative: str = "",
    width: int = 1024,
    height: int = 1024,
    seed: int | None = None,
    steps: int | None = None,
) -> dict[str, Any]:
    wf = copy.deepcopy(workflow)
    seed_v = int(seed) if seed is not None else random.randint(0, 2**31 - 1)
    for node in wf.values():
        if not isinstance(node, dict):
            continue
        kind = node.get("class_type")
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        if kind == "AbliteratedFluxKlein":
            inputs["prompt"] = prompt
            inputs["width"] = max(64, int(width))
            inputs["height"] = max(64, int(height))
            inputs["seed"] = seed_v
            if steps is not None:
                inputs["steps"] = int(steps)
            if "negative" in inputs:
                inputs["negative"] = negative
        elif kind == "CLIPTextEncode":
            text = str(inputs.get("text") or "")
            if text == "PROMPT" or text == "a photo":
                inputs["text"] = prompt
            elif text == "NEGATIVE":
                inputs["text"] = negative
        elif kind == "EmptyLatentImage":
            inputs["width"] = max(64, int(width))
            inputs["height"] = max(64, int(height))
            inputs["batch_size"] = 1
        elif kind == "KSampler":
            inputs["seed"] = seed_v
            if steps is not None:
                inputs["steps"] = int(steps)
    return wf


def generate_png(
    comfy_url: str,
    prompt: str,
    *,
    negative: str = "",
    width: int = 1024,
    height: int = 1024,
    seed: int | None = None,
    steps: int | None = None,
    workflow_path: str | None = None,
    timeout_s: float = 180,
    on_progress: Any = None,
) -> bytes:
    base = comfy_url.rstrip("/")
    wf = apply_prompt(
        load_workflow(workflow_path),
        prompt,
        negative=negative,
        width=width,
        height=height,
        seed=seed,
        steps=steps,
    )
    queued = _http_json("POST", base + "/prompt", {"prompt": wf})
    if not isinstance(queued, dict) or not queued.get("prompt_id"):
        raise RuntimeError(f"ComfyUI /prompt failed: {queued!r}")
    pid = str(queued["prompt_id"])
    deadline = time.time() + timeout_s
    outputs: dict[str, Any] | None = None
    while time.time() < deadline:
        hist = _http_json("GET", base + "/history/" + urllib.parse.quote(pid), timeout=15)
        if isinstance(hist, dict) and pid in hist:
            entry = hist[pid]
            if isinstance(entry, dict) and entry.get("outputs"):
                outputs = entry["outputs"]
                break
        if on_progress:
            try:
                q = _http_json("GET", base + "/queue", timeout=10)
                running = 0
                if isinstance(q, dict):
                    running = len(q.get("queue_running") or [])
                on_progress(20 if running else 8)
            except Exception:
                pass
        time.sleep(0.4)
    if not outputs:
        raise TimeoutError(f"ComfyUI prompt {pid} did not finish in {timeout_s}s")

    images: list[dict[str, Any]] = []
    for node_out in outputs.values():
        if isinstance(node_out, dict) and isinstance(node_out.get("images"), list):
            images.extend(node_out["images"])
    if not images:
        raise RuntimeError(f"ComfyUI prompt {pid} produced no images")
    img = images[0]
    qs = urllib.parse.urlencode(
        {
            "filename": img.get("filename") or "",
            "subfolder": img.get("subfolder") or "",
            "type": img.get("type") or "output",
        }
    )
    return _http_bytes(base + "/view?" + qs, timeout=60)
