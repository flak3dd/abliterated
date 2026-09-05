# Abliterated IDE

High-density dark-mode developer workbench and chat client for OpenAI-compatible inference endpoints.

Inference talks to `{baseUrl}/chat/completions` over HTTP POST + SSE. There are no local model weights, no GGUF loader, and no telemetry.

**Documentation:** open http://127.0.0.1:5173/docs/ while the DEV server runs, or read [`docs/APP.md`](docs/APP.md).

## Setup

```bash
cd /workspace/abliterated
npm install
```

The UI also needs the local bridge daemon dependency:

```bash
cd /workspace/abliterated/daemon
npm install
```

(`ws` is also in the root package.json so a single root `npm install` is enough for `npm run bridge`.)

## Run

```bash
# terminal 1 — Vite dev server
npm run dev

# terminal 2 — localhost-only file and command daemon
npm run bridge
```

Open the printed Vite URL. In the Workspace tab, type a real absolute folder path and click Connect. Set the OpenAI-compatible API URL and optional token in the **API** tab.

Production build:

```bash
npm run build
npm run preview
```


## Desktop app

Electron shell packages the Vite dist/ UI and can spawn the local bridge on port 17322.

```bash
npm install
npm run build
npm run desktop
```

Dev (Vite on :5173):

```bash
npm run dev
npm run desktop:dev
```

macOS package:

```bash
npm run dist:mac
```

License keys in Settings. DEV auto-unlocks **Admin** (`admin` / `abliterated`, or key `ABLIT-ADMIN`). Stub: `ABLIT-FREE` Free; `ABLIT-PRO-TEST-0001` Pro; `ABLIT-TEAM-TEST-0001` Team; `ABLIT-DEV-UNLOCK` Admin. See docs/PRODUCT.md and docs/pricing.md.

## Architecture

- **Chat:** `src/lib/sse.ts` streams `POST {baseUrl}/chat/completions` with tools. If `baseUrl` is empty or `remoteHostEnabled` is false, the client streams a character-by-character `[Local Dummy] Echo: {prompt}` fallback (no tool calls). ChatScreen runs a real **agent loop** (configurable max turns, default 24): collect tool calls from the stream, persist the assistant message with OpenAI `tool_calls`, execute tools, persist `role: tool` results, then call completions again until there are no tool calls, abort, error, or the cap.
- **Storage:** browser `localStorage` only (`ablit_settings`, `ablit_threads`, `ablit_messages`, `ablit_jobs`, `ablit_workspace`).
- **Local execution:** code fences (`bash`/`sh`/`shell`/`zsh`) render a confirm-gated **Run** button. Diff fences render confirm-gated **Apply**. First-class tools: `read_file`, `grep`, `glob`, `list_dir`, `file_outline`, `semantic_search`, `git_status` auto-run when the bridge is connected; `git_commit` auto-runs when Auto-accept file edits is on (otherwise a **Commit** button — and the agent **resumes** after Commit/Run); `shell` auto-runs only when Auto-run shell is on; `generate_image` when Images is enabled; `web_fetch` is http(s) only.
- **Grok Bot:** `src/lib/grokLayer.ts` parses unified diffs and fenced files; Settings **Auto-accept file edits** (default off) applies them via the localhost bridge after each assistant turn. Shell stays click-to-run unless Auto-run shell is enabled.
- **Workspace:** a real directory on the daemon host. The Workspace tab path + Connect sends `set_root` then `hello`/`ls`. File tree and previews use `ls`/`read_file`. After Connect / tree reload the header shows git branch + dirty from `git_status`. Grok writes land in that folder.
- **Daemon:** `daemon/bridge.js` is a WebSocket RPC at `ws://127.0.0.1:17322`. It binds **127.0.0.1 only** (never `0.0.0.0`). `ROOT` starts as `ABLIT_ROOT` or `process.cwd()` and is updated by `set_root`. On connect and on `hello` it replies `{type:hello, root, port}`. Also `ls`, `read_file`, `grep`, `glob`, `git_status`, `git_commit`, `apply_patch`, `write_file`, confirm-gated `exec`. Dangerous commands are refused. File ops cannot escape `ROOT`. `git_commit` never pushes and never uses `GIT_EDITOR`.

## Security note

The bridge is a local developer tool. Do not expose port 17322. It will not listen on public interfaces. Keep confirm-gating in the UI for shell (Run) unless Auto-run shell is on. File Apply and git_commit are click-gated unless Auto-accept file edits is on.

## Grok Bot / auto-accept

Point Workspace at a folder and Connect. Toggle Auto-accept file edits in Settings (off by default) to apply diffs and auto-run `git_commit`. Command fences and the `shell` tool stay gated unless Auto-run shell is on. Chat `read_file` / `grep` / `glob` / `git_status` run via the bridge when connected.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite + React + Tailwind |
| `npm run bridge` | Local WS daemon on 127.0.0.1:17322 |
| `npm run build` | Typecheck (`tsc -b`) and Vite production build |
| `npm run preview` | Serve the production build |

All local ports and DEV proxies (Vite 5173/4173, bridge `ws://127.0.0.1:17322`, Spark `:8000`, image bridge `:7860`) are documented in [`docs/LOCAL_ENDPOINTS.md`](docs/LOCAL_ENDPOINTS.md).

## Optional DGX Spark

Optional Spark/NIM OpenAI endpoint. Off by default. See spark/README.md for the host playbook.
In the API tab choose DGX Spark, enable the endpoint, model qwen-abliterated.
DEV uses Vite path /spark-v1 for localhost Spark.

## Optional abliterated image gen

`api.abliteration.ai` does **not** offer `/v1/images/generations`. Enable the **Images** tab and point it at a local OpenAI-compatible server. See [`spark-image/`](spark-image/) for FLUX.2 Klein + abliterated text encoder (`abliterated-flux-klein` on port **7860**). DEV proxies `/image-v1` → `ABLITERATED_IMAGE_URL` or `http://127.0.0.1:7860`.

Without a GPU, start a tiny PNG mock on **:7860**:

```bash
npm run image:mock
```

A blank HTTP 500 from the Vite `/image-v1` proxy usually means nothing is listening on :7860.

## Jobs (Phase 2)

The **Jobs** tab runs a real single-flight local agent queue (not a dummy list):

1. Connect the bridge and set a workspace root.
2. Open **Jobs**, enter a prompt, click **Run job**.
3. One job runs at a time; others stay `queued`. Logs stream turns/tools. **Cancel** aborts the in-flight run.
4. Headless auto-run: read/search/git_status/git_diff/checkpoint_save always (when bridge connected). Shell only if **Auto-run shell**. File apply / `git_commit` / `create_pr` / `checkpoint_restore` only if **Auto-accept file edits**.

Shared tool execution lives in `src/lib/agentTools.ts` (used by Chat and Jobs).

## MCP (Phase 3)

Settings → **MCP servers**: add `{ name, command, args }` (stdio). Click **Connect / refresh** (bridge must be up). The daemon (`daemon/mcp.js`) spawns the process and speaks MCP JSON-RPC. Tools merge into chat/jobs as `mcp__<server>__<tool>`.

Example (filesystem server from MCP docs):

```text
command: npx
args: -y @modelcontextprotocol/server-filesystem .
```

## Git depth (Phase 4)

Additional tools: `git_diff` (staged/unstaged/path), `checkpoint_save` / `checkpoint_restore` (`.ablit/checkpoints/`), `create_pr` (`gh pr create` when `gh` is on PATH; gated like `git_commit`).

