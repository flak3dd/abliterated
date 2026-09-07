#!/usr/bin/env python3
"""Safety-strip + model-id tests (no GPU)."""
from __future__ import annotations

from spark_models import DRAFT_MODEL_ID, QUALITY_MODEL_ID
from spark_models import resolve_model_id as resolve_spark_id
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
    assert resolve_model_id("abliterated-flux-klein") == UNCENSORED_MODEL_ID
    assert resolve_model_id("comfy-dreamshaper") == UNCENSORED_MODEL_ID
    assert resolve_model_id("sdxl-turbo") == UNCENSORED_MODEL_ID
    assert "comfy-dreamshaper" not in ALLOWED_MODEL_IDS

    pipe = DummyPipe()
    strip_safety(pipe)
    assert pipe.safety_checker is None
    assert pipe.feature_extractor is None
    assert pipe.watermarker is None
    assert pipe.nsfw_checker is None
    assert pipe.requires_safety_checker is False

    assert QUALITY_MODEL_ID == "krea2-turbo-nvfp4"
    assert DRAFT_MODEL_ID == "z-image-turbo-nsfw-nvfp4"
    assert resolve_spark_id("draft") == DRAFT_MODEL_ID
    assert resolve_spark_id("krea2") == QUALITY_MODEL_ID
    assert resolve_spark_id("comfy-dreamshaper") == QUALITY_MODEL_ID
    print("uncensored_flux tests ok")


if __name__ == "__main__":
    main()
