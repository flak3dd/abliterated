#!/usr/bin/env python3
"""OpenAI image bridge Build D Diffusers — hero krea2-raw-fp8. No Comfy. Priority: Krea > TE Huihui > sidecar :8000 > Klein/Edit/SeedVR2."""
from __future__ import annotations
import base64, io, os, re, time
from typing import Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn
from spark_models import (
    MODEL_IDS, QUALITY_CFG, QUALITY_LORA_STRENGTH, QUALITY_MAX_EDGE, QUALITY_MODEL_ID,
    QUALITY_SAMPLER, QUALITY_SCHEDULER, QUALITY_STEPS, QUALITY_TE, resolve_model_id, sampler_params,
)
from sampler_runtime import StubModelError, available_model_ids, generate_png_bytes, load_pipe, pipe_info, weights_present

HOST = os.environ.get("ABLITERATED_IMAGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("ABLITERATED_IMAGE_PORT", "7860"))
MOCK = os.environ.get("ABLITERATED_IMAGE_MOCK", "").strip() in ("1", "true", "yes")
MODEL_ID = (os.environ.get("FLUX_MODEL_ID") or os.environ.get("IMAGE_MODEL_ID") or QUALITY_MODEL_ID).strip() or QUALITY_MODEL_ID

def _env_int(keys, default):
    for k in keys:
        r = os.environ.get(k, "").strip()
        if r:
            try: return max(1, int(r))
            except ValueError: pass
    return default

def _env_float(keys, default):
    for k in keys:
        r = os.environ.get(k, "").strip()
        if r:
            try: return float(r)
            except ValueError: pass
    return default

DEFAULT_STEPS = _env_int(("SAMPLER_STEPS", "FLUX_STEPS"), QUALITY_STEPS)
DEFAULT_GUIDANCE = _env_float(("SAMPLER_GUIDANCE", "FLUX_GUIDANCE"), QUALITY_CFG)
DEFAULT_LORA = _env_float(("SAMPLER_LORA_STRENGTH",), QUALITY_LORA_STRENGTH)
DEFAULT_MAX_EDGE = _env_int(("SAMPLER_MAX_EDGE",), QUALITY_MAX_EDGE)
DEFAULT_SAMPLER = os.environ.get("SAMPLER_SAMPLER", QUALITY_SAMPLER).strip() or QUALITY_SAMPLER
DEFAULT_SCHEDULER = os.environ.get("SAMPLER_SCHEDULER", QUALITY_SCHEDULER).strip() or QUALITY_SCHEDULER

app = FastAPI(title="abliterated-spark-image", version="0.6.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
_lock = __import__("threading").Lock()
_progress = {"progress": 0, "status": "idle", "prompt": ""}

def set_progress(progress, status="running", prompt=""):
    with _lock:
        _progress["progress"] = max(0, min(100, float(progress)))
        _progress["status"] = status
        if prompt: _progress["prompt"] = prompt[:200]

def get_progress():
    with _lock: return dict(_progress)

def hygiene_prompt(prompt: str) -> str:
    return re.sub(r"[ \t]+", " ", (prompt or "").strip())

class ImageRequest(BaseModel):
    prompt: str
    model: Optional[str] = None
    n: int = Field(default=1, ge=1, le=4)
    size: str = "1328x1328"
    response_format: Optional[str] = "b64_json"
    # Optional sampler / path overrides from IDE (also accepted nested under extra).
    steps: Optional[int] = None
    guidance: Optional[float] = None
    guidance_scale: Optional[float] = None
    lora_strength: Optional[float] = None
    negative: Optional[str] = None
    intent: Optional[str] = None
    # Optional reference image for Edit / img2img (raw base64 or data URL).
    image: Optional[str] = None
    image_b64: Optional[str] = None
    extra: Optional[dict[str, Any]] = None

def parse_size(size: str):
    try:
        w, h = size.lower().split("x"); return max(64, int(w)), max(64, int(h))
    except Exception:
        return 1328, 1328

def mock_png_b64(prompt, w, h):
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (min(w, 512), min(h, 512)), (24, 24, 28))
    draw = ImageDraw.Draw(img)
    draw.text((16, 16), f"{QUALITY_MODEL_ID} MOCK", fill=(220, 220, 230))
    draw.text((16, 40), prompt[:80], fill=(160, 160, 170))
    buf = io.BytesIO(); img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")

def resolve_device():
    if MOCK: return "cpu"
    try:
        import torch
        if torch.cuda.is_available(): return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available(): return "mps"
    except Exception: pass
    return "cpu"

@app.get("/health")
def health():
    params = sampler_params(MODEL_ID)
    avail = list(MODEL_IDS) if MOCK else available_model_ids()
    return {
        "ok": True, "model": MODEL_ID, "qualityModel": QUALITY_MODEL_ID, "build": "D",
        "mock": MOCK, "backend": "mock" if MOCK else "diffusers",
        "pipelineClass": params.get("pipeline_class"), "uncensored": True,
        "huihuiTe": QUALITY_TE, "loraStrength": DEFAULT_LORA, "sampler": DEFAULT_SAMPLER,
        "scheduler": DEFAULT_SCHEDULER, "maxEdge": DEFAULT_MAX_EDGE, "device": resolve_device(),
        "defaultSteps": DEFAULT_STEPS, "defaultGuidance": DEFAULT_GUIDANCE,
        "pipe": pipe_info(MODEL_ID) if not MOCK else {}, "comfy": False,
        "promptLlmPort": 8000, "promptLlmModel": "qwen-abliterated",
        "availableModels": avail,
        "priority": ["krea2-raw-fp8", "huihui-te", "qwen-abliterated:8000", "flux2-klein-9b", "qwen-edit-2511-fp8", "seedvr2-7b-fp8"],
    }

@app.get("/v1/progress")
@app.get("/progress")
def progress(): return get_progress()

@app.get("/v1/models")
def models():
    data = []
    for m in MODEL_IDS:
        ok = True if MOCK else weights_present(m)
        # Only mark models that can actually load (weights present). Unavailable stay listed with available=false for UI probes.
        data.append({
            "id": m,
            "object": "model",
            "owned_by": "local",
            "available": ok,
            "ready": ok,
        })
    return {
        "object": "list",
        "data": data,
        "available": [d["id"] for d in data if d.get("available")],
    }

def _req_num(req: ImageRequest, *keys):
    extra = req.extra or {}
    for k in keys:
        v = getattr(req, k, None)
        if v is None and isinstance(extra, dict):
            v = extra.get(k)
        if v is None: continue
        try:
            return float(v) if any(x in k for x in ("guidance", "lora", "cfg")) else int(v)
        except (TypeError, ValueError):
            continue
    return None

def _req_image_b64(req: ImageRequest) -> Optional[str]:
    """Pull reference image base64 from top-level or extra (strip data: URL prefix)."""
    extra = req.extra or {}
    raw = req.image_b64 or req.image
    if not raw and isinstance(extra, dict):
        raw = extra.get("image_b64") or extra.get("image")
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    if not s:
        return None
    if s.startswith("data:") and "," in s:
        s = s.split(",", 1)[1].strip()
    return s or None


@app.post("/v1/images/generations")
def generations(req: ImageRequest):
    prompt = hygiene_prompt(req.prompt)
    if not prompt: raise HTTPException(400, "prompt required")
    w, h = parse_size(req.size)
    served = resolve_model_id(req.model)
    params = sampler_params(served)
    steps = DEFAULT_STEPS if served == QUALITY_MODEL_ID else int(params["steps"])
    guidance = DEFAULT_GUIDANCE if served == QUALITY_MODEL_ID else float(params["guidance"])
    ov_steps = _req_num(req, "steps")
    ov_guid = _req_num(req, "guidance", "guidance_scale")
    if ov_steps is not None: steps = max(1, int(ov_steps))
    if ov_guid is not None: guidance = float(ov_guid)
    if os.environ.get("SAMPLER_STEPS", "").strip(): steps = DEFAULT_STEPS
    if os.environ.get("SAMPLER_GUIDANCE", "").strip(): guidance = DEFAULT_GUIDANCE
    # Per-request lora_strength (Quality path). Fall back to model/env default.
    lora = _req_num(req, "lora_strength")
    if lora is None:
        lora = float(params.get("lora_strength", DEFAULT_LORA))
    else:
        lora = float(lora)
    # intent/negative accepted for contract/forward-compat.
    _ = (req.intent, req.negative, (req.extra or {}).get("intent"), (req.extra or {}).get("negative"))
    image_b64 = _req_image_b64(req)
    if not MOCK and not weights_present(served):
        raise HTTPException(503, f"model {served} weights not present — chip disabled until pull")
    data = []; t0 = time.time(); set_progress(1, "running", prompt)
    try:
        for i in range(req.n):
            if MOCK:
                for step in range(1, 6):
                    set_progress(step * 18, "running", prompt); time.sleep(0.05)
                b64 = mock_png_b64(prompt, w, h)
            else:
                def _on_step(pipe_obj, step_idx, timestep, callback_kwargs):
                    try: set_progress(5 + (90 * float(step_idx + 1) / max(1, steps)), "running", prompt)
                    except Exception: pass
                    return callback_kwargs
                try: load_pipe(served)
                except StubModelError as exc: raise HTTPException(503, str(exc)) from exc
                png = generate_png_bytes(
                    prompt, model=served, width=w, height=h, steps=steps, guidance=guidance,
                    lora_strength=lora if served == QUALITY_MODEL_ID else None, on_step=_on_step,
                    image_b64=image_b64,
                )
                b64 = base64.b64encode(png).decode("ascii")
            set_progress(95 if i + 1 < req.n else 100, "running" if i + 1 < req.n else "done", prompt)
            data.append({"b64_json": b64})
        set_progress(100, "done", prompt)
        return {"created": int(t0), "model": served, "data": data}
    except HTTPException:
        set_progress(0, "error", prompt); raise
    except StubModelError as exc:
        set_progress(0, "error", prompt); raise HTTPException(503, str(exc)) from exc
    except Exception:
        set_progress(0, "error", prompt); raise

if __name__ == "__main__":
    print(f"abliterated image bridge http://{HOST}:{PORT}/v1 quality={MODEL_ID} build=D "
          f"backend={'mock' if MOCK else 'diffusers'} steps={DEFAULT_STEPS} guidance={DEFAULT_GUIDANCE} "
          f"sampler={DEFAULT_SAMPLER}/{DEFAULT_SCHEDULER} lora={DEFAULT_LORA} maxEdge={DEFAULT_MAX_EDGE} "
          f"te={QUALITY_TE} mock={MOCK} comfy=0")
    uvicorn.run(app, host=HOST, port=PORT)
