# Abliterated hardening notes (2026-09-05)

Short list of harden / optimize changes applied on this pass:

## Chat / agent
- **Reasoning-only replies:** coalesce > retry for R1-style channels — when content is empty but reasoning has text, promote stripped reasoning into `assistant.content` locally (zero-cost; no second completion). Setting `coalesceReasoningToContent` (default on). Prefer this over content-channel nudge API retries.
- **Stream persist:** UI state throttle 80ms / save debounce 150ms; `mergeMessage` skips clone when same ref; tool results still truncated via `MAX_API_TOOL_CHARS` (48k) for API payloads; SSE `detokenizeArtifacts` + single-flight chat left as-is.
- **Free license cost:** Free tier clamps `selfDeepenPasses` to `maxSelfDeepenPasses` (1). Pro/Team allow up to 5.

## Electron (`electron/main.mjs`)
- `app.requestSingleInstanceLock()` — second launch focuses existing window.
- Production CSP via `session.defaultSession.webRequest.onHeadersReceived` (self + inline for Vite assets; connect to localhost bridge + `https:` APIs).
- DevTools only when `ABLITERATED_ELECTRON_DEV=1`.
- Bridge: skip spawn if port 17322 already listening; on quit kill **only** the child we spawned (tracked pid).
- `setWindowOpenHandler`: deny popup windows; `shell.openExternal` for `https:` only.

## Bridge / MCP
- Bind remains `127.0.0.1` only; WS `verifyClient` + connection guard reject non-localhost.
- MCP spawn keeps `detached: false`; `disconnectAll` on SIGINT/SIGTERM/`beforeExit`.
- Concurrent MCP sessions capped at **8** with a clear error.

## Storage
- `localStorage` writes catch quota / write failures (warn + no throw); corrupt JSON recovery unchanged.

## Preload
- Unchanged minimal `ablitDesktop` bridge (contextIsolation + sandbox).
