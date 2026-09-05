# Optimization notes — 2026-09-06

Implemented the ten Abliterated IDE optimisations from `FUNCTIONALITY-AUDIT-OPTIMIZATION-2026-09-05.md` (plus the operator checklist).

## Behaviour changes

### Jobs
- Hitting **max agent turns** no longer persists `status: 'done'`. The job ends as `status: 'error'` with `stopReason: 'cap'` and an error string like `hit max agent turns (N)`.
- `deleteJob` now **cancels/aborts** a running job before removing it from storage.
- Jobs header copy no longer says “Single-flight”. Concurrency is controlled by **Settings → Max concurrent Jobs** (already present).

### Chat / SSE
- Completions use **per-lane flights** (`chat:<threadId>` vs `job:<id>`). Chat and Jobs can overlap up to a provider concurrency cap derived from `maxConcurrentJobs` (ceiling 4).
- `contextLength` is **not** sent as OpenAI `max_tokens` (default completion `max_tokens` remains 4096). API label clarifies “docs only”.
- Chat **Retry** rewrites `ablit_messages` via `replaceThreadMessages` so discarded assistant/tool rows stay gone after reload.
- Transcript renders a **window of the last 80 messages** with “Load earlier”; syntax highlight is skipped while a bubble is `streaming`.
- Elapsed/status tick lives in `AgentStatusMonitor` so the 500ms timer does not rebuild the full transcript.

### Storage
- `writeJson` remains quota-safe (`try/catch`); on `QuotaExceeded` it prunes finished jobs and windows `ablit_messages` (soft cap 800 / 200 per thread).

### Bridge
- `exec` has a hard timeout (default **120s**, `ABLIT_EXEC_TIMEOUT_MS`) and an output cap (~2 MiB); process group killed on timeout or WS close.
- Path jail uses **realpath** (symlink escape denied). Bind remains **127.0.0.1 only**.

### Probes
- Overlapping `/models` and health GETs are **coalesced** (`coalesceFetch`). Completions retry once with backoff on HTTP **429**.
