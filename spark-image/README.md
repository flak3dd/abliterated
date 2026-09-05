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
