# Spark image generation workflow

Uncensored two-path ComfyUI stack on DGX Spark (GB10, 128 GB unified). Abliterated talks OpenAI `POST /v1/images/generations` on `:7860`; ComfyUI owns the GPU on `:8188`.

There is **no** prompt-expansion LLM, **no** safety checker, **no** “assume clothing” system prompt. The official Krea template’s TextGenerate block is omitted on purpose.

## Pairing

| Path | Served id | File | Time | Use |
| --- | --- | --- | --- | --- |
| **Quality (default)** | `krea2-turbo-nvfp4` | `krea2_turbo_nvfp4.safetensors` (~7.2 GB) + Huihui abliterated Qwen3-VL-4B + **one uncensor LoRA** | 8 Euler steps | Final / high-aesthetic stills |
| **Draft** | `z-image-turbo-nsfw-nvfp4` | `z_image_turbo_nvfp4.safetensors` (~4.2 GB) | 8 Euler steps, ~5 s | High-volume sketches |

Both NVFP4 DiTs stay resident. Together they are a sliver of 128 GB.

Aliases → quality: `krea2`, `quality`, `abliterated-flux-klein` (legacy).  
Aliases → draft: `draft`, `sketch`, `z-image`, `zimage`.

## Files on the Spark

```
~/ComfyUI/models/
  diffusion_models/
    krea2_turbo_nvfp4.safetensors          # quality DiT
    z_image_turbo_nvfp4.safetensors        # draft DiT
  text_encoders/
    Huihui-Qwen3-VL-4B-Instruct-abliterated-fp8_scaled.safetensors
    qwen_3_4b_fp8_mixed.safetensors
  vae/
    qwen_image_vae.safetensors             # Krea
    ae.safetensors                         # Z-Image
  loras/
    krea2_uncensor.safetensors             # one DiT uncensor LoRA (quality path)
```

Machine graphs (Comfy `/prompt` API format):

- Quality: [`txt2img-krea2-turbo-nvfp4.json`](txt2img-krea2-turbo-nvfp4.json)
- Quality if LoRA missing: [`txt2img-krea2-turbo-nvfp4-nolor.json`](txt2img-krea2-turbo-nvfp4-nolor.json)
- Draft: [`txt2img-zimage-turbo-nvfp4.json`](txt2img-zimage-turbo-nvfp4.json)

`spark_models.workflow_for()` picks quality vs draft vs no-LoRA at request time.

## Quality path — Krea 2 Turbo NVFP4 + uncensor LoRA

8-step distilled DiT. CFG 1, Euler / simple, denoise 1. Negative is **zeroed** (`ConditioningZeroOut`) so the sampler does not steer away from the prompt. Uncensor is two-layer:

1. **Text encoder** — Huihui abliterated Qwen3-VL-4B (`CLIPLoader` type `krea2`). This is where Krea 2’s filter lives.
2. **DiT LoRA** — `krea2_uncensor.safetensors` at strength **1.0** (`LoraLoaderModelOnly`). One LoRA only.

```
UNETLoader (10)  krea2_turbo_nvfp4.safetensors
        |
        v
LoraLoaderModelOnly (15)  krea2_uncensor.safetensors  strength_model=1
        |
        +----------------------------+
        v                            |
KSampler (3)                         |
  steps=8 cfg=1 euler/simple         |
  denoise=1                          |
        ^                            |
        | model                      |
CLIPLoader (11)  Huihui abliterated  |
  type=krea2                         |
        |                            |
        v                            |
CLIPTextEncode (6)  text=user prompt |
        |                            |
        +---> ConditioningZeroOut (13) --> KSampler.negative
        +---> KSampler.positive
EmptyLatentImage (5)  WxH batch=1 -------> KSampler.latent_image
        |
        v
VAEDecode (8)  VAE=qwen_image_vae
        |
        v
SaveImage (9)  prefix=ablit-krea2
```

| Node | class_type | Job |
| --- | --- | --- |
| 10 | `UNETLoader` | Load NVFP4 Krea 2 Turbo DiT (`weight_dtype=default`, Comfy-Kitchen NVFP4 kernels on GB10) |
| 11 | `CLIPLoader` | Abliterated Qwen3-VL-4B, **type `krea2`**, device default |
| 12 | `VAELoader` | `qwen_image_vae.safetensors` |
| 15 | `LoraLoaderModelOnly` | Uncensor LoRA on the DiT only (CLIP already abliterated) |
| 6 | `CLIPTextEncode` | User prompt only. Placeholder `PROMPT` is replaced by `comfy_client.apply_prompt` |
| 13 | `ConditioningZeroOut` | Empty negative; do not inject “blurry, nsfw, …” |
| 5 | `EmptyLatentImage` | Default 1024×1024; Abliterated `size` maps here |
| 3 | `KSampler` | 8 / 1 / euler / simple / denoise 1. Seed randomized unless provided |
| 8 | `VAEDecode` | Latent → RGB |
| 9 | `SaveImage` | Comfy output; bridge then `GET /view` → PNG → `b64_json` |

Not in this graph (deliberate):

- Official Krea **TextGenerate / prompt enhance** (system prompt tells the model to cover anatomy).
- Style LoRAs (`krea2_darkbrush`, watercolor, …). Quality path is uncensor-only.
- Safety checker, watermarker, NSFW node.

## Draft path — Z-Image Turbo NSFW NVFP4

Same 8-step Euler/simple recipe, no LoRA, Z-Image VAE (`ae.safetensors`), CLIP type **`lumina2`**. Meant to stay loaded for high-volume sketches.

```
UNETLoader (10)  z_image_turbo_nvfp4.safetensors
        |
        v
KSampler (3)  8 / 1 / euler / simple
        ^
CLIPLoader (11)  qwen_3_4b_fp8_mixed  type=lumina2
        |
CLIPTextEncode (6) --> positive
        +--> ConditioningZeroOut (13) --> negative
EmptyLatentImage (5) --> latent
VAELoader (12) ae.safetensors --> VAEDecode (8) --> SaveImage (9) prefix=ablit-zimage
```

## Abliterated request path

```
Images tab / generate_image
        |
        |  POST { prompt, size, model, n }  (no Via-proxy on LAN)
        v
http://<spark-ip>:7860/v1/images/generations
        |
        |  spark_models.resolve_model_id
        |  spark_models.workflow_for  → JSON above
        |  comfy_client.apply_prompt  → fill PROMPT, WxH, seed, steps
        v
ComfyUI POST /prompt   (127.0.0.1:8188)
        |
        |  poll GET /history/{id}
        |  GET /view?filename=…
        v
bridge returns { model, data: [{ b64_json }] }
        |
        v
Images library / chat tool
```

If Comfy is down, the bridge falls back to the local uncensored FLUX helper only as a last resort. Spark install always starts Comfy first.

### HTTP example

```bash
# quality
curl -sS http://192.168.4.101:7860/v1/images/generations \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"a red cube on a steel bench, studio light","model":"krea2-turbo-nvfp4","size":"1024x1024"}'

# draft / sketch
curl -sS http://192.168.4.101:7860/v1/images/generations \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"same cube, quick blocking","model":"z-image-turbo-nsfw-nvfp4","size":"1024x1024"}'
```

### IDE

1. API tab → Spark LAN host (e.g. `192.168.4.101`), SSH alias, **Copy Spark install command**.
2. Palette **Use Spark image gen** → `krea2-turbo-nvfp4`, base `http://<host>:7860/v1`, proxy off.
3. Palette **Use Spark draft gen** → `z-image-turbo-nsfw-nvfp4`.
4. Images tab: prompt, size 1024 / 768 / 512, Generate. Chat tool `generate_image` uses the same model id.

## Sampler table

| | Quality | Draft |
| --- | --- | --- |
| Steps | 8 | 8 |
| CFG | 1 | 1 |
| Sampler | euler | euler |
| Scheduler | simple | simple |
| Denoise | 1 | 1 |
| Default size | 1024×1024 | 1024×1024 |
| Negative | zeroed | zeroed |
| LoRA | `krea2_uncensor` @ 1.0 | none |

## NVIDIA Sync Custom app

Sync **Settings → Custom** runs a bash Launch Script on the Spark and tunnels the port to `localhost`. Use that as the open-on-click entry:

- **8188** — [`nvsync/port-8188.bash`](../../spark-install/nvsync/port-8188.bash) — ComfyUI graph UI  
- **7860** — [`nvsync/port-7860.bash`](../../spark-install/nvsync/port-7860.bash) — OpenAI images API (starts Comfy if needed)

See [`spark-install/nvsync/README.md`](../../spark-install/nvsync/README.md).

## Run it

```bash
bash spark-install/push.sh YOUR_SYNC_ALIAS --start
# Spark: ComfyUI :8188, OpenAI images :7860
curl -sS http://<spark-ip>:7860/health
# {"ok":true,"model":"krea2-turbo-nvfp4","draftModel":"z-image-turbo-nsfw-nvfp4","backend":"comfy","uncensored":true,...}
```

ComfyUI graph UI (same weights): `http://<spark-ip>:8188` — load the JSON via the API or rebuild the node table above.

## Failure notes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Comfy error `lora_name krea2_uncensor.safetensors` | LoRA download from Civitai failed | Drop the file in `~/ComfyUI/models/loras/`; or rely on auto-fallback `*-nolor.json` (abliterated CLIP only) |
| `CLIPLoader type krea2` missing | ComfyUI too old | `install.sh` clones current ComfyUI (needs native `krea2` + `lumina2`) |
| HTTP 200 but old `abliterated-flux-klein` health | Previous FLUX bridge still on `:7860` | `spark-install/stop.sh` then `start.sh` |
| Slow first generate | NVFP4 kernels / Triton JIT | First compile needs `Python.h` (`~/opt/python-dev` from install.sh) |
| LAN Images 502 with Via proxy on | Vite proxy rewrote a Spark IP to localhost | Palette sets proxy **off** for LAN hosts |
