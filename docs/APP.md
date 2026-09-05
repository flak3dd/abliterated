# Abliterated IDE — application guide

**Audience:** local developer workbench (Greg)  
**Source of truth:** `src/`, `daemon/`, `featherless-oauth/`, `package.json` (inventory 2026-09-05)  
**Short overview:** [`README.md`](../README.md)

This is the primary user/app guide. README stays short; depth lives here.

While the Vite DEV server is running, open the rendered guide at:

- **http://127.0.0.1:5173/docs/** (HTML)
- **http://127.0.0.1:5173/docs/APP.md** (raw markdown)

Ports and DEV proxies: [`LOCAL_ENDPOINTS.md`](LOCAL_ENDPOINTS.md).

---

## Overview

Abliterated IDE is a high-density dark-mode developer workbench and chat client for **OpenAI-compatible** inference endpoints (`POST {baseUrl}/chat/completions` + SSE).

| Piece | Role |
| --- | --- |
| Browser UI | Vite + React 18 + Tailwind. Tabs: Home, Workspace, Models, Jobs, API, Images, Settings. Chat overlays when a session is open. |
| Inference | Cloud Abliteration, optional DGX Spark, Featherless (local OAuth proxy), or custom OpenAI-compatible base URL. |
| Local bridge | `daemon/bridge.js` — WebSocket RPC at `ws://127.0.0.1:17322` for workspace files, shell, git, MCP stdio, checkpoints. |
| Agent loop | Multi-turn tool loop in Chat; Jobs runs the same tool layer headlessly (single-flight queue). |

- No local model weights / GGUF loader in the IDE process.
- No product telemetry.
- Persistence is **browser `localStorage` only** (plus optional `.ablit/` files via the bridge).

---

## Requirements

| Piece | Notes |
| --- | --- |
| **Node.js** | Recent Node 18+ (Vite 6 / TypeScript 5). |
| **Package manager** | Root install (includes `ws`). Optionally install under `daemon/`. |
| **Browser** | Chromium or Firefox; DEV binds `127.0.0.1:5173`. |
| **Bridge** | Required for files, gated shell, git tools, MCP, disk image library, checkpoints. |
| **Inference** | At least one OpenAI-compatible `/v1` endpoint. |
| **Images** | Optional GPU FLUX via `spark-image/`, or image mock on `:7860`. |
| **gh** | Optional; on PATH for `create_pr`. |

---

## Quick start

```bash
cd /Users/adminuser/abliterated
npm install

# terminal 1 — UI
npm run dev
# → http://127.0.0.1:5173/

# terminal 2 — localhost-only file/command daemon
npm run bridge
# → ws://127.0.0.1:17322
```

1. Open the Vite URL.
2. **Workspace** → absolute folder path → **Connect**.
3. **API** → pick provider / token; enable remote host for live inference.
4. **Home** → **New Session** → chat.

Production: `npm run build` then `npm run preview` → http://127.0.0.1:4173/.

Docs while DEV runs: **http://127.0.0.1:5173/docs/**

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite + React + Tailwind |
| `npm run bridge` | Local WS daemon on 127.0.0.1:17322 |
| `npm run build` | Typecheck (`tsc -b`) and Vite production build |
| `npm run preview` | Serve the production build |

All local ports and DEV proxies (Vite 5173/4173, bridge `ws://127.0.0.1:17322`, Spark `:8000`, image bridge `:7860`) are documented in [`docs/LOCAL_ENDPOINTS.md`](LOCAL_ENDPOINTS.md).

---

## Tabs tour

| Tab | Shortcut | Purpose |
| --- | --- | --- |
| **Home** | Cmd/Ctrl+1 | Sessions; opens Chat overlay |
| **Workspace** | Cmd/Ctrl+2 | Root path, Connect, tree, scratchpad |
| **Models** | Cmd/Ctrl+3 | List/pick models |
| **Jobs** | Cmd/Ctrl+4 | Headless single-flight agent queue |
| **API** | Cmd/Ctrl+5 | Providers, URLs, tokens, remote host |
| **Images** | Cmd/Ctrl+6 | Image gen + `.ablit/images` library |
| **Settings** | Cmd/Ctrl+7 | Prompt, agent loop, safety, MCP, wipe, App docs |

Chat overlays from Home. Esc stops a busy agent or returns to sessions.

---

## Providers

`resolveActiveSettings` (`src/lib/activeEndpoint.ts`).

### Abliteration (default)
`abliteration` — `https://api.abliteration.ai/v1`; DEV `/v1` proxy; label `ablit`.

### DGX Spark
`dgx-spark` requires `sparkEnabled`. Default `http://127.0.0.1:8000/v1`, model `qwen-abliterated`. DEV Via proxy → `/spark-v1`. See `spark/README.md`.

### Featherless OAuth (`:3000/callback`)
`featherless` — local OAuth proxy `http://127.0.0.1:3000`. Redirect URI **exact**: `http://localhost:3000/callback`. IDE base `http://127.0.0.1:3000/v1`; token empty when proxy signs in. DEV `/featherless-v1` + `/featherless-oauth`. Never commit secrets / `tokens.json`.

### Custom
Uses Abliteration-slot baseUrl/token/model fields.

### Local dummy
Empty baseUrl or `remoteHostEnabled` false → `[Local Dummy] Echo` (no tools).

---

## Agent loop

`ChatScreen` + `sse.ts` + `agentTools.ts`: stream completions with tools; execute `tool_calls`; loop.
Stop: `no_tools`, `cap`, `abort`, `error`, `pending_gate`, `deepened`. Max turns default 24 (1–50). `ablit_agent_runs` keeps 50.

### Tools
Auto (bridge): `read_file`, `grep`, `glob`, `list_dir`, `file_outline`, `semantic_search`, `git_status`, `git_diff`, `checkpoint_save`.  
Auto-accept edits: `git_commit`, `create_pr`, `checkpoint_restore`.  
Auto-run shell: `shell` (deadly commands refused).  
`web_fetch` http(s) only. `generate_image` when Images on. MCP as `mcp__server__tool`.

### Self-deepen / mid-run / footer / status / copy
- Self-deepen default on (passes 0–5, default 2); `[ANSWER_COMPLETE]` early stop.
- Mid-run inject default on; queue while busy; integrate after step.
- Completion footer default on; Done/Continue with 3 chips (`completionFooter.ts`).
- `AgentStatusMonitor`: phase, turn, elapsed, mid-run queue; ~8s reasoning warn.
- Copy messages/fences/diffs; Run/Apply gated unless autos on. `@path` pins.

---

## Safety gates

| Control | Default | Effect |
| --- | --- | --- |
| Remote host | on | Off/empty base → dummy |
| Auto-accept file edits | off | Apply diffs/files; auto commit/PR/restore |
| Auto-run shell | off | Shell without Run click |
| Bridge | 127.0.0.1:17322 | Never public; path-jailed |
| git_commit | — | Never pushes; no GIT_EDITOR |

Autos are independent.

---

## Grok apply

`grokLayer.ts` parses unified diffs and whole-file fences with `// path` first line. Auto-accept applies after turns; else DiffViewer Apply. See `SYSTEM.md`.

---

## Jobs

Headless `executeAgentTool` (`jobRunner.ts`): single-flight; Cancel; soft-skip gated tools when autos off; resume on load.

---

## MCP

Settings → **One-click deploy** catalog (`npx -y` / `uvx`, no API keys) or add `{name, command, args}`. Connect via `daemon/mcp.js`.

---

## Git / checkpoints / PR

`git_status`, `git_diff`, `git_commit`, `create_pr` (gh), checkpoints under `.ablit/checkpoints/`.

---

## Images

No cloud `/v1/images/generations`. Enable Images → `:7860` / `abliterated-flux-klein`. DEV `/image-v1`. Image mock script on `:7860`. Library `.ablit/images` (max 50) or IndexedDB `ablit_image_library`.

---

## Featherless setup

1. OAuth app **ablit**; redirect `http://localhost:3000/callback` exact.  
2. Local `.env` with client id/secret (never commit).  
3. Start OAuth proxy (`featherless-oauth` script) + Vite DEV.  
4. API → Featherless → Sign in; base `http://127.0.0.1:3000/v1`; token empty.

---

## Keyboard / palette

| Binding | Action |
| --- | --- |
| Cmd/Ctrl+K | Palette |
| Cmd/Ctrl+N | New session |
| Cmd/Ctrl+1…7 | Tabs |
| Esc | Close palette / Stop / back |

---

## localStorage keys

`ablit_settings`, `ablit_threads`, `ablit_messages`, `ablit_jobs`, `ablit_workspace`, `ablit_agent_runs`. Wipe all clears these. Artifacts: `.ablit/checkpoints/`, `.ablit/images/`.

---

## Security

Bridge localhost-only — do not expose 17322. Keep confirm-gating unless autos intentional. Never commit tokens/secrets. `web_fetch` is untrusted. Path jail ≠ sandbox.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Bridge disconnected | Start bridge script; Connect absolute path |
| Dummy echo | Enable remote host; set base URL |
| Spark down | Enable Spark; vLLM `:8000`; Via proxy |
| Featherless fail | OAuth up; exact callback; `/session` |
| Image 502/500 | Image mock or spark-image on `:7860` |
| Tools pending | Run/Commit/Apply or enable auto-* |
| Docs 404 | `public/docs/` present; restart DEV server |

---

## Related docs

| Doc | Topic |
| --- | --- |
| [`README.md`](../README.md) | Setup summary |
| [`LOCAL_ENDPOINTS.md`](LOCAL_ENDPOINTS.md) | Ports and proxies |
| [`SYSTEM.md`](../SYSTEM.md) | Agent fence protocol |
| [`spark/README.md`](../spark/README.md) | Spark playbook |
| [`spark-image/README.md`](../spark-image/README.md) | FLUX image server |
| [`BENCHMARK.md`](../BENCHMARK.md) | Benchmarks |

---

## Appendix: local endpoints

Full detail lives in LOCAL_ENDPOINTS.md. Quick reference excerpt:


```markdown
# Local endpoints

Every network surface Abliterated IDE touches locally, what listens where, and how to verify each one. All services bind **127.0.0.1 only** unless noted.

## Quick reference

| Endpoint | Default address | Protocol | Purpose | Start |
| --- | --- | --- | --- | --- |
| Vite dev server | `http://127.0.0.1:5173` | HTTP | UI + same-origin API proxies | `npm run dev` |
| Vite preview | `http://127.0.0.1:4173` | HTTP | Production build + same proxies | `npm run preview` |
| Bridge daemon | `ws://127.0.0.1:17322` | WebSocket JSON-RPC | Workspace files, shell, git, MCP, checkpoints | `npm run bridge` |
| DGX Spark inference | `http://127.0.0.1:8000/v1` | OpenAI HTTP + SSE | `qwen-abliterated` chat completions | `spark/` compose on the Spark host |
| Image bridge | `http://127.0.0.1:7860/v1` | OpenAI images API | `abliterated-flux-klein` image generation | `spark-image/serve-openai-bridge.py` |

Cloud fallback is `https://api.abliteration.ai/v1` (set via `VITE_ABLITERATED_BASE_URL`); it is not a local endpoint but is the default proxy target for `/v1` in DEV.

## Vite dev/preview proxies

`vite.config.ts` binds `host: 127.0.0.1` for both `server` (5173) and `preview` (4173) and installs three same-origin proxies:

| Browser path | Target | Rewrite | Notes |
| --- | --- | --- | --- |
| `/v1/*` | `https://api.abliteration.ai` | none | Default chat/models endpoint in DEV |
| `/spark-v1/*` | `DGX_SPARK_URL` \|\| `http://127.0.0.1:8000` | strips `/spark-v1` → `/v1` | Used automatically for local Spark URLs (`:8000`) when `sparkViaProxy` is on |
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
```

---

*End of application guide.*

---

## Desktop / pricing

See [PRODUCT.md](PRODUCT.md) and [pricing.md](pricing.md). Free; Pro 29/mo or 249/yr; Team 99/mo seat. Activate under Settings -> License / Plan.
