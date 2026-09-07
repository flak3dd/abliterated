# Abliterated image builds (A/B/C/D)

Spark ships **Build D** by default. A/B/C are reference profiles for other hardware — not IDE/Spark defaults.

## License notes

| Stack | Typical license | Notes |
| --- | --- | --- |
| **Krea 2** (RAW / Turbo) | Krea Community | Comfy-Org weights for local ComfyUI |
| **FLUX.2 Klein 4B** | Apache-2.0 | Safe for most redistribution |
| **FLUX.2 Klein 9B / FLUX.2 dev** | Often **non-commercial** | Check BFL terms before commercial use |
| **Qwen-Image / Qwen-Edit** | Apache-2.0 | Prefer for bilingual / edit paths |
| **Z-Image Turbo** | Per Comfy-Org / upstream | Draft sketches only |

## Build A — reference (consumer 16–24 GB)

Not shipped. Turbo FP8 / NVFP4 at 8 steps CFG 1 for speed on mid cards.

## Build B — reference (48 GB workstation)

Not shipped. Mix of Turbo INT8/FP8 + optional RAW at reduced canvas.

## Build C — reference (cloud / multi-GPU)

Not shipped. Full BF16 RAW + upscalers; ping-pong weights OK.

## Build D — DGX Spark 128 GB (resident) — **SHIPPED DEFAULT**

Keep models resident; no ping-pong. Abliterated IDE + `spark-install` default to this stack.

| Role | Model id | Weights | Sampler |
| --- | --- | --- | --- |
| **Hero photo (DEFAULT)** | `krea2-raw-fp8` | `krea2_raw_fp8_scaled.safetensors` + uncensor LoRA @ **0.75** (+ optional nudes LoRA 0.7–1.0) | **24 steps**, **CFG 3.5**, **euler + beta** |
| **Second / adherence** | `flux2-klein-9b` | Klein **9B base** (not 4-step distilled, not 4B) + NSFW UNLOCKED LoRA @ 0.5–0.9 | ~28 steps, CFG ~3.5, euler/beta (**stub** until HF path confirmed) |
| **Type / bilingual** | `qwen-image-2512-fp8` | Qwen-Image 2512 FP8 | **stub** — see `models.json` TODO URLs |
| **Edit** | `qwen-edit-2511-fp8` | Qwen-Edit 2511 FP8 + NSFW LoRA | **stub** |
| **Upscale** | `seedvr2-7b-fp8` | SeedVR2 7B FP8 tiled | Document only — do **not** sample RAW at 4K |
| **Anime** | `illustrious-wai-nsfw` | Illustrious WAI-NSFW or Pony | Optional slot |
| **Fast / Turbo** | `krea2-turbo-nvfp4` / `krea2-turbo-int8` | Turbo quants | 8 steps, CFG 1, euler/simple (**demoted**) |
| **Draft** | `z-image-turbo-nsfw-nvfp4` | Z-Image Turbo NVFP4 | Sketches only |
| **TE** | (shared) | Huihui abliterated Qwen3-VL-4B | Already on quality path |

### Critical RAW settings (do **not** use turbo recipe)

- Steps **20–30** (default **24**)
- CFG **3–3.5** (default **3.5**)
- Sampler **euler** + scheduler **beta**
- Canvas prefer **1328–1536** max edge; upscale later with SeedVR2
- Uncensor LoRA strength default **0.75** (range 0.7–1.0)

### Pull on Spark

```bash
cd ~/abliterated-spark/spark-image   # or spark-install path
./pull-models.sh                    # pulls RAW FP8 ~13.1GB + TE/VAE + draft + optional turbo
```

Klein 9B / Qwen-Image / Edit are stubbed — place weights when available; see `models.json` TODO entries.
