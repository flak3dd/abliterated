"""Spark image model ids — Build D (DGX Spark GB10 / 128GB unified).

Hero: Krea2Pipeline krea2-raw-fp8 + Huihui TE + uncensor LoRA @ 0.75
Fast: krea2-turbo (demoted). Draft: z-image-turbo-nsfw-nvfp4 (sketches).
Instruction/Edit: qwen-image-2512-fp8 / qwen-edit-2511-fp8 (first-class).
Anime zoo: illustrious-wai-nsfw / pony-v6 (optional, not hero).
Image TE != LLM sidecar (:8000 qwen-abliterated). No ComfyUI.
"""
from __future__ import annotations
from typing import Optional

QUALITY_MODEL_ID = "krea2-raw-fp8"
DEFAULT_MODEL_ID = QUALITY_MODEL_ID
FAST_MODEL_ID = "krea2-turbo"
KLEIN_MODEL_ID = "flux2-klein-9b"
QWEN_IMAGE_MODEL_ID = "qwen-image-2512-fp8"
QWEN_EDIT_MODEL_ID = "qwen-edit-2511-fp8"
DRAFT_MODEL_ID = "z-image-turbo-nsfw-nvfp4"
SEEDVR2_MODEL_ID = "seedvr2-7b-fp8"
ANIME_MODEL_ID = "illustrious-wai-nsfw"
PONY_MODEL_ID = "pony-v6"
LIGHT_MODEL_ID = "flux2-klein-4b"
MAX_MODEL_ID = "flux2-dev"

QUALITY_STEPS = 24
QUALITY_CFG = 3.5
QUALITY_SAMPLER = "euler"
QUALITY_SCHEDULER = "beta"
QUALITY_LORA_STRENGTH = 0.75
QUALITY_MAX_EDGE = 1536
QUALITY_TE = "Huihui-Qwen3-VL-4B-Instruct-abliterated-fp8_scaled.safetensors"
QUALITY_TE_REPO = "huihui-ai/Huihui-Qwen3-VL-4B-Instruct-abliterated"
QUALITY_TE_ALT_REPO = "AEON-7/Heretic-Qwen3-VL-4B"
QUALITY_DIT = "krea2_raw_fp8_scaled.safetensors"
QUALITY_LORA_FILE = "krea2_uncensor.safetensors"
QUALITY_PIPELINE = "Krea2Pipeline"
QUALITY_REPO = "krea/Krea-2-Raw"

MODEL_IDS = (
    QUALITY_MODEL_ID, FAST_MODEL_ID, KLEIN_MODEL_ID, LIGHT_MODEL_ID, MAX_MODEL_ID,
    DRAFT_MODEL_ID, QWEN_IMAGE_MODEL_ID, QWEN_EDIT_MODEL_ID, SEEDVR2_MODEL_ID,
    ANIME_MODEL_ID, PONY_MODEL_ID,
)

QUALITY_ALIASES = frozenset({
    QUALITY_MODEL_ID, "krea2-raw", "krea2", "krea", "raw", "quality", "hero",
    "default", "daily", "photoreal", "abliterated-flux-klein", "comfy-dreamshaper",
    "comfy-abliterated-flux",
})
FAST_ALIASES = frozenset({
    FAST_MODEL_ID, "krea2-turbo-nvfp4", "krea2-turbo-int8", "turbo", "fast", "nvfp4",
})
KLEIN_ALIASES = frozenset({
    KLEIN_MODEL_ID, "klein", "klein-9b", "flux2-klein", "flux-klein-9b",
    "flux2-klein-uncensored", "flux-klein-abliterated", "adherence", "second",
})
DRAFT_ALIASES = frozenset({
    DRAFT_MODEL_ID, "z-image-turbo-6b", "z-image", "zimage", "draft", "sketch",
})
ANIME_ALIASES = frozenset({ANIME_MODEL_ID, "illustrious", "wai-nsfw", "anime"})
PONY_ALIASES = frozenset({PONY_MODEL_ID, "pony", "pony-v6-sdxl"})

_ALIAS_MAP = {
    LIGHT_MODEL_ID: LIGHT_MODEL_ID, "klein-4b": LIGHT_MODEL_ID, "light": LIGHT_MODEL_ID,
    "apache": LIGHT_MODEL_ID, MAX_MODEL_ID: MAX_MODEL_ID, "flux-dev": MAX_MODEL_ID,
    "flux2-dev": MAX_MODEL_ID, "dev": MAX_MODEL_ID, "max": MAX_MODEL_ID,
    QWEN_IMAGE_MODEL_ID: QWEN_IMAGE_MODEL_ID, "qwen-image": QWEN_IMAGE_MODEL_ID,
    "instruction": QWEN_IMAGE_MODEL_ID, "type": QWEN_IMAGE_MODEL_ID,
    QWEN_EDIT_MODEL_ID: QWEN_EDIT_MODEL_ID, "qwen-edit": QWEN_EDIT_MODEL_ID, "edit": QWEN_EDIT_MODEL_ID,
    SEEDVR2_MODEL_ID: SEEDVR2_MODEL_ID, "seedvr2": SEEDVR2_MODEL_ID, "upscale": SEEDVR2_MODEL_ID,
}


def resolve_model_id(requested: Optional[str]) -> str:
    name = (requested or "").strip().lower()
    if not name or name in QUALITY_ALIASES:
        return QUALITY_MODEL_ID
    if name in FAST_ALIASES:
        return FAST_MODEL_ID
    if name in KLEIN_ALIASES:
        return KLEIN_MODEL_ID
    if name in DRAFT_ALIASES:
        return DRAFT_MODEL_ID
    if name in ANIME_ALIASES:
        return ANIME_MODEL_ID
    if name in PONY_ALIASES:
        return PONY_MODEL_ID
    if name in _ALIAS_MAP:
        return _ALIAS_MAP[name]
    if name in MODEL_IDS:
        return name
    return QUALITY_MODEL_ID


def sampler_params(model_id: Optional[str] = None) -> dict:
    mid = resolve_model_id(model_id)
    if mid == FAST_MODEL_ID:
        return {"steps": 8, "guidance": 0.0, "sampler": "euler", "scheduler": "simple",
                "lora_strength": 0.0, "max_edge": QUALITY_MAX_EDGE, "pipeline_class": "Krea2Pipeline"}
    if mid == KLEIN_MODEL_ID:
        return {"steps": 28, "guidance": 3.5, "sampler": "euler", "scheduler": "beta",
                "lora_strength": 0.7, "max_edge": QUALITY_MAX_EDGE, "pipeline_class": "Flux2KleinPipeline"}
    if mid == DRAFT_MODEL_ID:
        return {"steps": 8, "guidance": 1.0, "sampler": "euler", "scheduler": "simple",
                "lora_strength": 0.0, "max_edge": QUALITY_MAX_EDGE, "pipeline_class": "ZImagePipeline"}
    if mid == QWEN_IMAGE_MODEL_ID:
        return {"steps": 30, "guidance": 4.0, "sampler": "euler", "scheduler": "beta",
                "lora_strength": 0.7, "max_edge": QUALITY_MAX_EDGE, "pipeline_class": "QwenImagePipeline"}
    if mid == QWEN_EDIT_MODEL_ID:
        return {"steps": 28, "guidance": 3.5, "sampler": "euler", "scheduler": "beta",
                "lora_strength": 0.7, "max_edge": QUALITY_MAX_EDGE, "pipeline_class": "QwenImageEditPlusPipeline"}
    return {"steps": QUALITY_STEPS, "guidance": QUALITY_CFG, "sampler": QUALITY_SAMPLER,
            "scheduler": QUALITY_SCHEDULER, "lora_strength": QUALITY_LORA_STRENGTH,
            "max_edge": QUALITY_MAX_EDGE, "pipeline_class": QUALITY_PIPELINE, "text_encoder": QUALITY_TE}
