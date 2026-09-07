#!/usr/bin/env python3
"""
OpenAI-compatible image bridge for Spark — Build D (DGX Spark 128GB resident).
  Quality default: Krea 2 RAW FP8 + uncensor LoRA @ 0.75 (24 steps, CFG 3.5, euler/beta)
  Klein:           FLUX.2 Klein 9B base (stub until weights land)
  Fast:            Krea 2 Turbo NVFP4 / INT8 (8-step CFG1)
  Draft:           Z-Image Turbo NVFP4
POST /v1/images/generations -> b64_json
Binds 127.0.0.1 by default (override ABLITERATED_IMAGE_HOST for Docker).

Set ABLITERATED_IMAGE_MOCK=1 for a tiny PNG stub without GPU/weights.
Klein/diffusers fallback only when ABLITERATED_IMAGE_ALLOW_KLEIN_FALLBACK=1.
"""
from __future__ import annotations

import base64
import io
import os
import re
import time
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

from spark_models import (
    DRAFT_MODEL_ID,
    FAST_INT8_MODEL_ID,
    FAST_MODEL_ID,
    KLEIN_MODEL_ID,
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
ALLOW_KLEIN_FALLBACK = os.environ.get("ABLITERATED_IMAGE_ALLOW_KLEIN_FALLBACK", "").strip() in (
    "1",
    "true",
    "yes",
)
MODEL_ID = QUALITY_MODEL_ID

app = FastAPI(title="abliterated-spark-image", version="0.4.0")
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


def hygiene_prompt(prompt: str) -> str:
    """Light prompt hygiene only — trim and collapse whitespace. No safety/refusal text."""
    return re.sub(r"[ \t]+", " ", (prompt or "").strip())


class ImageRequest(BaseModel):
    prompt: str
    model: Optional[str] = None
    n: int = Field(default=1, ge=1, le=4)
    size: str = "1328x1328"
    response_format: Optional[str] = "b64_json"


def parse_size(size: str) -> tuple[int, int]:
    try:
        w, h = size.lower().split("x")
        return max(64, int(w)), max(64, int(h))
    except Exception:
        return 1328, 1328


def mock_png_b64(prompt: str, w: int, h: int) -> str:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (min(w, 512), min(h, 512)), (24, 24, 28))
    draw = ImageDraw.Draw(img)
    draw.rectangle([8, 8, img.width - 8, img.height - 8], outline=(180, 180, 190))
    draw.text((16, 16), "krea2-raw-fp8 MOCK", fill=(220, 220, 230))
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


def sampler_params(model_id: str) -> dict[str, Any]:
    """RAW quality uses 24/CFG3.5/euler/beta; turbo/draft use 8/CFG1/euler/simple."""
    env_steps = os.environ.get("COMFY_STEPS", "").strip()
    env_cfg = os.environ.get("COMFY_CFG", "").strip()
    env_sampler = os.environ.get("COMFY_SAMPLER", "").strip()
    env_sched = os.environ.get("COMFY_SCHEDULER", "").strip()
    env_lora = os.environ.get("COMFY_LORA_STRENGTH", "").strip()

    if model_id in (FAST_MODEL_ID, FAST_INT8_MODEL_ID, DRAFT_MODEL_ID):
        base = {
            "steps": 8,
            "cfg": 1.0,
            "sampler_name": "euler",
            "scheduler": "simple",
            "lora_strength": 0.65,
        }
    elif model_id == KLEIN_MODEL_ID:
        base = {
            "steps": 28,
            "cfg": 3.5,
            "sampler_name": "euler",
            "scheduler": "beta",
            "lora_strength": 0.7,
        }
    else:
        base = {
            "steps": 24,
            "cfg": 3.5,
            "sampler_name": "euler",
            "scheduler": "beta",
            "lora_strength": 0.75,
        }

    if env_steps:
        base["steps"] = int(env_steps)
    if env_cfg:
        base["cfg"] = float(env_cfg)
    if env_sampler:
        base["sampler_name"] = env_sampler
    if env_sched:
        base["scheduler"] = env_sched
    if env_lora:
        base["lora_strength"] = float(env_lora)
    return base


@app.get("/health")
def health():
    backend = "mock" if MOCK else ("comfy" if COMFY_URL else "diffusers")
    return {
        "ok": True,
        "model": MODEL_ID,
        "kleinModel": KLEIN_MODEL_ID,
        "fastModel": FAST_MODEL_ID,
        "draftModel": DRAFT_MODEL_ID,
        "build": "D",
        "mock": MOCK,
        "backend": backend,
        "comfy": COMFY_URL or None,
        "uncensored": True,
        "device": "comfy" if COMFY_URL and not MOCK else resolve_device(),
        "defaultSteps": sampler_params(QUALITY_MODEL_ID)["steps"],
        "defaultCfg": sampler_params(QUALITY_MODEL_ID)["cfg"],
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
            {"id": KLEIN_MODEL_ID, "object": "model", "owned_by": "local"},
            {"id": FAST_MODEL_ID, "object": "model", "owned_by": "local"},
            {"id": FAST_INT8_MODEL_ID, "object": "model", "owned_by": "local"},
            {"id": DRAFT_MODEL_ID, "object": "model", "owned_by": "local"},
        ],
    }


@app.post("/v1/images/generations")
def generations(req: ImageRequest) -> dict[str, Any]:
    prompt = hygiene_prompt(req.prompt)
    if not prompt:
        raise HTTPException(400, "prompt required")
    w, h = parse_size(req.size)
    served = resolve_model_id(req.model)
    wf_path = str(workflow_for(served))
    params = sampler_params(served)
    data = []
    t0 = time.time()
    set_progress(1, "running", prompt)
    try:
        for i in range(req.n):
            if MOCK:
                for step in range(1, 6):
                    set_progress(step * 18, "running", prompt)
                    time.sleep(0.05)
                b64 = mock_png_b64(prompt, w, h)
            elif COMFY_URL:
                png = None
                comfy_exc: Exception | None = None
                try:
                    from comfy_client import generate_png

                    png = generate_png(
                        COMFY_URL,
                        prompt,
                        negative=NEGATIVE,
                        width=w,
                        height=h,
                        steps=params["steps"],
                        cfg=params["cfg"],
                        sampler_name=params["sampler_name"],
                        scheduler=params["scheduler"],
                        lora_strength=params["lora_strength"],
                        workflow_path=COMFY_WORKFLOW or wf_path,
                        on_progress=lambda p: set_progress(p, "running", prompt),
                    )
                except Exception as exc:
                    comfy_exc = exc
                    print(f"ComfyUI workflow failed ({exc})")
                    set_progress(20, "running", prompt)
                if png is None:
                    if not ALLOW_KLEIN_FALLBACK:
                        detail = (
                            f"ComfyUI path failed for model={served} workflow={wf_path}: "
                            f"{comfy_exc}. Fix Comfy/weights, or set ABLITERATED_IMAGE_ALLOW_KLEIN_FALLBACK=1."
                        )
                        raise HTTPException(502, detail)
                    print("ABLITERATED_IMAGE_ALLOW_KLEIN_FALLBACK=1 — using FLUX Klein fallback")
                    fb_steps = int(os.environ.get("FLUX_STEPS", "8"))

                    def _on_step_comfy_fb(pipe_obj, step_idx, timestep, callback_kwargs):  # type: ignore[no-untyped-def]
                        try:
                            set_progress(5 + (90 * float(step_idx + 1) / max(1, fb_steps)), "running", prompt)
                        except Exception:
                            pass
                        return callback_kwargs

                    png = generate_png_bytes(
                        prompt,
                        width=w,
                        height=h,
                        steps=fb_steps,
                        on_step=_on_step_comfy_fb,
                    )
                b64 = base64.b64encode(png).decode("ascii")
            else:
                fb_steps = int(os.environ.get("FLUX_STEPS", "8"))

                def _on_step(pipe_obj, step_idx, timestep, callback_kwargs):  # type: ignore[no-untyped-def]
                    try:
                        set_progress(5 + (90 * float(step_idx + 1) / max(1, fb_steps)), "running", prompt)
                    except Exception:
                        pass
                    return callback_kwargs

                ensure_pipe()
                png = generate_png_bytes(
                    prompt,
                    width=w,
                    height=h,
                    steps=fb_steps,
                    on_step=_on_step,
                )
                b64 = base64.b64encode(png).decode("ascii")
            set_progress(95 if i + 1 < req.n else 100, "running" if i + 1 < req.n else "done", prompt)
            data.append({"b64_json": b64})
        set_progress(100, "done", prompt)
        return {
            "created": int(t0),
            "model": served,
            "data": data,
        }
    except HTTPException:
        set_progress(0, "error", prompt)
        raise
    except Exception:
        set_progress(0, "error", prompt)
        raise


if __name__ == "__main__":
    print(
        f"abliterated image bridge http://{HOST}:{PORT}/v1 "
        f"quality={MODEL_ID} klein={KLEIN_MODEL_ID} fast={FAST_MODEL_ID} "
        f"draft={DRAFT_MODEL_ID} build=D mock={MOCK}"
    )
    uvicorn.run(app, host=HOST, port=PORT)
