# Local endpoints

Every network surface Abliterated IDE touches locally, what listens where, and how to verify each one. All services bind **127.0.0.1 only** unless noted.

## Quick reference

| Endpoint | Default address | Protocol | Purpose | Start |
| --- | --- | --- | --- | --- |
| Vite dev server | `http://127.0.0.1:5173` | HTTP | UI + same-origin API proxies | `npm run dev` |
| Vite preview | `http://127.0.0.1:4173` | HTTP | Production build + same proxies | `npm run preview` |
| Bridge daemon | `ws://127.0.0.1:17322` | WebSocket JSON-RPC | Workspace files, shell, git, MCP, checkpoints | `npm run bridge` |
| DGX Spark inference | `http://127.0.0.1:8000/v1` | OpenAI HTTP + SSE | `qwen-abliterated` chat completions | `spark/` compose on the Spark host |
| Featherless | `http://127.0.0.1:3000/v1` | OpenAI HTTP + OAuth | `Qwen/Qwen3-32B` chat + OAuth session | featherless-oauth server (see API tab) |
| Image bridge | `http://127.0.0.1:7860/v1` | OpenAI images API | `abliterated-flux-klein` image generation | `spark-image/serve-openai-bridge.py` |

Cloud fallback is `https://api.abliteration.ai/v1` (set via `VITE_ABLITERATED_BASE_URL`); it is not a local endpoint but is the default proxy target for `/v1` in DEV.

## Vite dev/preview proxies

`vite.config.ts` binds `host: 127.0.0.1` for both `server` (5173) and `preview` (4173) and installs three same-origin proxies:

| Browser path | Target | Rewrite | Notes |
| --- | --- | --- | --- |
| `/v1/*` | `https://api.abliteration.ai` | none | Default chat/models endpoint in DEV |
| `/spark-v1/*` | `DGX_SPARK_URL` \|\| `http://127.0.0.1:8000` | strips `/spark-v1` → `/v1` | Used automatically for local Spark URLs (`:8000`) when `sparkViaProxy` is on |
| `/featherless-v1/*` | `FEATHERLESS_URL` \|\| `http://127.0.0.1:3000` | strips `/featherless-v1` → `/v1` | Used automatically for local Featherless URLs (`:3000`) when `featherlessViaProxy` is on |
| `/featherless-oauth/*` | `FEATHERLESS_URL` \|\| `http://127.0.0.1:3000` | strips `/featherless-oauth` → root | OAuth endpoints (`/session`, `/logout`) used by the API tab in DEV |
| `/image-v1/*` | `ABLITERATED_IMAGE_URL` \|\| `http://127.0.0.1:7860` | strips `/image-v1` → `/v1` | Returns a 502 with a start-hint body when the target is down |

`src/lib/activeEndpoint.ts` performs the DEV rewrites (`api.abliteration.ai` → `/v1`, local Spark → `/spark-v1`), so the browser never makes cross-origin calls in DEV.

Dev-only friendly redirect: `http://127.0.0.1:5173/docs` → 302 → `/docs/LOCAL_ENDPOINTS.md` (Vite middleware in `vite.config.ts`; add more entries to `DOCS_REDIRECTS`).

## Bridge daemon (`daemon/bridge.js`)

- **Address:** `ws://127.0.0.1:17322` — hard-coded to `127.0.0.1`; it will not listen on public interfaces. Port override: `ABLIT_PORT`.
- **Root:** starts at `ABLIT_ROOT` or `process.cwd()`; the UI changes it with `set_root`. All file ops are confined to the root.
- **Handshake:** on connect and on `hello`, the daemon replies `{ type: "hello", root, port }`.
- **RPC messages:** `hello`, `set_root`, `ls`, `read_file`, `write_file`, `grep`, `glob`, `file_outline`, `semantic_search`, `git_status`, `git_commit`, `create_pr`, `apply_patch`, `exec` (confirm-gated in the UI), `checkpoint_save` / `checkpoint_restore`, plus MCP stdio management (`daemon/mcp.js`).
- **Verify:** start it and watch for the log line `abliterated bridge ws://127.0.0.1:17322 root=...`; daemon self-tests run via `npm run smoke`.

> Security note: the bridge executes commands and writes files under the workspace root. Never expose port 17322; keep shell confirm-gating on unless Auto-run shell is intentional.

## DGX Spark inference (`spark/`)

Optional OpenAI-compatible vLLM server, typically on the Spark host and reached at `http://<spark-host>:8000/v1` (or `127.0.0.1:8000` when local/tunneled).

- **Paths:** `POST /v1/chat/completions` (SSE), `GET /v1/models`
- **Served model name:** `qwen-abliterated` (`SERVED_NAME` in `spark/.env`)
- **Tool support:** `--enable-auto-tool-choice --tool-call-parser qwen3_coder`; reasoning via `--reasoning-parser qwen3`
- **Port override:** `PORT` in `spark/.env` (mapped `${PORT:-8000}:8000`)
- **Verify:** `curl http://127.0.0.1:8000/v1/models` should list `qwen-abliterated`
- **IDE wiring:** API tab → DGX Spark; in DEV traffic goes through the `/spark-v1` proxy (see above)

## Featherless (`:3000`)

Optional local OpenAI-compatible endpoint with an OAuth session flow, selected via API tab → Featherless.

- **Paths:** `POST /v1/chat/completions`, `GET /v1/models`
- **OAuth:** `GET /session`, `POST /logout`, login opened at `http://localhost:3000/login` (API tab polls `/session` until signed in)
- **Default model:** `Qwen/Qwen3-32B`
- **Verify:** with the server running, `GET http://127.0.0.1:3000/session` returns `{ ok, signedIn, ... }`; in DEV use the `/featherless-oauth/session` proxy
- **IDE wiring:** `resolveActiveSettings` routes chat/models through `featherlessBaseUrl` when provider is `featherless` and `featherlessEnabled` is on; in DEV traffic goes through the `/featherless-v1` proxy. When `featherlessEnabled` is off, chat falls back to the local dummy echo.

## Image bridge (`spark-image/`)

OpenAI-compatible image server for the Images tab and the `generate_image` tool.

- **Address:** `http://127.0.0.1:7860`
- **Paths:** `POST /v1/images/generations` (returns `b64_json`), `GET /v1/models`, `GET /v1/progress`, `GET /health`
- **Model id:** `abliterated-flux-klein` (FLUX.2 Klein base DiT + abliterated text encoder)
- **Mock (no GPU):** `npm run image:mock` from the repo root serves a stub PNG on the same port
- **Verify:** `curl http://127.0.0.1:7860/health`
- **IDE wiring:** in DEV requests go through the `/image-v1` proxy; a blank 5xx from the proxy usually means nothing is listening on `:7860`

## Environment variables

| Variable | Default | Used by |
| --- | --- | --- |
| `ABLIT_PORT` | `17322` | Bridge daemon port |
| `ABLIT_ROOT` | `process.cwd()` | Bridge initial workspace root |
| `DGX_SPARK_URL` | `http://127.0.0.1:8000` | Vite `/spark-v1` proxy target |
| `FEATHERLESS_URL` | `http://127.0.0.1:3000` | Vite `/featherless-v1` and `/featherless-oauth` proxy targets |
| `ABLITERATED_IMAGE_URL` | `http://127.0.0.1:7860` | Vite `/image-v1` proxy target |
| `ABLITERATED_IMAGE_MOCK` | unset | Image bridge stub-PNG mode |
| `VITE_ABLITERATED_TOKEN` / `VITE_ABLITERATED_BASE_URL` / `VITE_ABLITERATED_MODEL` | unset | Cloud endpoint defaults (root `.env`) |
