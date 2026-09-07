"""Spark image model ids — Build D (DGX Spark 128GB resident).

Quality (default): Krea 2 RAW FP8
Klein (adherence): FLUX.2 Klein 9B base (optional / stub)
Fast:              Krea 2 Turbo NVFP4 or INT8
Draft:             Z-Image Turbo NVFP4
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

QUALITY_MODEL_ID = "krea2-raw-fp8"
KLEIN_MODEL_ID = "flux2-klein-9b"
FAST_MODEL_ID = "krea2-turbo-nvfp4"
FAST_INT8_MODEL_ID = "krea2-turbo-int8"
DRAFT_MODEL_ID = "z-image-turbo-nsfw-nvfp4"

QUALITY_ALIASES = frozenset(
    {
        QUALITY_MODEL_ID,
        "krea2-raw",
        "krea2",
        "quality",
        "raw",
        "hero",
        "abliterated-flux-klein",
        "comfy-dreamshaper",
        "comfy-abliterated-flux",
    }
)
KLEIN_ALIASES = frozenset(
    {
        KLEIN_MODEL_ID,
        "klein",
        "klein-9b",
        "flux2-klein",
        "flux-klein-9b",
        "adherence",
    }
)
FAST_ALIASES = frozenset(
    {
        FAST_MODEL_ID,
        FAST_INT8_MODEL_ID,
        "fast",
        "turbo",
        "nvfp4",
        "int8",
        "krea2-turbo",
        "krea-2-turbo",
    }
)
DRAFT_ALIASES = frozenset(
    {
        DRAFT_MODEL_ID,
        "z-image-turbo-nvfp4",
        "z-image",
        "zimage",
        "draft",
        "sketch",
    }
)

_HERE = Path(__file__).resolve().parent
QUALITY_WORKFLOW = _HERE / "workflows" / "txt2img-krea2-raw-fp8.json"
QUALITY_WORKFLOW_NOLORA = _HERE / "workflows" / "txt2img-krea2-raw-fp8-nolor.json"
KLEIN_WORKFLOW = _HERE / "workflows" / "txt2img-flux2-klein-9b.json"
FAST_WORKFLOW = _HERE / "workflows" / "txt2img-krea2-turbo-nvfp4.json"
FAST_WORKFLOW_NOLORA = _HERE / "workflows" / "txt2img-krea2-turbo-nvfp4-nolor.json"
FAST_INT8_WORKFLOW = _HERE / "workflows" / "txt2img-krea2-turbo-int8.json"
FAST_INT8_WORKFLOW_NOLORA = _HERE / "workflows" / "txt2img-krea2-turbo-int8-nolor.json"
DRAFT_WORKFLOW = _HERE / "workflows" / "txt2img-zimage-turbo-nvfp4.json"


def resolve_model_id(requested: Optional[str]) -> str:
    name = (requested or "").strip().lower()
    if name in DRAFT_ALIASES:
        return DRAFT_MODEL_ID
    if name in KLEIN_ALIASES:
        return KLEIN_MODEL_ID
    if name in FAST_ALIASES:
        if name in {FAST_INT8_MODEL_ID, "int8"}:
            return FAST_INT8_MODEL_ID
        return FAST_MODEL_ID
    return QUALITY_MODEL_ID


def _lora_path() -> Path:
    comfy = Path(os.environ.get("COMFY_ROOT") or (Path.home() / "ComfyUI"))
    return comfy / "models" / "loras" / "krea2_uncensor.safetensors"


def workflow_for(model_id: str) -> Path:
    resolved = resolve_model_id(model_id)
    if resolved == DRAFT_MODEL_ID:
        return DRAFT_WORKFLOW
    if resolved == KLEIN_MODEL_ID:
        if KLEIN_WORKFLOW.is_file():
            return KLEIN_WORKFLOW
        # Fall back to quality graph until Klein workflow/weights land.
        return QUALITY_WORKFLOW if _lora_path().is_file() else QUALITY_WORKFLOW_NOLORA
    if resolved == FAST_INT8_MODEL_ID:
        if FAST_INT8_WORKFLOW.is_file() and _lora_path().is_file():
            return FAST_INT8_WORKFLOW
        if FAST_INT8_WORKFLOW_NOLORA.is_file():
            return FAST_INT8_WORKFLOW_NOLORA
        return FAST_WORKFLOW if _lora_path().is_file() else FAST_WORKFLOW_NOLORA
    if resolved == FAST_MODEL_ID:
        return FAST_WORKFLOW if _lora_path().is_file() else FAST_WORKFLOW_NOLORA
    return QUALITY_WORKFLOW if _lora_path().is_file() else QUALITY_WORKFLOW_NOLORA
