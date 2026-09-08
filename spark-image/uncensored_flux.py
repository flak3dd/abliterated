"""Uncensored image helpers — Build D Diffusers (no Comfy). Delegates to sampler_runtime."""
from __future__ import annotations
from typing import Optional
from sampler_runtime import (
    ALLOWED_MODEL_IDS, UNCENSORED_MODEL_ID, generate_pil, generate_png_bytes, load_pipe, strip_safety,
)
from spark_models import QUALITY_MODEL_ID, resolve_model_id as _resolve_spark

def resolve_model_id(requested: Optional[str] = None) -> str:
    return _resolve_spark(requested)

__all__ = [
    "ALLOWED_MODEL_IDS", "UNCENSORED_MODEL_ID", "QUALITY_MODEL_ID",
    "generate_pil", "generate_png_bytes", "load_pipe", "resolve_model_id", "strip_safety",
]
