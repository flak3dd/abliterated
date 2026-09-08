#!/usr/bin/env bash
# Pull Build D Diffusers hero into spark-image/models/ (NOT ~/ComfyUI).
# Priority: (1) Krea RAW + LoRA 0.75 (2) Huihui TE (3) optional Klein/Edit/SeedVR2/Qwen/Z-Image/Anime
set -euo pipefail
cd "$(dirname "$0")"
if [[ -f .env ]]; then set -a; source .env; set +a; fi
MODELS_DIR="${SPARK_IMAGE_MODELS:-${ABLITERATED_IMAGE_MODELS:-$PWD/models}}"
HF_BASE="https://huggingface.co"
RAW_REPO="${KREA_RAW_REPO:-krea/Krea-2-Raw}"
TE_REPO="${KREA_TEXT_ENCODER_REPO:-${HUIHUI_TE_REPO:-huihui-ai/Huihui-Qwen3-VL-4B-Instruct-abliterated}}"
HF_TOKEN="${HF_TOKEN:-}"
PULL_TURBO="${PULL_TURBO:-0}"
PULL_KLEIN="${PULL_KLEIN:-0}"
PULL_QWEN_IMAGE="${PULL_QWEN_IMAGE:-0}"
PULL_QWEN_EDIT="${PULL_QWEN_EDIT:-0}"
PULL_DRAFT="${PULL_DRAFT:-0}"
PULL_ANIME="${PULL_ANIME:-0}"
mkdir -p "$MODELS_DIR"/{diffusion_models,text_encoders,vae,loras}

hf_snapshot() {
  local repo="$1" dest="$2"; mkdir -p "$dest"; local extra=()
  [[ -n "$HF_TOKEN" ]] && extra+=(--token "$HF_TOKEN")
  if command -v hf >/dev/null 2>&1; then echo "hf download $repo -> $dest"; hf download "$repo" --local-dir "$dest" "${extra[@]}"
  elif command -v huggingface-cli >/dev/null 2>&1; then echo "huggingface-cli download $repo -> $dest"; huggingface-cli download "$repo" --local-dir "$dest" "${extra[@]}"
  else echo "ERROR: need hf or huggingface-cli" >&2; return 1; fi
}
fetch_file() {
  local url="$1" dest="$2"; mkdir -p "$(dirname "$dest")"
  if [[ -f "$dest" && -s "$dest" ]]; then echo "exists $(du -h "$dest" | awk '{print $1}') $dest"; return 0; fi
  echo "GET $url"
  if command -v curl >/dev/null 2>&1; then curl -L --retry 5 -C - -o "$dest.partial" "$url"; else wget -c -O "$dest.partial" "$url"; fi
  mv "$dest.partial" "$dest"; echo "saved $dest"
}

echo "Build D models -> $MODELS_DIR (Diffusers; no ComfyUI)"
echo "Priority: Krea RAW hero > Huihui TE > LoRA > (optional) Klein/Edit/SeedVR2"
hf_snapshot "$RAW_REPO" "$MODELS_DIR/Krea-2-Raw"
fetch_file "$HF_BASE/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_raw_fp8_scaled.safetensors" "$MODELS_DIR/diffusion_models/krea2_raw_fp8_scaled.safetensors" || true
fetch_file "$HF_BASE/Comfy-Org/Krea-2/resolve/main/vae/qwen_image_vae.safetensors" "$MODELS_DIR/vae/qwen_image_vae.safetensors" || true
hf_snapshot "$TE_REPO" "$MODELS_DIR/Huihui-Qwen3-VL-4B-Instruct-abliterated" || true
fetch_file "$HF_BASE/ahmed22xa/Huihui-Qwen3-VL-4B-Instruct-abliterated-comfy/resolve/main/Huihui-Qwen3-VL-4B-Instruct-abliterated-fp8_scaled.safetensors" \
  "$MODELS_DIR/text_encoders/Huihui-Qwen3-VL-4B-Instruct-abliterated-fp8_scaled.safetensors" || true

LORA_DEST="$MODELS_DIR/loras/krea2_uncensor.safetensors"
LORA_HF="$HF_BASE/Sentinel7/krea2/resolve/main/2742640/3084588/Krea2%20NSFW%2B.safetensors"
if [[ -s "$LORA_DEST" ]]; then echo "exists uncensor LoRA $LORA_DEST"
else
  echo "GET uncensor LoRA (HF Sentinel7)"; curl -L --retry 5 -C - -o "$LORA_DEST.partial" "$LORA_HF" || true
  sz="$(wc -c < "$LORA_DEST.partial" 2>/dev/null || echo 0)"
  if [[ -s "$LORA_DEST.partial" && "$sz" -gt 1000000 ]]; then mv "$LORA_DEST.partial" "$LORA_DEST"; echo "saved $LORA_DEST"
  else rm -f "$LORA_DEST.partial"; echo "WARNING: place krea2_uncensor.safetensors in $MODELS_DIR/loras/"; fi
fi

[[ "$PULL_TURBO" == "1" ]] && hf_snapshot "${KREA_TURBO_REPO:-krea/Krea-2-Turbo}" "$MODELS_DIR/Krea-2-Turbo"
[[ "$PULL_KLEIN" == "1" ]] && { echo "Klein 9B gated"; hf_snapshot "${FLUX_KLEIN_BASE_REPO:-black-forest-labs/FLUX.2-klein-base-9B}" "$MODELS_DIR/FLUX.2-klein-base-9B" || true; }
[[ "$PULL_QWEN_IMAGE" == "1" ]] && hf_snapshot "${QWEN_IMAGE_REPO:-Qwen/Qwen-Image}" "$MODELS_DIR/Qwen-Image"
[[ "$PULL_QWEN_EDIT" == "1" ]] && hf_snapshot "${QWEN_EDIT_REPO:-Qwen/Qwen-Image-Edit-2511}" "$MODELS_DIR/Qwen-Image-Edit-2511"
[[ "$PULL_DRAFT" == "1" ]] && echo "Draft Z-Image: set ZIMAGE_REPO and pull manually when HF path confirmed"
[[ "$PULL_ANIME" == "1" ]] && echo "Anime zoo (illustrious-wai-nsfw / pony-v6): optional — place checkpoints under $MODELS_DIR/ (not hero)"

echo "NSFW LoRA dests (optional): loras/qwen_image_nsfw.safetensors @0.7  loras/qwen_edit_nsfw.safetensors @0.7"
echo "Done Quality=krea2-raw-fp8"
echo "TE: Huihui abliterated Qwen3-VL-4B (image TE — NOT :8000 LLM). Alt: KREA_TEXT_ENCODER_REPO=Heretic twin"
echo "Note: TE swap alone != full unlock; DiT + uncensor LoRA @ 0.75 complete Build D"
