# Abliterated image generation (Spark)

Local OpenAI image API. Spark ships Build D. See BUILDS.md.

## Defaults

- Quality: krea2-raw-fp8 (24 steps, CFG 3.5, euler/beta, LoRA 0.75)
- Klein: flux2-klein-9b (stub)
- Fast: krea2-turbo-nvfp4 / krea2-turbo-int8 (demoted turbo)
- Draft: z-image-turbo-nsfw-nvfp4

## Quick start (GPU host)

cd spark-image && cp .env.example .env && ./pull-models.sh && python serve-openai-bridge.py

Env: COMFY_STEPS=24 COMFY_CFG=3.5 COMFY_SAMPLER=euler COMFY_SCHEDULER=beta COMFY_LORA_STRENGTH=0.75

Prefer canvas max edge 1328-1536 for RAW.
