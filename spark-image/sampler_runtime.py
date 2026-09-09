"""Build D Diffusers sampler runtime — pipeline class by model id. No ComfyUI.

Hero (krea2-raw-fp8): Krea2Pipeline + Huihui/Heretic Qwen3-VL TE + uncensor LoRA @ 0.75
TE env: KREA_TEXT_ENCODER_REPO (primary Huihui, alt Heretic). Not CLIP.
Image TE != LLM sidecar (:8000). Qwen image/edit also swap Qwen3-VL TE.
"""
from __future__ import annotations

import io
import os
from pathlib import Path
from typing import Any, Callable, Optional

from spark_models import (
    ANIME_MODEL_ID,
    DRAFT_MODEL_ID,
    FAST_MODEL_ID,
    KLEIN_MODEL_ID,
    LIGHT_MODEL_ID,
    MAX_MODEL_ID,
    PONY_MODEL_ID,
    QUALITY_CFG,
    QUALITY_LORA_FILE,
    QUALITY_LORA_STRENGTH,
    QUALITY_MAX_EDGE,
    QUALITY_MODEL_ID,
    QUALITY_REPO,
    QUALITY_STEPS,
    QUALITY_TE,
    QUALITY_TE_ALT_REPO,
    QUALITY_TE_REPO,
    QWEN_EDIT_MODEL_ID,
    QWEN_IMAGE_MODEL_ID,
    SEEDVR2_MODEL_ID,
    MODEL_IDS,
    resolve_model_id,
    sampler_params,
)

DTYPE_NAME = os.environ.get("FLUX_DTYPE", os.environ.get("SAMPLER_DTYPE", "bfloat16"))
MODELS_ROOT = Path(
    os.environ.get("SPARK_IMAGE_MODELS")
    or os.environ.get("ABLITERATED_IMAGE_MODELS")
    or (Path(__file__).resolve().parent / "models")
).expanduser()

_pipes: dict[str, Any] = {}
_pipe_meta: dict[str, dict[str, Any]] = {}
_pipe_lora_strength: dict[str, float] = {}
_pipe_lora_path: dict[str, Optional[Path]] = {}
_pipe_lora_fused: dict[str, bool] = {}
_torch_tuned = False


def _env_flag(name: str) -> Optional[bool]:
    raw = os.environ.get(name, "").strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return None


def use_vae_tiling(offload: bool) -> bool:
    """Tiling is a decode tax. Only when offloading, low VRAM, or SAMPLER_VAE_TILING=1."""
    forced = _env_flag("SAMPLER_VAE_TILING")
    if forced is not None:
        return forced
    return bool(offload)


def want_cpu_offload(free_gb: Optional[float] = None) -> bool:
    """SAMPLER_CPU_OFFLOAD=0 is a hard off. Auto-offload only if unset and free VRAM is tiny."""
    env = _env_flag("SAMPLER_CPU_OFFLOAD")
    if env is False:
        return False
    if env is True:
        return True
    if free_gb is None:
        return False
    return float(free_gb) < 24.0


def _cuda_gc() -> None:
    try:
        import gc
        gc.collect()
    except Exception:
        pass
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def unload_pipes(keep: Optional[str] = None) -> list[str]:
    """Drop cached Diffusers pipes so the next model can actually fit next to vLLM."""
    dropped: list[str] = []
    keep_id = resolve_model_id(keep) if keep else None
    for k in list(_pipes.keys()):
        if keep_id and k == keep_id:
            continue
        try:
            pipe = _pipes.pop(k, None)
            if pipe is not None:
                del pipe
        except Exception:
            _pipes.pop(k, None)
        _pipe_meta.pop(k, None)
        _pipe_lora_strength.pop(k, None)
        _pipe_lora_path.pop(k, None)
        _pipe_lora_fused.pop(k, None)
        dropped.append(k)
    if dropped:
        print(f"unloaded pipes {dropped} keep={keep_id}")
        _cuda_gc()
    return dropped


def _tune_torch() -> None:
    """Once-per-process CUDA matmul / SDPA knobs. Safe no-op on CPU."""
    global _torch_tuned
    if _torch_tuned:
        return
    _torch_tuned = True
    try:
        import torch
    except Exception:
        return
    try:
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        torch.backends.cudnn.benchmark = True
    except Exception:
        pass
    try:
        torch.set_float32_matmul_precision("high")
    except Exception:
        pass
    try:
        torch.backends.cuda.enable_flash_sdp(True)
        torch.backends.cuda.enable_mem_efficient_sdp(True)
    except Exception:
        pass


def _enable_fast_attn(pipe: Any) -> None:
    if getattr(pipe, "transformer", None) is not None and getattr(pipe, "unet", None) is None:
        print("skip xformers/SDPA processor swap on DiT transformer")
        return
    fn = getattr(pipe, "enable_xformers_memory_efficient_attention", None)
    if callable(fn):
        try:
            fn()
            print("enabled xformers attention")
            return
        except Exception as exc:
            print(f"xformers attention skipped: {exc}")
    try:
        from diffusers.models.attention_processor import AttnProcessor2_0
    except Exception:
        return
    # Never swap processors on DiT `transformer` (Krea2Attention has no spatial_norm;
    # Qwen joint attn unpacks (img, txt)). UNet-only is safe.
    proc = AttnProcessor2_0()
    unet = getattr(pipe, "unet", None)
    setter = getattr(unet, "set_attn_processor", None) if unet is not None else None
    if callable(setter):
        try:
            setter(proc)
            print("enabled SDPA AttnProcessor2_0 on unet")
        except Exception as exc:
            print(f"SDPA on unet skipped: {exc}")


class StubModelError(RuntimeError):
    pass


def _torch_dtype():
    import torch
    return {"bfloat16": torch.bfloat16, "float16": torch.float16, "fp16": torch.float16,
            "fp32": torch.float32}.get(DTYPE_NAME.lower(), torch.bfloat16)


def _device() -> str:
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def strip_safety(pipe: Any) -> Any:
    for attr in ("safety_checker", "feature_extractor", "watermarker", "nsfw_checker", "safety_checker_dtype"):
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


def _clamp_edge(width: int, height: int, max_edge: int) -> tuple[int, int]:
    me = max(64, int(max_edge))
    w, h = max(64, int(width)), max(64, int(height))
    m = max(w, h)
    if m <= me:
        return w, h
    scale = me / float(m)
    return max(64, int(w * scale) // 8 * 8), max(64, int(h * scale) // 8 * 8)


def _local_diffusers_dir(*names: str) -> Optional[Path]:
    for name in names:
        p = MODELS_ROOT / name
        if p.is_dir() and (p / "model_index.json").is_file():
            return p
    return None


def _lora_path(name: str = QUALITY_LORA_FILE) -> Optional[Path]:
    for p in (MODELS_ROOT / "loras" / name, MODELS_ROOT / name):
        if p.is_file() and p.stat().st_size > 1_000_000:
            return p
    env = os.environ.get("KREA_UNCENSOR_LORA", "").strip()
    if name == QUALITY_LORA_FILE and env and Path(env).is_file():
        return Path(env)
    return None


def _import_pipeline(class_name: str):
    import diffusers
    if hasattr(diffusers, class_name):
        return getattr(diffusers, class_name)
    raise ImportError(f"diffusers has no {class_name} (need >=0.39 for Krea2Pipeline)")


def _te_repo_candidates() -> list[str]:
    env = os.environ.get("KREA_TEXT_ENCODER_REPO", "").strip()
    primary = os.environ.get("HUIHUI_TE_REPO", QUALITY_TE_REPO).strip() or QUALITY_TE_REPO
    alt = os.environ.get("HERETIC_TE_REPO", QUALITY_TE_ALT_REPO).strip() or QUALITY_TE_ALT_REPO
    out = []
    if env:
        out.append(env)
    for r in (primary, alt, "huihui-ai/Huihui-Qwen3-VL-4B-Instruct-abliterated", "AEON-7/Heretic-Qwen3-VL-4B"):
        if r and r not in out:
            out.append(r)
    return out


def _swap_qwen3vl_te(pipe: Any, dtype, *, required: bool, label: str) -> bool:
    """Replace stock Qwen3-VL text_encoder with Huihui/Heretic abliterated. Not CLIP."""
    if not hasattr(pipe, "text_encoder"):
        print(f"warning: {label} has no text_encoder to swap")
        return False
    local_te = MODELS_ROOT / "text_encoders" / QUALITY_TE
    for repo in _te_repo_candidates():
        try:
            from transformers import AutoModel
            te = AutoModel.from_pretrained(repo, torch_dtype=dtype, trust_remote_code=True)
            pipe.text_encoder = te
            print(f"{label} TE: replaced stock Qwen3-VL with abliterated from {repo}")
            print("note: TE swap alone != full unlock; DiT + uncensor LoRA @ 0.75 complete Build D hero")
            print("note: Image TE != LLM sidecar :8000 (qwen-abliterated)")
            return True
        except Exception as exc:
            print(f"TE repo {repo} failed: {exc}")
    if local_te.is_file():
        try:
            from safetensors.torch import load_file
            blob = load_file(str(local_te))
            missing, unexpected = pipe.text_encoder.load_state_dict(blob, strict=False)
            print(f"{label} TE: loaded local Huihui weights {local_te.name} (missing={len(missing)} unexpected={len(unexpected)})")
            return True
        except Exception as exc:
            print(f"local TE load failed: {exc}")
    msg = f"{label}: Huihui/Heretic Qwen3-VL TE was NOT loaded"
    if required and os.environ.get("ABLITERATED_ALLOW_STOCK_TE", "").strip() not in ("1", "true", "yes"):
        print("ERROR: " + msg)
        return False
    print("warning: " + msg)
    return False


def _attach_lora(pipe: Any, path: Path, strength: float, tag: str, *, model_id: Optional[str] = None) -> bool:
    """Load LoRA weights and apply strength via set_adapters (preferred) or fuse_lora scale."""
    try:
        if hasattr(pipe, "load_lora_weights"):
            try:
                pipe.load_lora_weights(str(path.parent), weight_name=path.name)
            except Exception:
                pipe.load_lora_weights(str(path))
            fused = False
            applied = False
            if hasattr(pipe, "set_adapters"):
                for name in ("default", "default_0", path.stem):
                    try:
                        pipe.set_adapters([name], adapter_weights=[float(strength)])
                        applied = True
                        break
                    except Exception:
                        continue
                if not applied:
                    try:
                        # peft may expose get_list_adapters
                        names = None
                        if hasattr(pipe, "get_list_adapters"):
                            names = pipe.get_list_adapters()
                        if isinstance(names, dict):
                            flat = []
                            for v in names.values():
                                if isinstance(v, (list, tuple)):
                                    flat.extend(v)
                                elif isinstance(v, str):
                                    flat.append(v)
                            if flat:
                                pipe.set_adapters(flat[:1], adapter_weights=[float(strength)])
                                applied = True
                    except Exception:
                        pass
            if not applied and hasattr(pipe, "fuse_lora"):
                try:
                    pipe.fuse_lora(lora_scale=float(strength))
                    fused = True
                    applied = True
                except TypeError:
                    try:
                        pipe.fuse_lora()
                        fused = True
                        applied = True
                    except Exception:
                        pass
            if applied:
                print(f"loaded {tag} LoRA {path} @ {strength}" + (" (fused)" if fused else " (adapters)"))
                if model_id:
                    _pipe_lora_strength[model_id] = float(strength)
                    _pipe_lora_path[model_id] = path
                    _pipe_lora_fused[model_id] = fused
                return True
            print(f"{tag} LoRA loaded but strength apply failed @ {strength}")
            if model_id:
                _pipe_lora_strength[model_id] = float(strength)
                _pipe_lora_path[model_id] = path
                _pipe_lora_fused[model_id] = False
            return True
    except Exception as exc:
        print(f"{tag} LoRA attach failed: {exc}")
    return False


def apply_lora_strength(model_id: Optional[str], strength: float) -> float:
    """Apply per-request LoRA strength on an already-loaded quality/secondary pipe when possible."""
    mid = resolve_model_id(model_id)
    target = float(strength)
    pipe = _pipes.get(mid)
    if pipe is None:
        return target
    current = _pipe_lora_strength.get(mid)
    if current is not None and abs(current - target) < 1e-6:
        return target
    path = _pipe_lora_path.get(mid)
    fused = _pipe_lora_fused.get(mid, False)

    # Preferred: live adapter scale without reload
    if hasattr(pipe, "set_adapters") and not fused:
        for name in ("default", "default_0", path.stem if path else "default"):
            try:
                pipe.set_adapters([name], adapter_weights=[target])
                _pipe_lora_strength[mid] = target
                print(f"set_adapters LoRA strength {mid} -> {target}")
                return target
            except Exception:
                continue
        try:
            if hasattr(pipe, "set_adapters"):
                pipe.set_adapters(["default"], adapter_weights=[target])
                _pipe_lora_strength[mid] = target
                print(f"set_adapters LoRA strength {mid} -> {target}")
                return target
        except Exception as exc:
            print(f"set_adapters failed for {mid}: {exc}")

    # fuse_lora scale: unfuse then refuse if possible
    if hasattr(pipe, "fuse_lora"):
        try:
            if fused and hasattr(pipe, "unfuse_lora"):
                try:
                    pipe.unfuse_lora()
                except Exception:
                    pass
            try:
                pipe.fuse_lora(lora_scale=target)
            except TypeError:
                pipe.fuse_lora()
            _pipe_lora_strength[mid] = target
            _pipe_lora_fused[mid] = True
            print(f"fuse_lora scale {mid} -> {target}")
            return target
        except Exception as exc:
            print(f"fuse_lora rescale failed for {mid}: {exc}")

    # Last resort: drop cached pipe and reload with env override for next load_pipe
    if path is not None and mid == QUALITY_MODEL_ID:
        print(f"reloading {mid} to apply LoRA strength {target}")
        try:
            del _pipes[mid]
        except Exception:
            _pipes.pop(mid, None)
        os.environ["SAMPLER_LORA_STRENGTH"] = str(target)
        load_pipe(mid)
        _pipe_lora_strength[mid] = target
        return target

    print(f"warning: could not apply per-request lora_strength={target} on {mid}; keeping {current}")
    return float(current if current is not None else target)


def weights_present(model_id: Optional[str] = None) -> bool:
    """True when local Diffusers/checkpoint weights exist so the model can load offline."""
    mid = resolve_model_id(model_id)
    if mid == QUALITY_MODEL_ID:
        return _local_diffusers_dir("Krea-2-Raw", "krea2-raw", "krea-2-raw") is not None
    if mid == FAST_MODEL_ID:
        return _local_diffusers_dir("Krea-2-Turbo", "krea2-turbo", "krea-2-turbo") is not None
    if mid == KLEIN_MODEL_ID:
        return _local_diffusers_dir("FLUX.2-klein-base-9B", "flux2-klein-base-9B", "flux2-klein-9b") is not None
    if mid == QWEN_IMAGE_MODEL_ID:
        return _local_diffusers_dir("qwen-image-2512-fp8", "Qwen-Image", "qwen-image") is not None
    if mid == QWEN_EDIT_MODEL_ID:
        return _local_diffusers_dir("qwen-edit-2511-fp8", "Qwen-Image-Edit-2511", "qwen-edit") is not None
    if mid == DRAFT_MODEL_ID:
        return _local_diffusers_dir("z-image-turbo-nsfw-nvfp4", "Z-Image-Turbo", "z-image-turbo") is not None
    if mid == LIGHT_MODEL_ID:
        return _local_diffusers_dir("FLUX.2-klein-4B", "flux2-klein-4b", "flux2-klein-base-4B") is not None
    if mid == MAX_MODEL_ID:
        return _local_diffusers_dir("FLUX.2-dev", "flux2-dev") is not None
    if mid == SEEDVR2_MODEL_ID:
        return _local_diffusers_dir("seedvr2-7b-fp8", "SeedVR2", "seedvr2") is not None
    if mid == ANIME_MODEL_ID:
        # zoo checkpoints: any sizeable file matching illustrious/wai
        for p in MODELS_ROOT.rglob("*"):
            if p.is_file() and p.stat().st_size > 50_000_000 and any(k in p.name.lower() for k in ("illustrious", "wai-nsfw", "wai_nsfw")):
                return True
        return False
    if mid == PONY_MODEL_ID:
        for p in MODELS_ROOT.rglob("*"):
            if p.is_file() and p.stat().st_size > 50_000_000 and "pony" in p.name.lower():
                return True
        return False
    return False


def available_model_ids() -> list[str]:
    return [m for m in MODEL_IDS if weights_present(m)]


def _enable_vae_memory_savers(pipe: Any, *, tiling: bool = False) -> None:
    """Slicing is cheap. Tiling is slow — only when offload/low VRAM asked for it."""
    names = ["enable_vae_slicing"]
    if tiling:
        names.append("enable_vae_tiling")
    for name in names:
        fn = getattr(pipe, name, None)
        if not callable(fn):
            continue
        try:
            fn()
            print(f"enabled {name}")
        except Exception as exc:
            print(f"{name} failed: {exc}")
    vae = getattr(pipe, "vae", None)
    if vae is not None:
        vae_names = ["enable_slicing"]
        if tiling:
            vae_names.append("enable_tiling")
        for name in vae_names:
            fn = getattr(vae, name, None)
            if callable(fn):
                try:
                    fn()
                    print(f"enabled vae.{name}")
                except Exception as exc:
                    print(f"vae.{name} failed: {exc}")


def _to_device(pipe: Any, dtype):
    import torch
    _tune_torch()
    strip_safety(pipe)
    _enable_fast_attn(pipe)
    dev = _device()
    free_gb = None
    if dev == "cuda":
        try:
            free_b, _total_b = torch.cuda.mem_get_info()
            free_gb = free_b / (1024**3)
        except Exception as exc:
            print(f"mem_get_info failed ({exc})")
    offload = want_cpu_offload(free_gb)
    env = _env_flag("SAMPLER_CPU_OFFLOAD")
    print(f"cuda_free_gb={free_gb if free_gb is not None else 'n/a'} offload={offload} env_offload={env}")
    if dev == "cuda" and offload and hasattr(pipe, "enable_model_cpu_offload"):
        print("using enable_model_cpu_offload (coexist with :8000)")
        pipe.enable_model_cpu_offload()
        _enable_vae_memory_savers(pipe, tiling=use_vae_tiling(True))
        return strip_safety(pipe)
    if dev == "cuda":
        pipe = pipe.to("cuda")
    elif dev == "mps":
        if dtype == torch.bfloat16:
            try:
                pipe = pipe.to(dtype=torch.float16)
            except Exception:
                pass
        pipe = pipe.to("mps")
    _enable_vae_memory_savers(pipe, tiling=use_vae_tiling(offload))
    return strip_safety(pipe)


def _load_krea(model_id: str, *, turbo: bool = False):
    dtype = _torch_dtype()
    Krea2Pipeline = _import_pipeline("Krea2Pipeline")
    repo = os.environ.get("KREA_TURBO_REPO" if turbo else "KREA_RAW_REPO",
                          "krea/Krea-2-Turbo" if turbo else QUALITY_REPO)
    local = _local_diffusers_dir("Krea-2-Turbo" if turbo else "Krea-2-Raw",
                                 "krea2-turbo" if turbo else "krea2-raw",
                                 "krea-2-turbo" if turbo else "krea-2-raw")
    src = str(local) if local is not None else repo
    print(f"loading Krea2Pipeline from {src} (turbo={turbo})")
    try:
        pipe = Krea2Pipeline.from_pretrained(src, torch_dtype=dtype)
    except TypeError:
        pipe = Krea2Pipeline.from_pretrained(src, dtype=dtype)
    strip_safety(pipe)
    te_ok = True
    if not turbo:
        te_ok = _swap_qwen3vl_te(pipe, dtype, required=True, label="hero")
        if not te_ok:
            raise RuntimeError("Build D hero requires Huihui/Heretic Qwen3-VL-4B TE. Set ABLITERATED_ALLOW_STOCK_TE=1 only for debug.")
        strength = float(os.environ.get("SAMPLER_LORA_STRENGTH", str(QUALITY_LORA_STRENGTH)))
        lp = _lora_path(QUALITY_LORA_FILE)
        if lp:
            _attach_lora(pipe, lp, strength, "uncensor", model_id=model_id)
        else:
            print(f"warning: uncensor LoRA missing under {MODELS_ROOT}/loras/{QUALITY_LORA_FILE}")
    pipe = _to_device(pipe, dtype)
    _pipe_meta[model_id] = {"pipeline_class": "Krea2Pipeline", "source": src, "huihui_te": (not turbo) and te_ok, "turbo": turbo}
    return pipe


def _load_klein(model_id: str):
    dtype = _torch_dtype()
    repo = os.environ.get("FLUX_KLEIN_BASE_REPO", "black-forest-labs/FLUX.2-klein-base-9B")
    local = _local_diffusers_dir("FLUX.2-klein-base-9B", "flux2-klein-base-9B", "flux2-klein-9b")
    src = str(local) if local is not None else repo
    try:
        Flux2KleinPipeline = _import_pipeline("Flux2KleinPipeline")
    except ImportError as exc:
        raise StubModelError(f"Flux2KleinPipeline unavailable: {exc}") from exc
    try:
        try:
            pipe = Flux2KleinPipeline.from_pretrained(src, torch_dtype=dtype, safety_checker=None)
        except TypeError:
            pipe = Flux2KleinPipeline.from_pretrained(src, torch_dtype=dtype)
    except Exception as exc:
        raise StubModelError(f"Klein 9B base missing/gated ({exc}). Hero remains krea2-raw-fp8.") from exc
    unlock = _lora_path("flux2_klein_nsfw_unlocked.safetensors")
    if unlock:
        _attach_lora(pipe, unlock, 0.7, "klein-nsfw")
    pipe = _to_device(pipe, dtype)
    _pipe_meta[model_id] = {"pipeline_class": "Flux2KleinPipeline", "source": src}
    return pipe


def _load_qwen_image(model_id: str):
    dtype = _torch_dtype()
    local = _local_diffusers_dir("qwen-image-2512-fp8", "Qwen-Image", "qwen-image")
    if local is None and not os.environ.get("QWEN_IMAGE_REPO"):
        raise StubModelError("Qwen-Image weights not present — Instruction chip disabled until pull")
    repo = str(local) if local else os.environ.get("QWEN_IMAGE_REPO", "Qwen/Qwen-Image")
    QwenImagePipeline = _import_pipeline("QwenImagePipeline")
    pipe = QwenImagePipeline.from_pretrained(repo, torch_dtype=dtype)
    # Do NOT swap Huihui Qwen3-VL-4B TE here: stock Qwen-Image uses Qwen2.5-VL
    # (hidden 3584). Huihui 4B is 2560 and breaks AdaLayerNorm (2560 vs 3584).
    # Uncensor via qwen_image_nsfw LoRA when present; stock TE stays.
    print("qwen-image TE: keeping stock Qwen2.5-VL (Huihui Qwen3-VL-4B dim mismatch)")
    lp = _lora_path("qwen_image_nsfw.safetensors")
    if lp:
        _attach_lora(pipe, lp, 0.7, "qwen-image-nsfw")
    # enable_model_cpu_offload breaks QwenImagePipeline (bmm CPU/CUDA mismatch).
    # Spark GB10 unified memory: keep Instruction fully on CUDA like Draft.
    strip_safety(pipe)
    _tune_torch()
    # Do not swap AttnProcessor2_0 onto Qwen joint img/txt attn (unpacks 1-tuple).
    if _device() == "cuda":
        pipe = pipe.to("cuda")
        _enable_vae_memory_savers(pipe, tiling=use_vae_tiling(False))
        pipe = strip_safety(pipe)
    else:
        pipe = _to_device(pipe, dtype)
    _pipe_meta[model_id] = {"pipeline_class": "QwenImagePipeline", "source": repo}
    return pipe


def _load_qwen_edit(model_id: str):
    dtype = _torch_dtype()
    local = _local_diffusers_dir("qwen-edit-2511-fp8", "Qwen-Image-Edit-2511", "qwen-edit")
    if local is None and not os.environ.get("QWEN_EDIT_REPO"):
        raise StubModelError("Qwen-Edit weights not present — Edit chip disabled until pull")
    repo = str(local) if local else os.environ.get("QWEN_EDIT_REPO", "Qwen/Qwen-Image-Edit-2511")
    try:
        cls = _import_pipeline("QwenImageEditPlusPipeline")
    except ImportError:
        cls = _import_pipeline("QwenImageEditPipeline")
    pipe = cls.from_pretrained(repo, torch_dtype=dtype)
    # Do NOT swap Huihui Qwen3-VL-4B TE: Qwen-Image-Edit uses Qwen2.5-VL (3584).
    # Huihui 4B is 2560 and breaks AdaLayerNorm. Keep stock TE; NSFW LoRA if present.
    print("qwen-edit TE: keeping stock Qwen2.5-VL (Huihui Qwen3-VL-4B dim mismatch)")
    lp = _lora_path("qwen_edit_nsfw.safetensors")
    if lp:
        _attach_lora(pipe, lp, 0.7, "qwen-edit-nsfw")
    # Same as Instruction/Draft: cpu_offload breaks Qwen2.5-VL pipelines on this stack.
    strip_safety(pipe)
    _tune_torch()
    # Stock Qwen joint attention — AttnProcessor2_0 returns 1 tensor, pipeline expects (img, txt).
    if _device() == "cuda":
        pipe = pipe.to("cuda")
        _enable_vae_memory_savers(pipe, tiling=use_vae_tiling(False))
        pipe = strip_safety(pipe)
    else:
        pipe = _to_device(pipe, dtype)
    _pipe_meta[model_id] = {"pipeline_class": getattr(cls, "__name__", "QwenEdit"), "source": repo}
    return pipe


def _load_draft(model_id: str):
    dtype = _torch_dtype()
    local = _local_diffusers_dir("z-image-turbo-nsfw-nvfp4", "Z-Image-Turbo", "z-image-turbo")
    if local is None and not os.environ.get("ZIMAGE_REPO"):
        raise StubModelError("Z-Image Turbo weights not present — Draft chip disabled until pull")
    repo = str(local) if local else os.environ.get("ZIMAGE_REPO", "Tongyi-MAI/Z-Image-Turbo")
    try:
        cls = _import_pipeline("ZImagePipeline")
    except ImportError as exc:
        raise StubModelError(f"ZImagePipeline not in diffusers pin: {exc}") from exc
    pipe = cls.from_pretrained(repo, torch_dtype=dtype)
    # ZImagePipeline + enable_model_cpu_offload hits CUDA/CPU matmul mismatch.
    # Keep Draft fully on GPU; VAE slicing still enabled (tiling off unless env).
    strip_safety(pipe)
    _tune_torch()
    _enable_fast_attn(pipe)
    if _device() == "cuda":
        pipe = pipe.to("cuda")
        _enable_vae_memory_savers(pipe, tiling=use_vae_tiling(False))
        pipe = strip_safety(pipe)
    else:
        pipe = _to_device(pipe, dtype)
    _pipe_meta[model_id] = {"pipeline_class": "ZImagePipeline", "source": repo, "role": "draft-sketches-only"}
    return pipe


def _construct_pipe(mid: str) -> tuple[str, Any]:
    if mid == FAST_MODEL_ID:
        return mid, _load_krea(mid, turbo=True)
    if mid == KLEIN_MODEL_ID:
        return mid, _load_klein(mid)
    if mid == QWEN_IMAGE_MODEL_ID:
        return mid, _load_qwen_image(mid)
    if mid == QWEN_EDIT_MODEL_ID:
        return mid, _load_qwen_edit(mid)
    if mid == DRAFT_MODEL_ID:
        return mid, _load_draft(mid)
    if mid in (SEEDVR2_MODEL_ID, ANIME_MODEL_ID, PONY_MODEL_ID):
        raise StubModelError(f"{mid} is optional/stub zoo or upscale — not loaded as hero")
    return QUALITY_MODEL_ID, _load_krea(QUALITY_MODEL_ID, turbo=False)


def load_pipe(model_id: Optional[str] = None):
    _tune_torch()
    mid = resolve_model_id(model_id)
    if mid in _pipes:
        return _pipes[mid]
    dropped = unload_pipes()
    if dropped:
        print(f"evicted {dropped} before load {mid}")
    try:
        mid, pipe = _construct_pipe(mid)
    except Exception as exc:
        name = type(exc).__name__
        if "out of memory" in str(exc).lower() or "OutOfMemory" in name:
            print(f"load OOM ({name}); evict and retry {mid}")
            unload_pipes()
            _cuda_gc()
            mid, pipe = _construct_pipe(mid)
        else:
            raise
    _pipes[mid] = pipe
    return pipe


def pipe_info(model_id: Optional[str] = None) -> dict[str, Any]:
    return dict(_pipe_meta.get(resolve_model_id(model_id)) or {})


def _decode_image_b64(image_b64: Optional[str]):
    """Decode optional reference image base64 to PIL RGB (or None)."""
    if not image_b64 or not str(image_b64).strip():
        return None
    import base64
    from PIL import Image
    s = str(image_b64).strip()
    if s.startswith("data:") and "," in s:
        s = s.split(",", 1)[1].strip()
    raw = base64.b64decode(s)
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    return img


FACESWAP_DEFAULT_PROMPT = (
    "Replace the face of the person in the first image with the identity from the second image. "
    "Keep pose, body, clothing, hands, lighting, camera, and scene. "
    "Match identity: bone structure, eyes, nose, mouth, skin. Photoreal, no extra people, no watermark."
)


def compose_faceswap_prompt(user_prompt: str) -> str:
    """Keep user instructions; fill a full ID-swap brief when the box is empty."""
    p = (user_prompt or "").strip()
    if not p:
        return FACESWAP_DEFAULT_PROMPT
    low = p.lower()
    if any(k in low for k in ("face", "identity", "swap", "id ")):
        return p
    return p.rstrip(".") + ". " + FACESWAP_DEFAULT_PROMPT


def snap8(n: int) -> int:
    return max(64, int(round(int(n) / 8.0) * 8))


def size_from_ratio(rw: float, rh: float, long_edge: int) -> tuple[int, int]:
    """Long-edge canvas from aspect ratio. Matches src/lib/imageAspect.ts sizeFromRatio."""
    le = max(64, int(long_edge) or 1024)
    aw, ah = max(1.0, float(rw)), max(1.0, float(rh))
    if aw >= ah:
        return snap8(le), snap8(le * ah / aw)
    return snap8(le * aw / ah), snap8(le)


def fit_size_inside(rw: float, rh: float, box_w: int, box_h: int) -> tuple[int, int]:
    """Largest snap8 size with ratio rw:rh that fits in box. Never stretches."""
    aw, ah = max(1.0, float(rw)), max(1.0, float(rh))
    bw, bh = max(64, int(box_w)), max(64, int(box_h))
    scale = min(bw / aw, bh / ah)
    return max(64, snap8(aw * scale)), max(64, snap8(ah * scale))


def _anchor_xy(cw: int, ch: int, nw: int, nh: int, anchor: str = "center") -> tuple[int, int]:
    a = (anchor or "center").strip().lower()
    if a in ("top", "north"):
        return (cw - nw) // 2, 0
    if a in ("bottom", "south"):
        return (cw - nw) // 2, max(0, ch - nh)
    if a in ("left", "west"):
        return 0, (ch - nh) // 2
    if a in ("right", "east"):
        return max(0, cw - nw), (ch - nh) // 2
    return (cw - nw) // 2, (ch - nh) // 2


def fit_contain(img: Any, canvas_w: int, canvas_h: int, fill: tuple[int, int, int] = (40, 40, 44), anchor: str = "center") -> Any:
    """Scale image to fit inside canvas. Never stretch. Pad leftover. Reposition via anchor."""
    cw, ch = max(1, int(canvas_w)), max(1, int(canvas_h))
    try:
        iw, ih = img.size
    except Exception:
        return img
    iw, ih = int(iw), int(ih)
    if iw <= 0 or ih <= 0:
        return img
    scale = min(cw / float(iw), ch / float(ih))
    nw, nh = max(1, int(round(iw * scale))), max(1, int(round(ih * scale)))
    fitted = _resize_rgb(img, (nw, nh))
    if nw == cw and nh == ch:
        return fitted
    try:
        from PIL import Image as PILImage
        if not isinstance(fitted, PILImage.Image):
            return fitted
        canvas = PILImage.new("RGB", (cw, ch), fill)
        x, y = _anchor_xy(cw, ch, nw, nh, anchor)
        canvas.paste(fitted.convert("RGB"), (x, y))
        return canvas
    except Exception:
        return fitted


def _resize_rgb(img: Any, wh: tuple[int, int]) -> Any:
    try:
        from PIL import Image as PILImage
        return img.resize(wh, resample=PILImage.Resampling.LANCZOS)
    except TypeError:
        return img.resize(wh)
    except Exception:
        try:
            return img.resize(wh)
        except Exception:
            return img


def _cap_edge(img: Any, max_edge: int) -> Any:
    try:
        w, h = img.size
    except Exception:
        return img
    m = max(int(w), int(h))
    if m <= max_edge:
        return img
    scale = max_edge / float(m)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    return _resize_rgb(img, (nw, nh))


def pack_edit_images(target: Any, identity: Any = None, canvas_w: Optional[int] = None, canvas_h: Optional[int] = None) -> Any:
    """Qwen-Edit-Plus: first image is the edit target, later images are ID/refs.

    Target is fit-contained (never stretched). Identity is capped on long edge, ratio kept.
    """
    if target is None:
        return None
    t = target
    if canvas_w and canvas_h:
        t = fit_contain(target, int(canvas_w), int(canvas_h))
    if identity is None:
        return t
    return [t, _cap_edge(identity, 1024)]


def generate_pil(prompt: str, *, model: Optional[str] = None, width: int = 1328, height: int = 1328,
                 steps: Optional[int] = None, guidance: Optional[float] = None, seed: Optional[int] = None,
                 lora_strength: Optional[float] = None,
                 image_b64: Optional[str] = None,
                 id_image_b64: Optional[str] = None,
                 faceswap: bool = False,
                 id_type: str = "",
                 id_kind: str = "",
                 anchor: str = "center",
                 on_step: Optional[Callable[..., Any]] = None):
    import torch
    mid = resolve_model_id(model)
    params = sampler_params(mid)
    max_edge = int(os.environ.get("SAMPLER_MAX_EDGE", str(params["max_edge"])))
    media_w, media_h = _clamp_edge(width, height, max_edge)
    n_steps = int(steps if steps is not None else os.environ.get("SAMPLER_STEPS", params["steps"]))
    gscale = float(guidance if guidance is not None else os.environ.get("SAMPLER_GUIDANCE", params["guidance"]))
    # Per-request LoRA: set env before first load so attach uses it; rescale if already loaded.
    if lora_strength is not None and mid == QUALITY_MODEL_ID:
        os.environ["SAMPLER_LORA_STRENGTH"] = str(float(lora_strength))
    pipe = load_pipe(mid)
    holder = [pipe]
    if lora_strength is not None and mid == QUALITY_MODEL_ID:
        apply_lora_strength(mid, float(lora_strength))
    if faceswap:
        prompt = compose_faceswap_prompt(prompt)
    ref = _decode_image_b64(image_b64)
    ident = _decode_image_b64(id_image_b64)
    # Source content keeps its own ratio. Media size is only the output frame.
    # ID/passport uses ISO/IEC 7810 physical aspect, not the phone-scan crop.
    gen_w, gen_h = media_w, media_h
    if ref is not None:
        try:
            iw, ih = ref.size
            rw, rh = float(iw), float(ih)
            if id_type:
                from id_pipeline import id_content_ratio
                rw, rh = id_content_ratio(id_type, iw, ih)
            gen_w, gen_h = fit_size_inside(rw, rh, media_w, media_h)
        except Exception:
            gen_w, gen_h = media_w, media_h
    kwargs: dict[str, Any] = dict(prompt=prompt, width=gen_w, height=gen_h, num_inference_steps=n_steps, guidance_scale=gscale)
    packed = pack_edit_images(ref, ident, gen_w, gen_h)
    if packed is not None:
        # Qwen-Image-Edit-Plus: image=[target, identity].
        kwargs["image"] = packed
    if id_type:
        from id_pipeline import ID_NEGATIVE_PROMPT
        kwargs["negative_prompt"] = ID_NEGATIVE_PROMPT
        kwargs["true_cfg_scale"] = 4.0
    if seed is not None:
        try:
            kwargs["generator"] = torch.Generator(device=_device()).manual_seed(int(seed))
        except Exception:
            kwargs["generator"] = torch.Generator().manual_seed(int(seed))

    def _cb(pipe_obj, step_idx, timestep, callback_kwargs):
        if on_step:
            try:
                on_step(pipe_obj, step_idx, timestep, callback_kwargs)
            except Exception:
                pass
        return callback_kwargs

    def _call(kw: dict[str, Any]):
        p = holder[0]
        attempt = dict(kw)
        for _ in range(3):
            try:
                if on_step:
                    return p(**attempt, callback_on_step_end=_cb)
                return p(**attempt)
            except TypeError as exc:
                msg = str(exc).lower()
                dropped = False
                if "true_cfg_scale" in attempt and ("true_cfg" in msg or "unexpected keyword" in msg):
                    attempt.pop("true_cfg_scale", None)
                    dropped = True
                elif "negative_prompt" in attempt and ("negative" in msg or "unexpected keyword" in msg):
                    attempt.pop("negative_prompt", None)
                    dropped = True
                if dropped:
                    continue
                raise

    def _invoke(kw: dict[str, Any]):
        try:
            return _call(kw)
        except TypeError:
            img_arg = kw.get("image")
            if isinstance(img_arg, list) and len(img_arg) >= 2:
                target, ident_img = img_arg[0], img_arg[1]
                for extra_key in ("ref_images", "image_2", "extra_images"):
                    alt = dict(kw)
                    alt["image"] = target
                    alt[extra_key] = [ident_img] if extra_key == "ref_images" else ident_img
                    try:
                        return _call(alt)
                    except TypeError:
                        alt.pop(extra_key, None)
                kw = dict(kw)
                kw["image"] = target
                try:
                    return _call(kw)
                except TypeError:
                    kw.pop("image", None)
                    return pipe(**kw)
            if "image" in kw:
                kw = dict(kw)
                kw.pop("image", None)
                try:
                    return _call(kw)
                except TypeError:
                    return pipe(**kw)
            return pipe(**kw)

    ctx = torch.inference_mode() if hasattr(torch, "inference_mode") else torch.no_grad()
    oom_err = getattr(getattr(torch, "cuda", None), "OutOfMemoryError", RuntimeError)
    with ctx:
        try:
            out = _invoke(kwargs)
        except oom_err:
            print("infer OOM; evict, reload, retry")
            unload_pipes()
            _cuda_gc()
            holder[0] = load_pipe(mid)
            if lora_strength is not None and mid == QUALITY_MODEL_ID:
                apply_lora_strength(mid, float(lora_strength))
            out = _invoke(kwargs)
    img = out.images[0]
    if id_type and packed is not None:
        try:
            from id_pipeline import lock_source_document
            src = packed[0] if isinstance(packed, list) else packed
            kind = (id_kind or ("portrait" if ident is not None else "clean")).strip().lower()
            img = lock_source_document(src, img, kind=kind, id_type=id_type)
        except Exception:
            pass
    if (gen_w, gen_h) != (media_w, media_h):
        img = fit_contain(img, media_w, media_h, anchor=anchor)
    return img


def generate_png_bytes(prompt: str, *, model: Optional[str] = None, width: int = 1328, height: int = 1328,
                       steps: Optional[int] = None, guidance: Optional[float] = None, seed: Optional[int] = None,
                       lora_strength: Optional[float] = None,
                       image_b64: Optional[str] = None,
                       id_image_b64: Optional[str] = None,
                       faceswap: bool = False,
                       id_type: str = "",
                       id_kind: str = "",
                       anchor: str = "center",
                       on_step: Optional[Callable[..., Any]] = None) -> bytes:
    img = generate_pil(prompt, model=model, width=width, height=height, steps=steps, guidance=guidance, seed=seed,
                       lora_strength=lora_strength, image_b64=image_b64, id_image_b64=id_image_b64,
                       faceswap=faceswap, id_type=id_type, id_kind=id_kind, anchor=anchor, on_step=on_step)
    buf = io.BytesIO()
    # compress_level=1: much faster encode; payload still PNG. Default 6 is a CPU stall after GPU.
    try:
        img.save(buf, format="PNG", compress_level=1)
    except TypeError:
        img.save(buf, format="PNG")
    return buf.getvalue()


UNCENSORED_MODEL_ID = QUALITY_MODEL_ID
ALLOWED_MODEL_IDS = frozenset(MODEL_IDS)
