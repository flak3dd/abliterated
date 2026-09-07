#!/usr/bin/env bash
# Pull Build D Spark-resident image weights onto the GPU host only.
# Quality (default): Krea 2 RAW FP8 + abliterated Qwen3-VL + uncensor LoRA
# Fast (optional):   Krea 2 Turbo NVFP4 / INT8
# Draft:             Z-Image Turbo NVFP4 (sketches)
# Klein / Qwen-Image / Edit: see BUILDS.md — stub URLs not fetched here
set -euo pipefail
cd "$(dirname "$0")"
if [[ -f .env ]]; then set -a; source .env; set +a; fi

COMFY_ROOT="${COMFY_ROOT:-$HOME/ComfyUI}"
HF_BASE="https://huggingface.co"

fetch() {
  local url="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  if [[ -f "$dest" && -s "$dest" ]]; then
    echo "exists $(du -h "$dest" | awk '{print $1}') $dest"
    return 0
  fi
  echo "GET $url"
  if command -v wget >/dev/null 2>&1; then
    wget -c -O "$dest.partial" "$url"
  else
    curl -L --retry 5 -C - -o "$dest.partial" "$url"
  fi
  mv "$dest.partial" "$dest"
  echo "saved $dest"
}

echo "ComfyUI models -> $COMFY_ROOT/models (Build D)"

# Quality (required): RAW FP8 DiT ~13.1GB
fetch "$HF_BASE/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_raw_fp8_scaled.safetensors" \
  "$COMFY_ROOT/models/diffusion_models/krea2_raw_fp8_scaled.safetensors"
fetch "$HF_BASE/ahmed22xa/Huihui-Qwen3-VL-4B-Instruct-abliterated-comfy/resolve/main/Huihui-Qwen3-VL-4B-Instruct-abliterated-fp8_scaled.safetensors" \
  "$COMFY_ROOT/models/text_encoders/Huihui-Qwen3-VL-4B-Instruct-abliterated-fp8_scaled.safetensors"
fetch "$HF_BASE/Comfy-Org/Krea-2/resolve/main/vae/qwen_image_vae.safetensors" \
  "$COMFY_ROOT/models/vae/qwen_image_vae.safetensors"

# Fast (optional turbo tier)
if [[ "${PULL_FAST:-1}" == "1" ]]; then
  fetch "$HF_BASE/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_nvfp4.safetensors" \
    "$COMFY_ROOT/models/diffusion_models/krea2_turbo_nvfp4.safetensors"
fi
if [[ "${PULL_FAST_INT8:-0}" == "1" ]]; then
  fetch "$HF_BASE/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_int8_convrot.safetensors" \
    "$COMFY_ROOT/models/diffusion_models/krea2_turbo_int8_convrot.safetensors"
fi

# Draft
fetch "$HF_BASE/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_nvfp4.safetensors" \
  "$COMFY_ROOT/models/diffusion_models/z_image_turbo_nvfp4.safetensors"
fetch "$HF_BASE/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b_fp8_mixed.safetensors" \
  "$COMFY_ROOT/models/text_encoders/qwen_3_4b_fp8_mixed.safetensors"
fetch "$HF_BASE/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors" \
  "$COMFY_ROOT/models/vae/ae.safetensors"

LORA_DEST="$COMFY_ROOT/models/loras/krea2_uncensor.safetensors"
mkdir -p "$(dirname "$LORA_DEST")"
if [[ ! -s "$LORA_DEST" ]]; then
  echo "GET Krea2 uncensor LoRA (Civitai modelVersion 3084588)"
  CIVA_URL="https://civitai.com/api/download/models/3084588"
  if [[ -n "${CIVITAI_API_TOKEN:-}" ]]; then
    CIVA_URL="${CIVA_URL}?token=${CIVITAI_API_TOKEN}"
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -c -O "$LORA_DEST.partial" "$CIVA_URL" || true
  else
    curl -L --retry 3 -C - -o "$LORA_DEST.partial" "$CIVA_URL" || true
  fi
  sz="$(wc -c < "$LORA_DEST.partial" 2>/dev/null || echo 0)"
  if [[ -s "$LORA_DEST.partial" && "$sz" -gt 1000000 ]]; then
    mv "$LORA_DEST.partial" "$LORA_DEST"
    echo "saved uncensor LoRA $LORA_DEST"
  else
    rm -f "$LORA_DEST.partial"
    echo "WARNING: uncensor LoRA download failed. Quality graph will run with abliterated Qwen3-VL only."
    echo "Place krea2_uncensor.safetensors in $COMFY_ROOT/models/loras/ and restart."
  fi
else
  echo "exists uncensor LoRA $LORA_DEST"
fi

echo "Done. Quality=krea2-raw-fp8  Fast=krea2-turbo-nvfp4  Draft=z-image-turbo-nsfw-nvfp4"
echo "Build D: pull RAW FP8 (~13.1GB) required. Klein 9B / Qwen-Image / Edit are stubs — see BUILDS.md"
