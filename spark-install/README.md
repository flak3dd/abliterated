# Abliterated Spark install (Build D)

Images :7860 (Diffusers OpenAI bridge). Optional Qwen :8000.

Quality default: `krea2-raw-fp8` (daily photoreal). Light: `flux2-klein-4b`. Max: `flux2-dev` (gated).
ComfyUI / :8188 removed — see ../spark-image/BUILDS.md (GB10 sm_121, 128GB, cu130, ≥350GB disk for full pack).

```bash
bash spark-install/push.sh YOUR_SYNC_ALIAS --start
```

Pull on Spark only via `spark-image/pull-models.sh`. IDE: `ABLITERATED_IMAGE_URL=http://127.0.0.1:7860`.
