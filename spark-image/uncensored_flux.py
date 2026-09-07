"""Uncensored FLUX.2 Klein loader — no safety checker, no watermark, no NSFW gate.

Weights stay on the GPU host. The DiT is FLUX.2 Klein base (no refusal layer);
the text encoder is the abliterated / uncensored drop.
"""
from __future__ import annotations

import io
import os
from typing import Any, Callable, Optional

UNCENSORED_MODEL_ID = "abliterated-flux-klein"
BASE_REPO = os.environ.get("FLUX_BASE_REPO", "black-forest-labs/FLUX.2-klein-base-4B")
ENC_REPO = os.environ.get(
    "FLUX_TEXT_ENCODER_REPO",
    "PinoCookie/Flux.2-klein-4B-abliterated-text-encoder",
)
ALT_ENC_REPO = "ponpoke/flux2-klein-4b-uncensored-text-encoder"
DTYPE_NAME = os.environ.get("FLUX_DTYPE", "bfloat16")

# Only these ids are served. Anything else is coerced to the uncensored model.
ALLOWED_MODEL_IDS = frozenset(
    {
        UNCENSORED_MODEL_ID,
        "comfy-abliterated-flux",
        "flux-klein-abliterated",
        "flux2-klein-uncensored",
    }
)

_pipe = None


def resolve_model_id(requested: Optional[str]) -> str:
    name = (requested or "").strip()
    if name in ALLOWED_MODEL_IDS or name == "":
        return UNCENSORED_MODEL_ID
    # Never load a censored / filtered checkpoint.
    return UNCENSORED_MODEL_ID


def strip_safety(pipe: Any) -> Any:
    """Remove every safety / watermark / NSFW component the pipeline exposes."""
    for attr in (
        "safety_checker",
        "feature_extractor",
        "watermarker",
        "nsfw_checker",
        "safety_checker_dtype",
    ):
        if hasattr(pipe, attr):
            try:
                setattr(pipe, attr, None)
            except Exception:
                pass
    if hasattr(pipe, "requires_safety_checker"):
        try:
            pipe.requires_safety_checker = False
        except Exception:
            pass
    return pipe


def _torch_dtype():
    import torch

    return {
        "bfloat16": torch.bfloat16,
        "float16": torch.float16,
        "fp16": torch.float16,
        "fp32": torch.float32,
    }.get(DTYPE_NAME.lower(), torch.bfloat16)


def load_pipe():
    global _pipe
    if _pipe is not None:
        return _pipe
    import torch

    dtype = _torch_dtype()
    pipe = None
    try:
        from diffusers import Flux2KleinPipeline

        pipe = Flux2KleinPipeline.from_pretrained(
            BASE_REPO,
            torch_dtype=dtype,
            safety_checker=None,
        )
    except TypeError:
        from diffusers import Flux2KleinPipeline

        pipe = Flux2KleinPipeline.from_pretrained(BASE_REPO, torch_dtype=dtype)
    except Exception as exc:
        print(f"Flux2KleinPipeline unavailable ({exc}); trying Flux2Pipeline/DiffusionPipeline")
    if pipe is None:
        try:
            from diffusers import Flux2Pipeline

            try:
                pipe = Flux2Pipeline.from_pretrained(
                    BASE_REPO, torch_dtype=dtype, safety_checker=None
                )
            except TypeError:
                pipe = Flux2Pipeline.from_pretrained(BASE_REPO, torch_dtype=dtype)
        except Exception as exc:
            print(f"Flux2Pipeline unavailable ({exc}); trying DiffusionPipeline")
            from diffusers import DiffusionPipeline

            try:
                pipe = DiffusionPipeline.from_pretrained(
                    BASE_REPO, torch_dtype=dtype, safety_checker=None
                )
            except TypeError:
                pipe = DiffusionPipeline.from_pretrained(BASE_REPO, torch_dtype=dtype)

    strip_safety(pipe)

    try:
        from huggingface_hub import hf_hub_download

        if hasattr(pipe, "text_encoder") and pipe.text_encoder is not None:
            loaded = False
            for repo in (ENC_REPO, ALT_ENC_REPO):
                try:
                    from transformers import AutoModel

                    te = AutoModel.from_pretrained(repo, torch_dtype=dtype)
                    pipe.text_encoder = te
                    print(f"loaded abliterated text encoder from {repo}")
                    loaded = True
                    break
                except Exception:
                    try:
                        pt = hf_hub_download(repo, "text_encoder.pt")
                        blob = torch.load(pt, map_location="cpu", weights_only=True)
                        if isinstance(blob, dict) and "state_dict" in blob:
                            blob = blob["state_dict"]
                        missing, unexpected = pipe.text_encoder.load_state_dict(blob, strict=False)
                        print(
                            f"loaded abliterated text encoder weights from {repo} "
                            f"(missing={len(missing)} unexpected={len(unexpected)})"
                        )
                        loaded = True
                        break
                    except Exception as enc_exc:
                        print(f"encoder {repo} failed ({enc_exc})")
            if not loaded:
                print("warning: could not load abliterated text encoder; using base encoder")
        else:
            print("warning: pipeline has no text_encoder to swap")
    except Exception as exc:
        print(f"warning: could not swap text encoder ({exc}); using base encoder")

    strip_safety(pipe)

    if torch.cuda.is_available():
        pipe = pipe.to("cuda")
        print("device: cuda")
    elif getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
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

    strip_safety(pipe)
    _pipe = pipe
    return _pipe


def generate_pil(
    prompt: str,
    *,
    width: int = 1024,
    height: int = 1024,
    steps: Optional[int] = None,
    guidance: Optional[float] = None,
    seed: Optional[int] = None,
    on_step: Optional[Callable[..., Any]] = None,
):
    import torch

    pipe = load_pipe()
    n_steps = int(steps if steps is not None else os.environ.get("FLUX_STEPS", "8"))
    gscale = float(guidance if guidance is not None else os.environ.get("FLUX_GUIDANCE", "1.0"))
    kwargs: dict[str, Any] = dict(
        prompt=prompt,
        width=max(64, int(width)),
        height=max(64, int(height)),
        num_inference_steps=n_steps,
        guidance_scale=gscale,
    )
    if seed is not None:
        try:
            kwargs["generator"] = torch.Generator(device=pipe.device).manual_seed(int(seed))
        except Exception:
            kwargs["generator"] = torch.Generator().manual_seed(int(seed))

    def _on_step(pipe_obj, step_idx, timestep, callback_kwargs):  # type: ignore[no-untyped-def]
        if on_step:
            try:
                on_step(pipe_obj, step_idx, timestep, callback_kwargs)
            except Exception:
                pass
        return callback_kwargs

    try:
        if on_step:
            out = pipe(**kwargs, callback_on_step_end=_on_step)
        else:
            out = pipe(**kwargs)
    except TypeError:
        out = pipe(**kwargs)
    return out.images[0]


def generate_png_bytes(
    prompt: str,
    *,
    width: int = 1024,
    height: int = 1024,
    steps: Optional[int] = None,
    guidance: Optional[float] = None,
    seed: Optional[int] = None,
    on_step: Optional[Callable[..., Any]] = None,
) -> bytes:
    img = generate_pil(
        prompt,
        width=width,
        height=height,
        steps=steps,
        guidance=guidance,
        seed=seed,
        on_step=on_step,
    )
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
