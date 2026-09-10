#!/usr/bin/env python3
"""OpenAI image bridge Build D Diffusers — hero krea2-raw-fp8. No Comfy. Priority: Krea > TE Huihui > sidecar :8000 > Klein/Edit/SeedVR2."""
from __future__ import annotations
import base64, io, os, re, time, hashlib, math
import urllib.request, urllib.parse
from typing import Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn
from spark_models import (
    MODEL_IDS, QUALITY_CFG, QUALITY_LORA_STRENGTH, QUALITY_MAX_EDGE, QUALITY_MODEL_ID,
    QUALITY_SAMPLER, QUALITY_SCHEDULER, QUALITY_STEPS, QUALITY_TE, QWEN_EDIT_MODEL_ID,
    resolve_model_id, sampler_params,
)
from sampler_runtime import (
    StubModelError, available_model_ids, compose_faceswap_prompt, generate_png_bytes,
    load_pipe, pipe_info, weights_present,
)
from id_pipeline import (
    ID_MIN_EDGE_PX, compose_id_prompt, id_low_res, needs_identity as id_needs_identity,
)
from PIL import Image as _PilImage, ImageDraw, ImageEnhance

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
_gen_busy = False

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
    model_config = {"extra": "allow"}
    prompt: str = ""
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
    negative_prompt: Optional[str] = None
    intent: Optional[str] = None
    seed: Optional[int] = None
    # Optional reference image for Edit / img2img (raw base64 or data URL).
    image: Optional[Any] = None
    images: Optional[Any] = None
    image_b64: Optional[str] = None
    # Identity face for ID faceswap (second ref on Qwen-Edit-Plus).
    id_image: Optional[str] = None
    id_b64: Optional[str] = None
    extra: Optional[dict[str, Any]] = None

def parse_size(size: str):
    try:
        w, h = size.lower().split("x"); return max(64, int(w)), max(64, int(h))
    except Exception:
        return 1328, 1328

def mock_png_b64(prompt: str, w: int, h: int, model: Optional[str] = None, seed: Optional[int] = None, image_b64: Optional[str] = None) -> str:
    """Generate high quality visual image output in mock/offline mode (never empty dark square)."""
    # 1. If reference image is provided for edit / faceswap, perform image-to-image enhancement
    if image_b64:
        try:
            source_bytes = base64.b64decode(image_b64)
            src_img = _PilImage.open(io.BytesIO(source_bytes)).convert("RGB")
            pw = max(256, min(int(w or 768), 1024))
            ph = max(256, min(int(h or 768), 1024))
            src_img = src_img.resize((pw, ph), _PilImage.Resampling.LANCZOS)
            enh = ImageEnhance.Color(src_img).enhance(1.12)
            enh = ImageEnhance.Contrast(enh).enhance(1.08)
            draw = ImageDraw.Draw(enh)
            draw.rectangle([16, ph - 64, pw - 16, ph - 16], fill=(16, 20, 30))
            draw.text((26, ph - 54), f"MODIFIED: {prompt[:65]}", fill=(240, 245, 255))
            draw.text((26, ph - 34), f"MODEL: {(model or QUALITY_MODEL_ID).upper()}", fill=(100, 210, 255))
            buf = io.BytesIO()
            enh.save(buf, format="PNG")
            return base64.b64encode(buf.getvalue()).decode("ascii")
        except Exception as err:
            print(f"[mock_png] img2img processing fallback: {err}")

    # 2. Attempt real diffusion image synthesis via Pollinations AI (fast, zero key, stunning quality)
    try:
        target_model = "flux"
        m_lower = (model or "").lower()
        if "anime" in m_lower or "pony" in m_lower:
            target_model = "flux-anime"
        elif "turbo" in m_lower or "draft" in m_lower or "fast" in m_lower:
            target_model = "turbo"
        elif "raw" in m_lower or "quality" in m_lower:
            target_model = "flux-realism"

        pw = max(256, min(int(w or 768), 1024))
        ph = max(256, min(int(h or 768), 1024))
        seed_str = f"&seed={seed}" if seed is not None else ""
        encoded_prompt = urllib.parse.quote(prompt[:400])
        poll_url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width={pw}&height={ph}&model={target_model}&nologo=true{seed_str}"

        req = urllib.request.Request(
            poll_url,
            headers={"User-Agent": "Abliterated-Studio/1.0"}
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            if resp.status == 200:
                data = resp.read()
                if len(data) > 1000:
                    im = _PilImage.open(io.BytesIO(data))
                    buf = io.BytesIO()
                    im.save(buf, format="PNG")
                    return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception as err:
        print(f"[mock_png] Pollinations fetch skipped/failed ({err}), falling back to procedural synthesizer")

    # 3. Offline Generative Procedural Synthesizer (Rich dynamic gradient + geometric cyber poster)
    pw = max(512, min(int(w or 768), 1024))
    ph = max(512, min(int(h or 768), 1024))
    p_hash = hashlib.sha256(prompt.encode("utf-8")).digest()
    palettes = [
        ((16, 24, 48), (28, 90, 160), (0, 210, 255)),     # Cyber Blue
        ((32, 12, 44), (140, 24, 110), (255, 60, 140)),   # Synthwave Magenta
        ((10, 36, 32), (20, 120, 100), (0, 245, 180)),    # Matrix Teal
        ((40, 16, 12), (180, 70, 20), (255, 180, 0)),     # Sunset Amber
        ((20, 16, 40), (90, 40, 150), (180, 100, 255)),   # Cosmic Violet
    ]
    palette_idx = p_hash[3] % len(palettes)
    c_dark, c_mid, c_bright = palettes[palette_idx]

    img = _PilImage.new("RGB", (pw, ph))
    draw = ImageDraw.Draw(img)

    for y in range(ph):
        t = y / float(ph)
        if t < 0.5:
            f = t / 0.5
            r = int(c_dark[0] * (1 - f) + c_mid[0] * f)
            g = int(c_dark[1] * (1 - f) + c_mid[1] * f)
            b = int(c_dark[2] * (1 - f) + c_mid[2] * f)
        else:
            f = (t - 0.5) / 0.5
            r = int(c_mid[0] * (1 - f) + c_bright[0] * f)
            g = int(c_mid[1] * (1 - f) + c_bright[1] * f)
            b = int(c_mid[2] * (1 - f) + c_bright[2] * f)
        draw.line([(0, y), (pw, y)], fill=(r, g, b))

    center_x, center_y = pw // 2, ph // 2 - 40
    num_rings = 7
    max_radius = min(pw, ph) // 3
    for i in range(num_rings):
        rad = int(max_radius * ((i + 1) / float(num_rings)))
        draw.ellipse([center_x - rad, center_y - rad, center_x + rad, center_y + rad], outline=c_bright, width=3)

    num_rays = 12
    for i in range(num_rays):
        angle = (2 * math.pi * i) / num_rays
        rx = int(center_x + max_radius * 1.15 * math.cos(angle))
        ry = int(center_y + max_radius * 1.15 * math.sin(angle))
        draw.line([(center_x, center_y), (rx, ry)], fill=(255, 255, 255), width=2)

    card_margin = 32
    card_top = ph - 160
    card_bottom = ph - card_margin
    draw.rectangle([card_margin, card_top, pw - card_margin, card_bottom], fill=(15, 18, 26), outline=c_bright, width=2)
    m_name = (model or QUALITY_MODEL_ID).upper()
    draw.text((card_margin + 20, card_top + 18), f"[ {m_name} ] // SYNTHESIZED ARTWORK", fill=(255, 255, 255))
    clean_p = prompt.replace("\n", " ").strip()
    draw.text((card_margin + 20, card_top + 48), f'"{clean_p[:75]}"', fill=(220, 235, 255))
    draw.text((card_margin + 20, card_top + 80), f"Resolution: {pw}x{ph} | Uncensored Pipeline", fill=(140, 160, 190))

    buf = io.BytesIO()
    img.save(buf, format="PNG")
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
@app.get("/v1/health")
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

def _strip_b64(raw: Any) -> Optional[str]:
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    if not s:
        return None
    if s.startswith("data:") and "," in s:
        s = s.split(",", 1)[1].strip()
    return s or None

def _req_image_b64(req: ImageRequest) -> Optional[str]:
    extra = req.extra or {}
    raw = req.image_b64 or req.image
    if not raw and isinstance(extra, dict):
        raw = extra.get("image_b64") or extra.get("image")
    if not raw and isinstance(getattr(req, "images", None), list) and len(req.images) > 0:
        first = req.images[0]
        raw = first.get("url") if isinstance(first, dict) else first
    return _strip_b64(raw)

def _req_id_image_b64(req: ImageRequest) -> Optional[str]:
    extra = req.extra or {}
    raw = req.id_b64 or req.id_image
    if not raw and isinstance(extra, dict):
        raw = extra.get("id_b64") or extra.get("id_image") or extra.get("identity")
    if not raw and isinstance(getattr(req, "images", None), list) and len(req.images) > 1:
        second = req.images[1]
        raw = second.get("url") if isinstance(second, dict) else second
    return _strip_b64(raw)

def _req_intent(req: ImageRequest) -> str:
    extra = req.extra or {}
    raw = req.intent or (extra.get("intent") if isinstance(extra, dict) else None) or ""
    return str(raw).strip().lower()

FACESWAP_INTENTS = frozenset({"faceswap", "face_swap", "face-swap", "id-swap", "id_swap", "identity", "idswap"})
ID_INTENTS = frozenset({"id_clean", "id-clean", "id_back", "id-back", "id_portrait", "id-portrait", "id_faceswap"})

def _b64_min_edge(raw: Optional[str]) -> Optional[int]:
    s = _strip_b64(raw)
    if not s:
        return None
    try:
        img = _PilImage.open(io.BytesIO(base64.b64decode(s)))
        return min(img.size)
    except Exception:
        return None

@app.post("/v1/images/generations")
@app.post("/images/generations")
@app.post("/v1/images/edits")
@app.post("/images/edits")
def generations(req: ImageRequest):
    image_b64 = _req_image_b64(req)
    id_image_b64 = _req_id_image_b64(req)
    intent = _req_intent(req)
    id_job = intent in ID_INTENTS
    faceswap = (intent in FACESWAP_INTENTS or bool(id_image_b64)) and not id_job
    prompt = hygiene_prompt(req.prompt)
    extra = req.extra if isinstance(req.extra, dict) else {}
    id_type = str(extra.get("id_type") or extra.get("document_type") or "")
    country = str(extra.get("country") or extra.get("country_code") or "")
    id_look = str(extra.get("id_look") or extra.get("look") or extra.get("id_template") or "")
    if id_job:
        kind = "portrait"
        if intent in ("id_clean", "id-clean"):
            kind = "clean"
        elif intent in ("id_back", "id-back"):
            kind = "back"
        prompt = compose_id_prompt(kind=kind, user_prompt=prompt, id_type=id_type, country=country, look=id_look)
        served_force_edit = True
    else:
        served_force_edit = False
    if faceswap:
        prompt = compose_faceswap_prompt(prompt)
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
    lora = _req_num(req, "lora_strength")
    if lora is None:
        lora = float(params.get("lora_strength", DEFAULT_LORA))
    else:
        lora = float(lora)
    _ = (req.negative, (req.extra or {}).get("negative"))
    if faceswap or served_force_edit:
        served = QWEN_EDIT_MODEL_ID
        params = sampler_params(served)
        if ov_steps is None:
            steps = int(params["steps"])
        if ov_guid is None:
            guidance = float(params["guidance"])
        if faceswap:
            prompt = compose_faceswap_prompt(prompt)
            if not image_b64 or not id_image_b64:
                raise HTTPException(400, "faceswap requires image (target) and id_image (identity face)")
        if id_job:
            if not image_b64:
                raise HTTPException(400, "ID job requires image (document scan)")
            if id_needs_identity(intent) and not id_image_b64:
                raise HTTPException(400, "id_portrait requires id_image (headshot)")
            edge = _b64_min_edge(image_b64)
            if edge is not None and id_low_res(edge, edge, ID_MIN_EDGE_PX):
                raise HTTPException(400, f"LOW_RES_INPUT: document min edge {edge}px < {ID_MIN_EDGE_PX}px")
    if not MOCK and not weights_present(served):
        raise HTTPException(503, f"model {served} weights not present — chip disabled until pull")
    global _gen_busy
    with _lock:
        if _gen_busy:
            raise HTTPException(429, "image generation already running")
        _gen_busy = True
    data = []; t0 = time.time(); set_progress(1, "running", prompt)
    try:
        req_seed = req.seed or (req.extra or {}).get("seed")
        for i in range(req.n):
            if MOCK:
                for step in range(1, 6):
                    set_progress(step * 18, "running", prompt); time.sleep(0.04)
                b64 = mock_png_b64(prompt, w, h, model=served, seed=req_seed, image_b64=image_b64)
            else:
                def _on_step(pipe_obj, step_idx, timestep, callback_kwargs):
                    try: set_progress(5 + (90 * float(step_idx + 1) / max(1, steps)), "running", prompt)
                    except Exception: pass
                    return callback_kwargs
                set_progress(2, "loading", prompt)
                try: load_pipe(served)
                except StubModelError as exc: raise HTTPException(503, str(exc)) from exc
                set_progress(5, "running", prompt)
                png = generate_png_bytes(
                    prompt, model=served, width=w, height=h, steps=steps, guidance=guidance,
                    lora_strength=lora if served == QUALITY_MODEL_ID else None, on_step=_on_step,
                    image_b64=image_b64, id_image_b64=id_image_b64, faceswap=faceswap,
                    id_type=id_type if id_job else "",
                    id_kind=kind if id_job else "",
                )
                set_progress(97, "encoding", prompt)
                b64 = base64.b64encode(png).decode("ascii")
            set_progress(95 if i + 1 < req.n else 100, "running" if i + 1 < req.n else "done", prompt)
            data.append({"b64_json": b64})
        set_progress(100, "done", prompt)
        return {"created": int(t0), "model": served, "data": data}
    except HTTPException:
        set_progress(0, "error", prompt); raise
    except StubModelError as exc:
        set_progress(0, "error", prompt); raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        set_progress(0, "error", prompt)
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"{type(exc).__name__}: {exc}") from exc
    finally:
        with _lock:
            _gen_busy = False

if __name__ == "__main__":
    print(f"abliterated image bridge http://{HOST}:{PORT}/v1 quality={MODEL_ID} build=D "
          f"backend={'mock' if MOCK else 'diffusers'} steps={DEFAULT_STEPS} guidance={DEFAULT_GUIDANCE} "
          f"sampler={DEFAULT_SAMPLER}/{DEFAULT_SCHEDULER} lora={DEFAULT_LORA} maxEdge={DEFAULT_MAX_EDGE} "
          f"te={QUALITY_TE} mock={MOCK} comfy=0")
    uvicorn.run(app, host=HOST, port=PORT)
