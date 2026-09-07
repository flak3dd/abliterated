"""ComfyUI node: uncensored FLUX.2 Klein (abliterated text encoder, no safety checker)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import numpy as np
import torch


def _image_dir() -> Path:
    env = os.environ.get("ABLITERATED_SPARK_IMAGE", "").strip()
    if env:
        return Path(env)
    marker = Path(__file__).resolve().parent / "IMAGE_DIR"
    if marker.is_file():
        return Path(marker.read_text(encoding="utf-8").strip())
    # repo / install layouts: spark-image/custom_nodes/abliterated_flux_klein
    return Path(__file__).resolve().parents[2]


_IMAGE = _image_dir()
if str(_IMAGE) not in sys.path:
    sys.path.insert(0, str(_IMAGE))


class AbliteratedFluxKlein:
    """Txt2img through the abliterated FLUX.2 Klein pipeline. No safety checker."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {"multiline": True, "default": ""}),
                "width": ("INT", {"default": 1024, "min": 64, "max": 2048, "step": 8}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 2048, "step": 8}),
                "steps": ("INT", {"default": 8, "min": 1, "max": 50}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 2**31 - 1}),
            },
            "optional": {
                "negative": ("STRING", {"multiline": True, "default": ""}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "generate"
    CATEGORY = "abliterated"

    def generate(self, prompt, width, height, steps, seed, negative=""):
        del negative  # unrestricted: negative is ignored for this uncensored path
        from uncensored_flux import generate_pil

        img = generate_pil(
            str(prompt or ""),
            width=int(width),
            height=int(height),
            steps=int(steps),
            seed=int(seed) if seed else None,
        )
        arr = np.array(img.convert("RGB"), dtype=np.float32) / 255.0
        tensor = torch.from_numpy(arr)[None, ...]
        return (tensor,)


NODE_CLASS_MAPPINGS = {"AbliteratedFluxKlein": AbliteratedFluxKlein}
NODE_DISPLAY_NAME_MAPPINGS = {"AbliteratedFluxKlein": "Abliterated FLUX.2 Klein (uncensored)"}
