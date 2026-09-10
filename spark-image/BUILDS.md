# Abliterated image builds — Build D (canonical priority)

**ComfyUI out of scope.** Diffusers OpenAI bridge `:7860`. LLM sidecar `:8000`.

## Greg lock / priority (do not reorder hero to Klein)

1. **Hero** `krea2-raw-fp8` + uncensor LoRA **0.75**, **24 / 3.5 / euler+beta**, max edge **1328–1536**
2. **TE** Huihui Qwen3-VL-4B (load-time swap on Krea hero; alt Heretic via `KREA_TEXT_ENCODER_REPO`)
3. **Sidecar** Qwen3.6-35B-A3B abliterated NVFP4/INT4 on `:8000` (`qwen-abliterated`)
4. **Then** Klein 9B base, Qwen-Edit-2511, SeedVR2

| Role | id | Diffusers | Notes |
| --- | --- | --- | --- |
| Hero | `krea2-raw-fp8` | `Krea2Pipeline` ← `krea/Krea-2-Raw` | DEFAULT |
| Fast (demoted) | `krea2-turbo` | `Krea2Pipeline` Turbo | 8 / guidance 0.0 |
| Draft | `z-image-turbo-nsfw-nvfp4` | `ZImagePipeline` | sketches only |
| Instruction | `qwen-image-2512-fp8` | `QwenImagePipeline` | first-class; NSFW LoRA slot |
| Edit | `qwen-edit-2511-fp8` | `QwenImageEditPlusPipeline` | first-class; img2img/multi-ref |
| Adherence | `flux2-klein-9b` | `Flux2KleinPipeline` base-9B | after hero |
| Upscale | `seedvr2-7b-fp8` | SeedVR2 | never native 4K RAW |
| Anime zoo | `illustrious-wai-nsfw` / `pony-v6` | optional | NOT quality default |

Hardware: aarch64, CUDA 13, sm_121, 128GB unified, diffusers ≥ 0.39.

### Prompt LLM (sidecar, not image TE)

Default: `THe-Plague/Qwen3.6-35B-A3B-abliterated-NVFP4-MTP` → `qwen-abliterated`, gpu-memory-utilization 0.6.  
Alts: AEON-7 heretic twin; YuYu1015 Huihui int4; Huihui/OrcaRouter Qwen 27B/35B-A3B. See `../spark/README.md`.
