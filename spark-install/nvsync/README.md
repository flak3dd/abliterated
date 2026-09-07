# NVIDIA Sync Custom apps for Abliterated

Yes — this is the intended launch hook. Sync **Settings → Custom** is a name, a port, and a bash **Launch Script** that runs **on the Spark** when you click the app. Sync then forwards that port to `http://localhost:<port>` on the Mac.

Abliterated’s image stack maps to two (optional third) Custom apps:

| Sync name | Port | Launch script | Auto-open browser |
| --- | --- | --- | --- |
| **Abliterated ComfyUI** | **8188** | [`port-8188.bash`](port-8188.bash) | `/` |
| **Abliterated Images** | **7860** | [`port-7860.bash`](port-7860.bash) | off (OpenAI API; Abliterated Images tab uses LAN or this tunnel) |
| Abliterated Qwen | 8000 | [`port-8000.bash`](port-8000.bash) | off |

`port-7860.bash` starts ComfyUI first if `:8188` is down, then the OpenAI bridge (`krea2-raw-fp8` + `z-image-turbo-nsfw-nvfp4`).

Scripts stay alive until you **Stop** in Sync (keeps the tunnel). They only kill processes **they** started; a stack already up from `start.sh` is left running so the Abliterated IDE on the LAN keeps working.

## Add in NVIDIA Sync (Mac)

1. Connect the Spark.
2. **Settings → Custom → Add New** (or **Add New** under Custom on the device window).
3. Fill the table above. Paste the matching `port-XXXX.bash` into **Launch Script**.
4. Click the app on the device window. ComfyUI opens at `http://localhost:8188`. Abliterated can use `http://127.0.0.1:7860/v1` with Via proxy on, or the Spark LAN IP with proxy off.

## Install the scripts onto the Spark

`push.sh` already copies `spark-install/nvsync/`. Then on the Spark:

```bash
~/abliterated-spark/spark-install/nvsync/install-scripts.sh
```

That writes `~/.config/NVIDIA/Sync/bin/scripts/port-{8188,7860,8000}.bash` (the path Sync’s CLI also looks for).

From the Mac, if `nvsync` is on PATH:

```bash
bash spark-install/nvsync/install-scripts.sh --mac flak3dd
```

Weights are **not** pulled here — run `push.sh --start` once first.
