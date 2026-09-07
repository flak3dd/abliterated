# Abliterated image generation (FLUX.2 Klein)

`api.abliteration.ai` has **no** `/v1/images/generations` — cloud images are multimodal *input* only. This folder serves an optional **local** OpenAI-compatible image API for the IDE Images tab / `generate_image` tool.

## Model path (abliterated)

- **Base DiT:** [`black-forest-labs/FLUX.2-klein-base-4B`](https://huggingface.co/black-forest-labs/FLUX.2-klein-base-4B) — DiT itself has no refusal layer.
- **Abliterated text encoder (pick one):**
  - [`PinoCookie/Flux.2-klein-4B-abliterated-text-encoder`](https://huggingface.co/PinoCookie/Flux.2-klein-4B-abliterated-text-encoder)
  - [`ponpoke/flux2-klein-4b-uncensored-text-encoder`](https://huggingface.co/ponpoke/flux2-klein-4b-uncensored-text-encoder)

Do **not** download multi-GB weights onto the IDE box — run these scripts on a Spark / GB10 / consumer NVIDIA host.

## VRAM

Roughly **8–13 GB** for Klein 4B depending on dtype and resolution. Works on DGX Spark / GB10 and mid-range NVIDIA GPUs.

## Quick start

```bash
cd spark-image
cp .env.example .env
# edit HF token / encoder repo if needed
./pull-models.sh          # on the GPU host only
python serve-openai-bridge.py
# listens http://127.0.0.1:7860  model id: abliterated-flux-klein
```

Or Docker:

```bash
docker compose up --build
```

## Mock (no GPU)

For IDE / proxy smoke tests without weights:

```bash
# from repo root
npm run image:mock

# or from this folder
ABLITERATED_IMAGE_MOCK=1 python3 serve-openai-bridge.py
```

Listens on `http://127.0.0.1:7860` (model id `abliterated-flux-klein`) and returns a stub PNG.
A blank HTTP 500 from the IDE Vite `/image-v1` proxy usually means nothing is listening on :7860.

## IDE wiring

1. Images tab → enable image generator  
2. Base URL `http://127.0.0.1:7860/v1` (DEV uses Vite `/image-v1` proxy when Via proxy is on)  
3. Model `abliterated-flux-klein`  
4. Test / Generate  

Chat tool `generate_image` is exposed only when image gen is enabled.

## DGX Spark (GB10)

Copy this folder to the Spark (do not pull weights onto the IDE box). Native venv — stock `pytorch/pytorch` CUDA 12.4 images are amd64.

```bash
# on Spark
cd ~/spark-image
python3 -m venv .venv
.venv/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/cu130
.venv/bin/pip install fastapi 'uvicorn[standard]' pydantic 'diffusers>=0.32.0' 'transformers>=4.45.0' accelerate safetensors Pillow huggingface_hub
./pull-models.sh
ABLITERATED_IMAGE_HOST=0.0.0.0 ./serve-spark.sh
```

Listens `http://<spark-ip>:7860/v1`. Spark image gen is **Krea 2 Turbo NVFP4 + one uncensor LoRA** (`krea2-turbo-nvfp4`) by default, with **Z-Image Turbo NSFW NVFP4** (`z-image-turbo-nsfw-nvfp4`) kept loaded for high-volume drafts. Palette **Use Spark image gen** / **Use Spark draft gen**. **Via Vite proxy off**.

## ComfyUI on Spark (install package)

Use [`spark-install/`](../spark-install/) — `push.sh` from the Mac, `install.sh --start` on the Spark. That pulls **Krea 2 Turbo NVFP4** + Huihui abliterated Qwen3-VL + **one uncensor LoRA**, and **Z-Image Turbo NVFP4** for drafts. Do not pull those weights onto the IDE box.

| Surface | URL |
| --- | --- |
| ComfyUI graph UI | `http://<spark-ip>:8188` |
| OpenAI images API | `http://<spark-ip>:7860/v1` |
| Quality model | `krea2-turbo-nvfp4` |
| Draft model | `z-image-turbo-nsfw-nvfp4` |

Workflows: `workflows/txt2img-krea2-turbo-nvfp4.json` (default, 8 Euler steps) and `workflows/txt2img-zimage-turbo-nvfp4.json`. Palette **Use Spark image gen** / **Use Spark draft gen**.
