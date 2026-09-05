# Optional DGX Spark — Qwen abliterated (vLLM)

Copy this folder to a DGX Spark (GB10 / sm_121a). Do not pull weights onto the IDE box.

## Primary recipe

- Weights: THe-Plague/Qwen3.6-35B-A3B-abliterated-NVFP4-MTP (~23.5 GB)
- Alternate: AEON-7/Qwen3.6-35B-A3B-heretic-NVFP4
- Served name: qwen-abliterated
- Port 8000; image vllm/vllm-openai:cu130-nightly
- Optional image: ghcr.io/aeon-7/aeon-vllm-ultimate:latest

## Needs

- DGX Spark GB10 sm_121a + Docker NVIDIA toolkit
- >= 40 GB free disk
- gpu-memory-utilization 0.6

## On Spark

```
cp .env.example .env
./pull-model.sh
docker compose -f docker-compose.qwen-abliterated.yml up -d
./serve-qwen-abliterated.sh
```

## IDE

1. Point IDE at Spark OpenAI base URL (see root README).
2. API tab: choose DGX Spark, enable available, model qwen-abliterated.
3. Palette action: Use Qwen on Spark.
4. Prefer same-origin Vite proxy in DEV.

## Flags

- reasoning-parser qwen3
- enable-auto-tool-choice + tool-call-parser qwen3_coder
- moe-backend marlin
- speculative MTP num_speculative_tokens 3
- Marlin and sm_121a env vars in compose
