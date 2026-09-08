#!/usr/bin/env python3
"""Safety-strip + model-id tests (no GPU)."""
from __future__ import annotations
from spark_models import (
    DRAFT_MODEL_ID, FAST_MODEL_ID, KLEIN_MODEL_ID, MODEL_IDS, QUALITY_MODEL_ID,
    QWEN_EDIT_MODEL_ID, QWEN_IMAGE_MODEL_ID, resolve_model_id as resolve_spark_id, sampler_params,
)
from uncensored_flux import ALLOWED_MODEL_IDS, UNCENSORED_MODEL_ID, resolve_model_id, strip_safety

class DummyPipe:
    def __init__(self):
        self.safety_checker = object()
        self.feature_extractor = object()
        self.watermarker = object()
        self.nsfw_checker = object()
        self.requires_safety_checker = True

def main() -> None:
    assert resolve_model_id(None) == UNCENSORED_MODEL_ID
    assert resolve_model_id("") == UNCENSORED_MODEL_ID
    assert "comfy-dreamshaper" not in ALLOWED_MODEL_IDS
    pipe = DummyPipe(); strip_safety(pipe)
    assert pipe.safety_checker is None and pipe.requires_safety_checker is False
    assert QUALITY_MODEL_ID == "krea2-raw-fp8"
    assert FAST_MODEL_ID == "krea2-turbo"
    assert KLEIN_MODEL_ID == "flux2-klein-9b"
    assert DRAFT_MODEL_ID == "z-image-turbo-nsfw-nvfp4"
    assert resolve_spark_id(None) == QUALITY_MODEL_ID
    assert resolve_spark_id("quality") == QUALITY_MODEL_ID
    assert resolve_spark_id("hero") == QUALITY_MODEL_ID
    assert resolve_spark_id("krea2") == QUALITY_MODEL_ID
    assert resolve_spark_id("klein") == KLEIN_MODEL_ID
    assert resolve_spark_id("fast") == FAST_MODEL_ID
    assert resolve_spark_id("draft") == DRAFT_MODEL_ID
    assert resolve_spark_id("z-image-turbo-6b") == DRAFT_MODEL_ID
    assert resolve_spark_id("instruction") == QWEN_IMAGE_MODEL_ID
    assert resolve_spark_id("edit") == QWEN_EDIT_MODEL_ID
    sp = sampler_params("quality")
    assert sp["steps"] == 24 and sp["guidance"] == 3.5 and sp["lora_strength"] == 0.75
    assert "krea2-raw-fp8" in MODEL_IDS and "workflow_for" not in dir(__import__("spark_models"))
    print("uncensored_flux tests ok")

if __name__ == "__main__":
    main()
