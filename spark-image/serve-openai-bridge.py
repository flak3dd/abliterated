#!/usr/bin/env python3
"""
OpenAI-compatible image bridge for abliterated FLUX.2 Klein.
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

HOST = os.environ.get("ABLITERATED_IMAGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("ABLITERATED_IMAGE_PORT", "7860"))
MODEL_ID = os.environ.get("FLUX_MODEL_ID", "abliterated-flux-klein")
BASE_REPO = os.environ.get("FLUX_BASE_REPO", "black-forest-labs/FLUX.2-klein-base-4B")
ENC_REPO = os.environ.get(
    "FLUX_TEXT_ENCODER_REPO",
    "PinoCookie/Flux.2-klein-4B-abliterated-text-encoder",
)
DTYPE = os.environ.get("FLUX_DTYPE", "bfloat16")
MOCK = os.environ.get("ABLITERATED_IMAGE_MOCK", "").strip() in ("1", "true", "yes")

app = FastAPI(title="abliterated-flux-klein", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_pipe = None
_pipe = None
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


def load_pipe():
    global _pipe
    if _pipe is not None:
        return _pipe
    import torch

    dtype = {
        "bfloat16": torch.bfloat16,
        "float16": torch.float16,
        "fp16": torch.float16,
        "fp32": torch.float32,
    }.get(DTYPE.lower(), torch.bfloat16)

    # Prefer pipeline API; fall back patterns differ by diffusers version.
    pipe = None
    try:
        from diffusers import Flux2KleinPipeline

        pipe = Flux2KleinPipeline.from_pretrained(BASE_REPO, torch_dtype=dtype)
    except Exception as exc:
        print(f"Flux2KleinPipeline unavailable ({exc}); trying Flux2Pipeline/DiffusionPipeline")
    if pipe is None:
        try:
            from diffusers import Flux2Pipeline

            pipe = Flux2Pipeline.from_pretrained(BASE_REPO, torch_dtype=dtype)
        except Exception as exc:
            print(f"Flux2Pipeline unavailable ({exc}); trying DiffusionPipeline")
            from diffusers import DiffusionPipeline

            pipe = DiffusionPipeline.from_pretrained(BASE_REPO, torch_dtype=dtype)

    # Swap / attach abliterated text encoder when the pipeline exposes it.
    try:
        from transformers import AutoModel, AutoTokenizer

        # Best-effort: many Flux2 Klein builds accept text_encoder override via components.
        te = AutoModel.from_pretrained(ENC_REPO, torch_dtype=dtype)
        if hasattr(pipe, "text_encoder"):
            pipe.text_encoder = te
        print(f"loaded abliterated text encoder from {ENC_REPO}")
    except Exception as exc:
        print(f"warning: could not swap text encoder ({exc}); using base encoder")

    if torch.cuda.is_available():
        pipe = pipe.to("cuda")
        print("device: cuda")
    elif getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        # MPS is flaky with bfloat16; prefer float16 when dtype was bf16.
        if dtype == torch.bfloat16:
            try:
                pipe = pipe.to(dtype=torch.float16)
                print("mps: converted bfloat16 -> float16")
            except Exception as exc:
                print(f"warning: could not convert pipe to float16 ({exc})")
        pipe = pipe.to("mps")
        print("device: mps")
    else:
        print("device: cpu")
    _pipe = pipe
    return _pipe


def image_to_b64(img) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


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
    return {"ok": True, "model": MODEL_ID, "mock": MOCK, "device": resolve_device()}


@app.get("/v1/progress")
@app.get("/progress")
def progress():
    return get_progress()


@app.get("/v1/models")
def models():
    return {
        "object": "list",
        "data": [{"id": MODEL_ID, "object": "model", "owned_by": "local"}],
    }


@app.post("/v1/images/generations")
def generations(req: ImageRequest) -> dict[str, Any]:
    if not req.prompt.strip():
        raise HTTPException(400, "prompt required")
    w, h = parse_size(req.size)
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
            else:
                pipe = load_pipe()
                steps = int(os.environ.get("FLUX_STEPS", "8"))

                def _on_step(pipe_obj, step_idx, timestep, callback_kwargs):  # type: ignore[no-untyped-def]
                    try:
                        set_progress(5 + (90 * float(step_idx + 1) / max(1, steps)), "running", req.prompt)
                    except Exception:
                        pass
                    return callback_kwargs

                kwargs = dict(
                    prompt=req.prompt,
                    width=w,
                    height=h,
                    num_inference_steps=steps,
                    guidance_scale=float(os.environ.get("FLUX_GUIDANCE", "1.0")),
                )
                try:
                    out = pipe(**kwargs, callback_on_step_end=_on_step)
                except TypeError:
                    set_progress(40, "running", req.prompt)
                    out = pipe(**kwargs)
                image = out.images[0]
                b64 = image_to_b64(image)
            set_progress(95 if i + 1 < req.n else 100, "running" if i + 1 < req.n else "done", req.prompt)
            data.append({"b64_json": b64})
        set_progress(100, "done", req.prompt)
        return {
            "created": int(t0),
            "model": req.model or MODEL_ID,
            "data": data,
        }
    except Exception:
        set_progress(0, "error", req.prompt)
        raise


if __name__ == "__main__":
    print(f"abliterated image bridge http://{HOST}:{PORT}/v1 model={MODEL_ID} mock={MOCK}")
    uvicorn.run(app, host=HOST, port=PORT)
