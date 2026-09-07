# Abliterated Spark install package

One package other Abliterated users copy onto a **DGX Spark** (GB10, aarch64, CUDA 13). It installs:

1. **Uncensored image generation** on `:7860` (ComfyUI API on `:8188`)
2. Optional **abliterated Qwen** chat — vLLM on `:8000`

GPU weights are pulled **on the Spark only**. Do not run `install.sh` / `pull-models.sh` on the laptop.

## Spark-native image pairing (uncensored)

Both NVFP4 models fit in a sliver of the Spark’s 128 GB unified memory and stay loaded together.

| Role | Served id | What |
| --- | --- | --- |
| **Default / quality** | `krea2-turbo-nvfp4` | Krea 2 Turbo NVFP4 (8-step) + **one uncensor LoRA** (`krea2_uncensor.safetensors`) + Huihui abliterated Qwen3-VL-4B text encoder |
| **Draft / high-volume** | `z-image-turbo-nsfw-nvfp4` | Z-Image Turbo NVFP4 (~5 s sketches, 8-step, no safety checker) |

DreamShaper and other filtered checkpoints are not installed. Unknown `model` ids coerce to `krea2-turbo-nvfp4`. Send `z-image-turbo-nsfw-nvfp4` (or `draft` / `sketch`) for the sketch model.

## From the Abliterated app (Mac / Windows)

1. Pair the Spark in [NVIDIA Sync](https://build.nvidia.com/spark/connect-to-your-spark/sync) so `ssh <alias>` works.
2. API tab → DGX Spark → set **SSH alias** and **LAN host** (e.g. `192.168.4.101`).
3. Palette **Copy Spark install command**, or from the repo / extraResources folder:

```bash
bash spark-install/push.sh YOUR_SYNC_ALIAS --start
```

`--start` installs and launches ComfyUI (`:8188`) plus the OpenAI bridge (`:7860`).

First image-weight pull is tens of GB. Add `--skip-pull` on later updates. Add `--with-text` for Qwen.

## On the Spark (if you copied the folder by hand)

```bash
cd ~/abliterated-spark/spark-install
./install.sh --start
./status.sh
```

## Abliterated IDE

| Surface | Setting |
| --- | --- |
| Images / `generate_image` | base `http://<spark-ip>:7860/v1`, model `krea2-turbo-nvfp4` (or `z-image-turbo-nsfw-nvfp4` for drafts), Via proxy **off** on LAN |
| Chat | API → DGX Spark, base `http://<spark-ip>:8000/v1`, model `qwen-abliterated` |
| ComfyUI graph UI | `http://<spark-ip>:8188` (same uncensored node) |

Palette: **Use Spark image gen** (Krea 2 Turbo NVFP4), **Use Spark draft gen** (Z-Image Turbo NSFW NVFP4), **Use Spark ComfyUI**, **Use Qwen on Spark**.

## Layout after push

```
~/abliterated-spark/
  spark-install/   this package
  spark-image/     OpenAI bridge, uncensored_flux.py, Comfy node + workflow
  spark/           optional vLLM Qwen
~/ComfyUI/         NVIDIA playbook clone (v0.28.2) + custom node
```

## Ports

| Port | Service |
| --- | --- |
| 8188 | ComfyUI |
| 7860 | OpenAI images (`krea2-turbo-nvfp4` / `z-image-turbo-nsfw-nvfp4`) |
| 8000 | vLLM chat (`qwen-abliterated`, optional) |
