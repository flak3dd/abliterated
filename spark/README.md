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
- HF_TOKEN only if the repo is gated (token + accept terms on the model page). THe-Plague NVFP4 currently pulls unauthenticated.

`vllm/vllm-openai:cu130-nightly` ENTRYPOINT is already `vllm serve`. Compose `command` starts at the model path. Prefixing `vllm serve` crash-loops with `unrecognized arguments: serve /models/current`.

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
- NVFP4 GEMM via VLLM_NVFP4_GEMM_BACKEND=marlin (do not pass --moe-backend marlin — MTP draft layers are unquantized and crash-loop)
- speculative MTP num_speculative_tokens 3
- Marlin and sm_121a env vars in compose


## Abliterated LLM priority (Prompt LLM on :8000 — not image TE)

1. **Default:** `THe-Plague/Qwen3.6-35B-A3B-abliterated-NVFP4-MTP` (~23.5 GB) → served `qwen-abliterated`, `gpu-memory-utilization=0.6`
2. AEON-7/Qwen3.6-35B-A3B-heretic-NVFP4 — heretic twin
3. YuYu1015/Huihui-Qwen3.6-35B-A3B-abliterated-int4-AutoRound — GB10 SM121
Alt: huihui-ai/Huihui-Qwen3.8-27B-abliterated / orcarouter/Qwen3.8-27B-Uncensored

Image TE (Huihui Qwen3-VL-4B on Krea hero) is separate from this sidecar.
