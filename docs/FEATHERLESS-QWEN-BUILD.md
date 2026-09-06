# Featherless large-Qwen build (LOCKED)

STOP — LOCKED SPEC OVERRIDE. Discard ≥27B floor / keep-14B.
Default: Qwen/Qwen3-32B. Gate: dense>=32 OR activated>=16; REJECT A3B.
Exception: Qwen3.8-27B abliterated/heretic/uncensored (isQwen38Abliterated27B).
No escape hatch. stripReasoning Instruct-only. Honor tool_choice required.
Empty200 keep tools; thinking max_tokens 8192; 400 strip kwargs first.
Context ignore cards <16384. compactPrompt never for featherless-eligible.
Module: src/lib/featherlessQwen.ts + scripts/test-featherless-qwen.mjs
Do not edit SYSTEM_PROMPT V17 / bridge; no X-Reasoning to Featherless.

## §3.2 ADMIT
- Qwen/Qwen3-32B
- huihui-ai/Qwen3-32B-abliterated
- Qwen/Qwen2.5-72B-Instruct
- huihui-ai/Qwen2.5-72B-Instruct-abliterated
- Qwen/Qwen2.5-Coder-32B-Instruct
- Qwen/Qwen3-235B-A22B
- Qwen/Qwen3.5-397B-A17B
- Qwen/Qwen3-VL-32B-Instruct
- huihui-ai/Huihui-Qwen3.8-27B-abliterated
- OBLITERATUS/Qwen3.8-27B-heretic

## §3.2 REJECT
- Qwen/Qwen2.5-7B-Instruct
- Qwen/Qwen3-8B
- Qwen/Qwen3-14B
- huihui-ai/Huihui-Qwen3.5-27B-abliterated
- Qwen/Qwen3-30B-A3B-Instruct-2507
- Qwen/Qwen3-Next-80B-A3B-Instruct
- Qwen/Qwen3.6-35B-A3B
- huihui-ai/Huihui-Qwen3.6-35B-A3B-abliterated
- meta-llama/Llama-3.3-70B-Instruct
- mlabonne/NeuralLlama-3-8B-Instruct-abliterated

## §3.5 migrate ineligible to Qwen/Qwen3-32B + reasoning max + coalesce
