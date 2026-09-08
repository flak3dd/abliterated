# Abliterated image generation (Spark) — Build D

Hero: **`krea2-raw-fp8`** (Krea2Pipeline + Huihui TE + uncensor LoRA @ 0.75). **Not Klein.**

```bash
cd spark-image && cp .env.example .env && ./pull-models.sh && ./serve-spark.sh
```

Env: `FLUX_MODEL_ID=krea2-raw-fp8` `SAMPLER_STEPS=24` `SAMPLER_GUIDANCE=3.5` `SAMPLER_SAMPLER=euler` `SAMPLER_SCHEDULER=beta` `SAMPLER_LORA_STRENGTH=0.75` `SAMPLER_MAX_EDGE=1536`

Prompt LLM sidecar stays `:8000` (`qwen-abliterated`). Image TE ≠ LLM. No ComfyUI. See BUILDS.md.
