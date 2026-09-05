# Abliterated IDE — functionality audit and optimization plan

**Date:** 2026-09-05  
**Scope:** `/Users/adminuser/abliterated` (`src/`, `daemon/`, `scripts/`, Vite proxies)  
**Mode:** plan only — no product code changed  
**Baseline:** today’s QA pass (`.ide-qa-evidence/20260905-1114/`) + `docs/AUDIT-2026-09-05.md` + live source

This is a **functionality** audit (does each surface do what the product claims?) plus a **prioritized optimization plan**. It is not a SWE-bench score and does not re-run live inference.

---

## 1. Executive summary

Abliterated is a real local agent workbench, not a mock. Chat, Jobs, the 127.0.0.1 bridge, gated shell/edits, MCP stdio, git/checkpoints, and optional image gen are implemented and mostly wired.

The product is held back by **three classes of problem**, not missing chrome:

1. **Correctness bugs in shipped UX** — Retry does not persist; `contextLength` is sent as `max_tokens`; pairing code and `@` mention popup are dead; mixed Chat/Jobs streaming is serialized; Jobs can mark `done` after hitting the turn cap.
2. **Local-trust security** — the bridge is an unauthenticated `exec` + `set_root` socket on localhost; `web_fetch` SSRF is hostname-only; tokens live in `localStorage`; path jail does not `realpath`.
3. **Scale/perf ceilings** — one giant `ablit_messages` key; all 7 tabs stay mounted; ChatScreen is 1474 lines and re-renders the full transcript every 50–500 ms; `exec` has no timeout.

Today’s QA (45 cases) is operationally green after a daemon restart. Historical **B-04-STALE** (stale bridge ignored `delete_file`) is an ops/regression note, not an open code defect in current `daemon/bridge.js`.

**Recommended next slice:** rotate the baked cloud key immediately, then P0 correctness + local-trust hardening (W1–W6), then storage/stream split. Do **not** start cloud agents, Tab autocomplete, or a VS Code fork.

A second plan-only pass (`frontend-harden` workflow, 2026-09-05) confirmed the same P0s and added: **live `VITE_ABLITERATED_TOKEN` compiled into `dist/`**, missing `featherless-oauth/` tree, Spark/image Docker `0.0.0.0` binds, Google Fonts on the critical path, and Chat overlay a11y. That report is plan-only (no code applied).

---

## 2. What the app actually is

High-density dark-mode workbench. Inference is `POST {baseUrl}/chat/completions` + SSE. Persistence is browser `localStorage` (+ optional `.ablit/` on disk via the bridge). No local GGUF, no product telemetry.

| Layer | Implementation | Status |
| --- | --- | --- |
| UI | Vite 6 + React 18 + Tailwind, `127.0.0.1:5173` | Working |
| Chat agent loop | `ChatScreen.tsx` + `sse.ts` + `agentTools.ts` | Working, oversized |
| Jobs | `jobRunner.ts` real queue (not dummy) | Working, thinner than Chat |
| Bridge | `daemon/bridge.js` WS `127.0.0.1:17322` | Working; UI-gated only |
| Providers | Abliteration, DGX Spark, Featherless, custom | Working |
| Images | Optional `:7860` / `/image-v1` | Opt-in, working |
| MCP | stdio via `daemon/mcp.js` | Partial (stdio only; UI can desync after daemon recycle) |

### Tabs and overlays

| Surface | Claim | Health |
| --- | --- | --- |
| Home | Sessions, pin, delete, open chat | **OK** |
| Workspace | Connect folder, tree, preview/edit, scratchpad, git | **OK** (no OS folder picker; tree depth 3 / 400) |
| Models | List/pick `/models` | **OK** |
| Jobs | Headless single-flight agent queue | **OK** copy is stale vs `maxConcurrentJobs` |
| API | Providers, tokens, test, Featherless OAuth | **OK** with labeling bugs |
| Images | Local image gen + library | **OK** when enabled |
| Settings | Prompt, loop, gates, MCP, wipe | **OK**; several stored fields have no UI |
| Chat overlay | Multi-turn tools, plan mode, deepen, mid-run, diffs | **OK** with listed bugs |
| Command palette | ⌘K | **OK** |
| Status bar | Bridge / git / gates / provider / agent | **OK** |
| ShortcutsModal / `?` | Help overlay | **Dead** — never mounted |
| FileMentionPopup | `@path` autocomplete | **Dead** — never mounted (`@` still prefetches if typed) |
| `providerHealth.ts` | Live `/models` probes | **Dead** — no subscriber |
| Pairing code | “Pairing for the localhost bridge” | **Cosmetic** — daemon never checks it |

All seven tabs stay **mounted and hidden** (`App.tsx` `panelClass`). Opening a session **covers every tab** with Chat; the rail still switches the hidden panel.

---

## 3. Feature health matrix

### Agent loop (Chat)

| Capability | Default | Notes |
| --- | --- | --- |
| Multi-turn tools | yes | Stream → execute → `role: tool` → again |
| Max turns | 24 (1–50) | Live-reread each turn |
| Stop reasons | `no_tools`, `cap`, `abort`, `error`, `pending_gate`, `deepened` | Recorded in `ablit_agent_runs` (keep 50) |
| Resume after Commit/Run | yes | `canResumeAfterTool` |
| Self-deepen | on, 2 passes | Skips if completion footer present; `[ANSWER_COMPLETE]` early stop |
| Mid-run inject | on | Queued as `⟦mid-run⟧`; drained at next turn |
| Completion footer chips | on | Requires exact Done + 3 Continue lines |
| Plan mode | off | Read-only tools until Approve; then seeds implement prompt |
| Fake-tool recovery | Chat only | Parses markdown “tool theater”; never synthesizes shell/commit |
| Dummy echo | empty URL or remote host off | Character-by-character, **no tools** |

### Tools

Auto when bridge connected: `read_file`, `grep`, `glob`, `list_dir`, `file_outline`, `semantic_search`, `git_status`, `git_diff`, `checkpoint_save`.

Gated unless Auto-accept: `git_commit`, `create_pr`, `checkpoint_restore`, Grok diffs / fenced files.

Gated unless Auto-run shell: `shell` (plus fenced `bash` Run buttons).

Always available (no bridge): `web_fetch` (http(s) only), `generate_image` if Images enabled, MCP `mcp__server__tool`.

**Not first-class agent tools:** `write_file`, `delete_file`, `apply_patch` — edits go through Grok fences. Jobs ignore per-thread tool checkboxes and always enable `ALL_TOOL_TYPES`. Headless gated tools **soft-skip** (`skipped: …`) so the loop continues.

### Jobs vs Chat

Jobs reuse `executeAgentTool` + `streamChatCompletion` but **omit** self-deepen, mid-run, footer, plan mode, `@` prefetch, fake-tool recovery, and `tool_choice: required`. Hitting max turns still persists `status: 'done'`. Logs live in `ablit_jobs`; no session transcript is created.

**Global SSE single-flight** (`sse.ts`): Chat and every Job share one HTTP stream queue. `maxConcurrentJobs` (1–4, **no Settings UI**) cannot actually overlap completions.

### Network surfaces (all 127.0.0.1 unless noted)

| Endpoint | Purpose |
| --- | --- |
| `http://127.0.0.1:5173` | Vite UI + proxies |
| `http://127.0.0.1:4173` | Preview |
| `ws://127.0.0.1:17322` | Bridge RPC (no auth) |
| `/v1` → `api.abliteration.ai` | DEV cloud chat |
| `/spark-v1` → `:8000` | Spark |
| `/featherless-v1`, `/featherless-oauth`, `/featherless-api` | Featherless |
| `/image-v1` → `:7860` | Images |
| Cloud | `https://api.abliteration.ai/v1` |

---

## 4. Findings (verified)

Severity: **P0** blocks core trust or silently wrong answers · **P1** high-impact correctness/reliability · **P2** maintainability / medium UX · **P3** polish.

### P0 — fix first

| ID | Finding | Evidence | Effect |
| --- | --- | --- | --- |
| P0-1 | **Unauthenticated bridge.** Any local process or **any webpage** that can open `ws://127.0.0.1:17322` gets `exec`, `set_root`, `write_file`, `mcp_connect`. No Origin check. Pairing code is unused. `npm run bridge:install` KeepAlives that socket at login. | `daemon/bridge.js` bind + handler; Settings pairing UI; `scripts/ai.abliteration.bridge.plist` | Classic CSWSH / local RCE as the logged-in user |
| P0-2 | **Live cloud API key baked into the SPA.** `.env.local` sets `VITE_ABLITERATED_TOKEN`; Vite inlines `VITE_*` into the client. `storage.ts` uses it as `DEFAULT_SETTINGS.token`. `dist/assets/*.js` contains an `ak_` literal. `.env.local` is gitignored (`*.local`); `dist/` is gitignored — leak is anyone who can read this machine or serve the build. | `.env.local`, `src/lib/storage.ts:45`, `dist/assets` | Wipe/empty LS still restores the cloud key; DevTools can copy it. **Rotate the key at api.abliteration.ai.** |
| P0-3 | **`set_root` has no jail.** Any existing directory becomes `ROOT`. Combined with `exec` `{shell:true}`, this is full host access. | `bridge.js` `handleSetRoot` | Workspace jail is optional after one RPC |
| P0-4 | **`contextLength` is sent as `max_tokens`.** API field labeled “Context length”. | `ApiScreen.tsx` label; `sse.ts` `body.max_tokens = settings.contextLength \|\| 4096` | Setting 128000 either 400s the provider or bills a huge completion |
| P0-5 | **Retry does not persist.** Trims React state only; `ablit_messages` still has the old assistant/tool rows. | `ChatScreen.tsx` `retry` | Reload restores discarded turns; next send can send a forked history |
| P0-6 | **`writeJson` has no quota/try.** `saveMessage` is on the stream hot path. | `storage.ts` `writeJson` | QuotaExceeded can crash the agent persist path mid-run |

### P1 — high impact

| ID | Finding | Evidence |
| --- | --- | --- |
| P1-1 | `web_fetch` SSRF: blocks `localhost` / `127.0.0.1` / `::1` only. Not RFC1918, `169.254.169.254`, `127.0.0.2`, IPv6-mapped, or **redirect-to-internal**. Browser `fetch` + `redirect: 'follow'`. | `agentTools.ts` |
| P1-2 | Path jail uses `path.resolve` + `relative`, **not `realpath`**. File RPCs follow symlinks out of ROOT. Walk skips symlink *dirents* only. | `daemon/search.js` `isInsideRoot` |
| P1-3 | `exec` has **no timeout, no stdout cap, no kill-on-client-abort**. `isDeadly` is a thin denylist (`rm -rf /`, `mkfs`, classic fork bomb, `dd of=/dev/`). | `bridge.js` `handleExec` |
| P1-4 | SSE **single-flight** serializes Chat vs Jobs. Parallel jobs wait on one stream. | `sse.ts` `streamChatFlight` |
| P1-5 | All messages for **all threads** in one `ablit_messages` array; every `saveMessage` rewrites the whole blob. Home counts messages with a full parse per row. | `storage.ts`, `HomeScreen.tsx` |
| P1-6 | `applyUnified` does **not** verify context lines; plus-only patches **replace the whole file**. | `daemon/fsutil.js` |
| P1-7 | Jobs persist `status: 'done'` after hitting the turn cap. | `jobRunner.ts` |
| P1-8 | `git_commit` with empty `paths` runs `git add -A .` (can stage `.env`). | `bridge.js` |
| P1-9 | Unknown SSE tool names coerce to **`shell`**. Parse failure stores `{raw: arguments}`. | `sse.ts` `materializeTools` |
| P1-10 | MCP UI can show disconnected after daemon recycle while the socket is up (QA U-05). Sessions are in-memory only. | QA report; `mcpClient.ts` |
| P1-11 | `deleteJob` does not abort a running job. | `jobRunner.ts` |
| P1-12 | Remote-host switch copy says “localhost bridge”; it actually gates Abliteration/Custom HTTP (dummy echo). | Settings help vs `sse.ts` |
| P1-13 | **`featherless-oauth/` is missing.** `npm run featherless-oauth` points at `featherless-oauth/server.mjs`; API tab still polls `/featherless-oauth/session` and opens `http://localhost:3000/login`. | `package.json`, no directory on disk | Documented Sign-in path cannot start from this tree. Cloud `/featherless-api` still works. |
| P1-14 | Spark compose / `serve-qwen-abliterated.sh` bind **`0.0.0.0:8000`** with no API key. Image Docker sets `ABLITERATED_IMAGE_HOST=0.0.0.0`; CORS `*`; server ignores `imageToken`. | `spark/`, `spark-image/` | Unauthenticated GPU inference / image gen on the LAN |
| P1-15 | `endpointUrl` rewrites proxies only when `import.meta.env.DEV`. **`vite preview` proxies are unused**; Via-proxy discards the Settings host and always hits the Vite env target. | `src/lib/apiUrl.ts` | Preview/production-build testing is a different (broken) network path than DEV |
| P1-16 | Chat **awaits workspace prefetch** (semantic + up to 4 file reads) before the first SSE POST. | `ChatScreen.tsx` `runCompletion` | TTFT includes a tree walk |
| P1-17 | MCP `mcp__*` tools auto-run with **no confirm** (unlike shell/edits). `mcp_connect` merges caller `env` over `process.env`. | `agentTools.ts`, `daemon/mcp.js` | Prompt injection → second RCE channel |
| P1-18 | `public/docs/index.html` assigns markdown links to `innerHTML` after a weak escape. `javascript:` hrefs can run if docs are writable. | `public/docs/index.html` | Stored XSS if APP.md is attacker-writable via the bridge |

### P2 — UX / architecture

| ID | Finding |
| --- | --- |
| P2-1 | `FileMentionPopup` and `ShortcutsModal` implemented, never imported. `@` still advertised. Rail help never passed `onOpenShortcuts`. |
| P2-2 | Pairing code, `fastModel`, `selectedFiles`, `providerHealth` unused or cosmetic. |
| P2-3 | `maxConcurrentJobs` used by runner, **no Settings control**; Jobs header still says “Single-flight”. |
| P2-4 | Chat overlay hides every tab; nav still changes the hidden panel. |
| P2-5 | Three provider switchers (API, status bar, palette). |
| P2-6 | All tabs always mounted — any `agentLabel` / jobs log re-renders Models/Settings/Images. |
| P2-7 | ChatScreen 1474 lines; no virtualization; 50 ms stream flush + 500 ms elapsed tick. |
| P2-8 | Workspace tree is N sequential `ls` calls (depth 3). No native folder picker. |
| P2-9 | Toasts only fire for uncaught errors; copy/save/enqueue have no confirmation toast. |
| P2-10 | Images lightbox: no Esc, no focus trap. |
| P2-11 | Semantic search is lexical scoring, not embeddings (honest in tool description). |
| P2-12 | No `AGENTS.md` / project-rules auto-load (global prompt only). |
| P2-13 | No first-class `write_file` / `apply_patch` tool (fences only). |
| P2-14 | `npm test` does not run `p1-bridge-qa`, `mcp-smoke`, or `test-fake-tool-calls`. Tests **reimplement** helpers instead of importing `src/lib`. |

### P3 — polish

- Icon-only buttons missing `aria-label` (Chat Back/Retry, Home pin/delete, lightbox close).
- Bottom nav has no `aria-current`.
- Palette has no focus trap.
- Scratchpad not collapsible; line-number gutter does not scroll with the editor.
- `BENCHMARK.md` §6 still says “dummy Jobs” (false). Score math 58.5 vs 53.0 is inconsistent.

---

## 5. Optimization plan (execute in this order)

Work items are sized for small diffs. Acceptance is testable. Do not start P2 product gaps until W1–W8 land.

### Wave A — secrets + correctness (do W0 the same day)

#### W0 [P0] Unbake and rotate the cloud key
- **Files:** `.env.local`, `src/lib/storage.ts`, rebuild `dist/`
- **Change:** Stop using `VITE_ABLITERATED_TOKEN` as a default. Empty `DEFAULT_SETTINGS.token`. Rebuild so `dist/assets` has no `ak_` literal. **Rotate the leaked key at api.abliteration.ai** (it has been on this disk in `.env.local` and a production chunk).
- **Accept:** Fresh profile / wiped LS does not restore a cloud token. `grep -R 'ak_' dist/assets` is empty.

#### W1 [P0] Split `contextLength` from `max_tokens`
- **Files:** `src/lib/sse.ts`, `src/screens/ApiScreen.tsx`, `src/types/index.ts`
- **Change:** Keep `max_tokens` default 4096 (optional explicit field). Treat `contextLength` as documentation-only or drop the control until a real window budget exists. Relabel the input.
- **Accept:** Setting a large “context” value does not change `max_tokens` in the POST body. Dummy + live test still stream.

#### W2 [P0] Retry must rewrite storage
- **Files:** `src/screens/ChatScreen.tsx`, `src/lib/storage.ts`
- **Change:** After trim, `setMessages` for that thread (not only React state). Add `replaceThreadMessages(threadId, msgs)`.
- **Accept:** Retry → reload → discarded assistant/tool rows stay gone.

#### W3 [P0] Quota-safe storage
- **Files:** `src/lib/storage.ts`
- **Change:** `try/catch` on `setItem`; on QuotaExceeded drop oldest messages/jobs (keep settings/tokens), toast the user. Per-thread message key `ablit_messages_<id>` (migrate from the monolith once).
- **Accept:** Filling LS does not throw through Chat persist; Home no longer parses every thread’s messages on each render.

#### W4 [P1] Jobs terminal states + delete-while-running
- **Files:** `src/lib/jobRunner.ts`, `src/screens/JobsScreen.tsx`
- **Change:** Cap → `status: 'error'` (or `done` + `stopReason: 'cap'` shown in UI). `deleteJob` aborts first. Surface `maxConcurrentJobs` in Settings or remove the Jobs “Single-flight” lie.
- **Accept:** J-02 still passes; a 1-turn-cap job is not shown as successful finish.

#### W5 [P1] Stop coercing unknown tools to `shell`
- **Files:** `src/lib/sse.ts`
- **Change:** Unknown names stay as-is and `executeAgentTool` denies/skips. Invalid JSON arguments error the tool, not `{raw}`.
- **Accept:** A hallucinated tool name never becomes a gated shell card.

### Wave B — local trust (2–3 days)

#### W6 [P0] Bridge handshake token
- **Files:** `daemon/bridge.js`, `src/lib/bridgeClient.ts`, Settings pairing UI
- **Change:** Daemon requires the first client message to present `pairingCode` (or `ABLIT_BRIDGE_TOKEN`). Reject other origins if `Origin` is present. Keep bind on `127.0.0.1`.
- **Accept:** A second `websocat` without the token cannot `exec`. Existing UI still connects (code already in settings).

#### W7 [P1] Jail + exec limits
- **Files:** `daemon/bridge.js`, `daemon/search.js`, `daemon/fsutil.js`, `src/lib/agentTools.ts`, `src/lib/bridgeClient.ts`
- **Change:**
  - `realpath` both ROOT and targets; deny symlink escape.
  - `exec`: timeout (default 120s), stdout/stderr cap (~2 MiB), kill process group on client abort / WS close.
  - `web_fetch`: block loopback, link-local, RFC1918, metadata IPs; **do not follow redirects to those**; cap body already 48k.
  - `applyUnified`: fail if a context line does not match (stop silent whole-file replace unless the patch is a documented new-file path).
  - `git_commit`: require explicit `paths` or status porcelain; never `git add -A` by default.
- **Accept:** symlink-out fixture fails; `yes` is killed; mismatched hunk throws; smoke + `fsutil.test.js` updated.

#### W8 [P1] Split SSE flights
- **Files:** `src/lib/sse.ts`
- **Change:** Queue per caller (chat vs job id), not one global promise. Still cap concurrent HTTP to the same provider if needed.
- **Accept:** A running Job does not delay Chat tokens.

### Wave C — performance (2–4 days)

#### W9 [P2] Chat render path
- **Files:** `src/screens/ChatScreen.tsx`, `src/components/chat/MessageBubble.tsx`
- **Change:** Window the list (or render last N + “load earlier”). Skip `highlightLine` while `status === 'streaming'`. Isolate elapsed timer so it does not rebuild the transcript.
- **Accept:** 200-message thread + live stream stays responsive (manual: hold 50k-line fixture already in QA).

#### W10 [P2] Unmount hidden tabs + lazy screens
- **Files:** `src/App.tsx`, `vite.config.ts`
- **Change:** Render only the active tab (`React.lazy` for Images/Models/Settings). Keep Chat overlay as today. Optional tiny store so `agentLabel` does not rebuild the tab.
- **Accept:** Production build still has a single HTML entry; initial JS chunk drops unused Images/MCP until opened.

#### W11 [P2] Daemon I/O caps
- **Files:** `daemon/bridge.js`, `daemon/semantic.js`, `src/screens/WorkspaceScreen.tsx`
- **Change:** Grep per-file read cap ≪ 8 MiB. Truncate `git_diff` / huge `read_file` with “use file_outline”. One recursive tree RPC instead of N `ls` calls.
- **Accept:** Connect on this repo’s tree returns in well under the current multi-round-trip; grep on a 50k-line file still returns ≤200 matches.

#### W12 [P2] Bundle hygiene
- **Files:** `src/lib/systemPrompt.ts`, lucide imports
- **Change:** Store legacy prompt **hashes** for upgrade, not V1–V12 full text. Per-icon lucide imports.
- **Accept:** `npm run build` chunk smaller; settings still upgrade old prompts.

### Wave D — product (only after A–C)

Worth building (local-agent ROI):

| Item | Why |
| --- | --- |
| Wire `FileMentionPopup` + ShortcutsModal | Code already exists |
| First-class `apply_patch` / `write_file` tools | Cuts fence-recovery and fake-tool theater |
| Load `AGENTS.md` / `.ablit/rules` from workspace | Per-repo memory; small |
| Persist a lexical file index | Makes `semantic_search` cheap and less wrong |
| MCP reconnect-after-recycle + put `mcp-smoke` in `npm test` | Closes U-05 |
| Optional web search MCP | Better than computer-use |

Skip / defer:

| Item | Why |
| --- | --- |
| Cloud VM / Slack / mobile steer | Different product; daemon is localhost |
| Tab autocomplete / LSP / full editor | Not a VS Code fork (QA N/A) |
| OS Seatbelt/bubblewrap | Jail + token + exec timeout is the niche |
| Parallel subagents / worktrees | Blocked until W8; still a large product bet |
| Browser/computer use | Playwright MCP later, not a built-in browser |

---

## 6. Test fortification (with the waves)

Today: `npm test` = `smoke-agent.mjs` + daemon unit tests + `test-agent-response.mjs` (SSE copy, **not** importing `src/lib/sse.ts`).

Add, in order:

1. Import real `clamp*` / footer / pin helpers in smoke (stop drift).
2. `storage` quota + retry persist unit tests.
3. `isDeadly`, symlink jail, `applyUnified` mismatch, `web_fetch` host table.
4. Fold `scripts/p1-bridge-qa.mjs`, `mcp-smoke.mjs`, `test-fake-tool-calls.mjs` into `npm test`.
5. One Playwright smoke: boot UI, palette, Workspace connect fixture, dummy chat.

Do not claim production-hardening complete until 4–5 exist.

---

## 7. Residual risks (even after the plan)

- Bridge remains a **local developer tool**. Token + Origin check stops drive-by web pages; it does not sandbox the user’s own Auto-run shell.
- Tokens in `localStorage` are stealable by XSS in this origin. CSP + no `dangerouslySetInnerHTML` (currently none in `src/`) is the mitigation; moving tokens to the daemon would be a later design.
- MCP `command` is still arbitrary process spawn by design.
- `create_pr` uses the operator’s `gh` credentials.
- Live Abliteration/Featherless/Spark with real keys were **not** re-probed in this audit (QA residual).

---

## 8. Suggested execution order for an implementer

1. W1, W2, W5 (small, no daemon restart).
2. W3, W4.
3. W6, W7 (daemon + client; restart bridge; re-run p1-qa).
4. W8.
5. W9–W12 as time allows.
6. Wire dead UI (mention popup, shortcuts) as a single UX PR.

**Out of scope for that sequence:** cloud agents, embeddings, editor, marketplace.

---

## 9. Verification commands (current tree, pre-change)

```bash
cd /Users/adminuser/abliterated
npm test
npx tsc -b --pretty false
```

QA evidence: `.ide-qa-evidence/20260905-1114/REPORT.md` — 27 PASS, 7 PASS_WITH_NOTES, 1 historical FAIL (stale daemon), 10 N/A.

This document is the plan. Do not apply the waves until an operator picks a wave (A is the default).
