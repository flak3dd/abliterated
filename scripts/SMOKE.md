# Phase 0 / 1 smoke probes

Automated: `node scripts/smoke-agent.mjs` (clamp, path jail, pins, outline, resume helper).

Also: `node daemon/search.test.js`, `node daemon/fsutil.test.js`.

## Manual scenarios (bridge + UI)

1. **Max turns** — Settings → Max agent turns = 3. Send a prompt that forces many tool calls; status shows `agent N/3`; header idle subtitle may show `stopped: cap`.

2. **pending_gate resume (Commit)** — Auto-accept off. Ask agent to `git_commit`. Loop stops with `idle · stopped: pending_gate`. Click **Commit** on the tool card; agent continues without a new user message.

3. **pending_gate resume (shell Run)** — Auto-run shell off. Ask for a `shell` tool (e.g. `pwd`). Click **Run** on the tool card; after exit, loop resumes.

4. **Git refresh** — After Commit (or auto git_commit), StatusBar / Workspace branch dirty flag updates via `git_status`.

5. **Search tools + @pin** — With bridge connected: `@src/App.tsx what does it export?` prefetches pin; chip **search** fills `semantic_search `; tools `list_dir` / `file_outline` / `semantic_search` auto-run when connected.
