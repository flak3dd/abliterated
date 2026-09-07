#!/usr/bin/env python3
"""
OpenAI-compatible image bridge for Spark: Krea 2 Turbo NVFP4 (default) + Z-Image Turbo NVFP4 (draft).
POST /v1/images/generations -> b64_json
Binds 127.0.0.1 by default (override ABLITERATED_IMAGE_HOST for Docker).

Does not download models unless you call generate (diffusers will fetch if missing).
Set ABLITERATED_IMAGE_MOCK=1 for a tiny PNG stub without GPU/weights.
"""
from __future__ import annotations

import base64
import io
import os
import time
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

from spark_models import (
    DRAFT_MODEL_ID,
    QUALITY_MODEL_ID,
    resolve_model_id,
    workflow_for,
)
from uncensored_flux import generate_png_bytes, load_pipe, strip_safety

HOST = os.environ.get("ABLITERATED_IMAGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("ABLITERATED_IMAGE_PORT", "7860"))
MOCK = os.environ.get("ABLITERATED_IMAGE_MOCK", "").strip() in ("1", "true", "yes")
COMFY_URL = os.environ.get("COMFY_URL", "").strip().rstrip("/")
COMFY_WORKFLOW = os.environ.get("COMFY_WORKFLOW", "").strip()
NEGATIVE = os.environ.get("COMFY_NEGATIVE", "")
MODEL_ID = QUALITY_MODEL_ID

app = FastAPI(title="abliterated-spark-image", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_progress_lock = __import__("threading").Lock()
_progress = {"progress": 0, "status": "idle", "prompt": ""}


def set_progress(progress: float, status: str = "running", prompt: str = "") -> None:
    with _progress_lock:
        _progress["progress"] = max(0, min(100, float(progress)))
        _progress["status"] = status
        if prompt:
            _progress["prompt"] = prompt[:200]


def get_progress() -> dict[str, Any]:
    with _progress_lock:
        return dict(_progress)



class ImageRequest(BaseModel):
    prompt: str
    model: Optional[str] = None
    n: int = Field(default=1, ge=1, le=4)
    size: str = "1024x1024"
    response_format: Optional[str] = "b64_json"


def parse_size(size: str) -> tuple[int, int]:
    try:
        w, h = size.lower().split("x")
        return max(64, int(w)), max(64, int(h))
    except Exception:
        return 1024, 1024


def mock_png_b64(prompt: str, w: int, h: int) -> str:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (min(w, 512), min(h, 512)), (24, 24, 28))
    draw = ImageDraw.Draw(img)
    draw.rectangle([8, 8, img.width - 8, img.height - 8], outline=(180, 180, 190))
    draw.text((16, 16), "abliterated-flux-klein MOCK", fill=(220, 220, 230))
    draw.text((16, 40), prompt[:80], fill=(160, 160, 170))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def ensure_pipe():
    pipe = load_pipe()
    strip_safety(pipe)
    return pipe


def resolve_device() -> str:
    if MOCK:
        return "cpu"
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


@app.get("/health")
def health():
    backend = "mock" if MOCK else ("comfy" if COMFY_URL else "diffusers")
    return {
        "ok": True,
        "model": MODEL_ID,
        "draftModel": DRAFT_MODEL_ID,
        "mock": MOCK,
        "backend": backend,
        "comfy": COMFY_URL or None,
        "uncensored": True,
        "device": "comfy" if COMFY_URL and not MOCK else resolve_device(),
    }


@app.get("/v1/progress")
@app.get("/progress")
def progress():
    return get_progress()


@app.get("/v1/models")
def models():
    return {
        "object": "list",
        "data": [
            {"id": QUALITY_MODEL_ID, "object": "model", "owned_by": "local"},
            {"id": DRAFT_MODEL_ID, "object": "model", "owned_by": "local"},
        ],
    }


@app.post("/v1/images/generations")
def generations(req: ImageRequest) -> dict[str, Any]:
    if not req.prompt.strip():
        raise HTTPException(400, "prompt required")
    w, h = parse_size(req.size)
    served = resolve_model_id(req.model)
    wf_path = str(workflow_for(served))
    data = []
    t0 = time.time()
    set_progress(1, "running", req.prompt)
    try:
        for i in range(req.n):
            if MOCK:
                # Short fake ramp so /v1/progress is useful during mock generates.
                for step in range(1, 6):
                    set_progress(step * 18, "running", req.prompt)
                    time.sleep(0.05)
                b64 = mock_png_b64(req.prompt, w, h)
            elif COMFY_URL:
                png = None
                try:
                    from comfy_client import generate_png

                    png = generate_png(
                        COMFY_URL,
                        req.prompt,
                        negative=NEGATIVE,
                        width=w,
                        height=h,
                        steps=int(os.environ.get("COMFY_STEPS", "8")),
                        workflow_path=COMFY_WORKFLOW or wf_path,
                        on_progress=lambda p: set_progress(p, "running", req.prompt),
                    )
                except Exception as comfy_exc:
                    print(f"ComfyUI uncensored workflow failed ({comfy_exc}); direct FLUX Klein")
                    set_progress(20, "running", req.prompt)
                if png is None:
                    steps = int(os.environ.get("FLUX_STEPS", "8"))

                    def _on_step_comfy_fb(pipe_obj, step_idx, timestep, callback_kwargs):  # type: ignore[no-untyped-def]
                        try:
                            set_progress(5 + (90 * float(step_idx + 1) / max(1, steps)), "running", req.prompt)
                        except Exception:
                            pass
                        return callback_kwargs

                    png = generate_png_bytes(
                        req.prompt,
                        width=w,
                        height=h,
                        steps=steps,
                        on_step=_on_step_comfy_fb,
                    )
                b64 = base64.b64encode(png).decode("ascii")
            else:
                steps = int(os.environ.get("FLUX_STEPS", "8"))

                def _on_step(pipe_obj, step_idx, timestep, callback_kwargs):  # type: ignore[no-untyped-def]
                    try:
                        set_progress(5 + (90 * float(step_idx + 1) / max(1, steps)), "running", req.prompt)
                    except Exception:
                        pass
                    return callback_kwargs

                ensure_pipe()
                png = generate_png_bytes(
                    req.prompt,
                    width=w,
                    height=h,
                    steps=steps,
                    on_step=_on_step,
                )
                b64 = base64.b64encode(png).decode("ascii")
            set_progress(95 if i + 1 < req.n else 100, "running" if i + 1 < req.n else "done", req.prompt)
            data.append({"b64_json": b64})
        set_progress(100, "done", req.prompt)
        return {
            "created": int(t0),
            "model": served,
            "data": data,
        }
    except Exception:
        set_progress(0, "error", req.prompt)
        raise


if __name__ == "__main__":
    print(f"abliterated image bridge http://{HOST}:{PORT}/v1 model={MODEL_ID} mock={MOCK}")
    uvicorn.run(app, host=HOST, port=PORT)
