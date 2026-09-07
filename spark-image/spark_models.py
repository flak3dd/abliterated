"""Spark image model ids: quality (Krea 2 Turbo NVFP4) vs draft (Z-Image Turbo NVFP4)."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

QUALITY_MODEL_ID = "krea2-turbo-nvfp4"
DRAFT_MODEL_ID = "z-image-turbo-nsfw-nvfp4"

QUALITY_ALIASES = frozenset(
    {
        QUALITY_MODEL_ID,
        "abliterated-flux-klein",
        "comfy-dreamshaper",
        "comfy-abliterated-flux",
        "krea2",
        "krea-2-turbo",
        "krea2-turbo",
        "quality",
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
QUALITY_WORKFLOW = _HERE / "workflows" / "txt2img-krea2-turbo-nvfp4.json"
DRAFT_WORKFLOW = _HERE / "workflows" / "txt2img-zimage-turbo-nvfp4.json"
QUALITY_WORKFLOW_NOLORA = _HERE / "workflows" / "txt2img-krea2-turbo-nvfp4-nolor.json"


def resolve_model_id(requested: Optional[str]) -> str:
    name = (requested or "").strip().lower()
    if name in DRAFT_ALIASES:
        return DRAFT_MODEL_ID
    return QUALITY_MODEL_ID


def _lora_path() -> Path:
    comfy = Path(os.environ.get("COMFY_ROOT") or (Path.home() / "ComfyUI"))
    return comfy / "models" / "loras" / "krea2_uncensor.safetensors"


def workflow_for(model_id: str) -> Path:
    if resolve_model_id(model_id) == DRAFT_MODEL_ID:
        return DRAFT_WORKFLOW
    if _lora_path().is_file():
        return QUALITY_WORKFLOW
    return QUALITY_WORKFLOW_NOLORA
