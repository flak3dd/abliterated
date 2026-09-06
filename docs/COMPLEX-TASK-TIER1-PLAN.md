# Complex-task Tier-1 — implementation plan

**Audience:** coding agents shipping Abliterated IDE harness depth for long / multi-step work.
**Repo:** `flak3dd/abliterated`.
**Posture:** unrestricted regime — **no new safety refusals**, no Plan-mode breakage, no secrets in git.
**Sequencing:** **2 → 3 → 4 → 5** after Featherless large-Qwen lands (item 1 is merge-only).

Cross-links:

| Doc / code | Role |
| --- | --- |
| [`docs/FEATHERLESS-QWEN-BUILD.md`](./FEATHERLESS-QWEN-BUILD.md) | Featherless large-Qwen harness (other agent) |
| [`docs/OPTIMIZATION-NOTES-2026-09-06.md`](./OPTIMIZATION-NOTES-2026-09-06.md) | Cap already maps Jobs to error + stopReason cap |
| [`docs/PARALLEL-GROK-CLI.md`](./PARALLEL-GROK-CLI.md) | Manual worktree pattern |
| `src/lib/jobRunner.ts` | Headless agent loop |
| `src/screens/ChatScreen.tsx` | Interactive agent loop |
| `src/lib/agentTools.ts` / `src/lib/sse.ts` | Tool exec + schemas |

---

## Ship flags (global)

| Flag / setting | Default | Meaning |
| --- | --- | --- |
| (always on) verify-before-done nudges + incomplete-on-cap | on | No kill-switch; core correctness |
| `jobWorktreesEnabled` | **false** | Opt-in per-Job git worktree under `.ablit/worktrees/<jobId>` |
| Plan mode | unchanged | `write_file` / shell / MCP stay out of `PLAN_MODE_TOOLS` |
| Unrestricted | unchanged | Do **not** add refusal text, content filters, or cannot-help paths |

---

## 1. Featherless large-Qwen harness — merge only

**DEPENDENCY:** another agent lands [`docs/FEATHERLESS-QWEN-BUILD.md`](./FEATHERLESS-QWEN-BUILD.md) and related code (featherlessQwen.ts / catalog allowlist / harness parity — see that guide).

### Plan section (do not re-implement)

1. Wait until Featherless PR/branch merges to `main` (or rebase this Tier-1 branch onto it).
2. **Do not** re-copy Featherless catalog filters, enable_thinking, or empty-stream amputation reverts here.
3. After merge: smoke Chat + Jobs on Qwen/Qwen3-32B with full tools; confirm Tier-1 tools (`verify`, `task_*`, `write_file`) still appear in `CHAT_TOOLS`.

### Files to touch (this Tier-1 lane)

- None for Featherless itself — only rebase/merge conflicts if any.

### Acceptance

- Selecting Featherless never wires small/non-Qwen junk (per Featherless guide).
- Tier-1 commits do not fork a second system prompt for Featherless.

### Risks

- Parallel WIP on featherless-large-qwen vs this branch → use a **separate git worktree**; rebase after merge.

---

## 2. Verify-before-done

### Goal

Stop false success when the agent hits a turn cap or skips verification after implement.

### Behaviour

| Surface | Rule |
| --- | --- |
| **Jobs** | Turn cap / max turns must **not** persist `status: done`. Use `status: incomplete` (or `error`) + `stopReason: 'cap'`. |
| **Jobs** | Build/large runs: after implement, require a verify step (shell/`verify` tool or structured checklist). One forced nudge if missing, then continue if turns remain. |
| **Chat** | Surface incomplete on `stopReason: 'cap'` (idle subtitle + optional assistant note). Build mode: same verify nudge; optional `verify` tool. |
| **Acceptance** | False-done rate drops; Jobs list shows **incomplete** on cap (not green done). |

### Files to touch

| File | Change |
| --- | --- |
| `src/types/index.ts` | `JobStatus` += `incomplete`; stopReason already has cap |
| `src/lib/jobRunner.ts` | Cap → incomplete; verify nudge before done |
| `src/lib/agentHelpers.ts` | formatIdleSubtitle incomplete wording; verify nudge helpers; looksLikeVerifyEvidence |
| `src/screens/JobsScreen.tsx` | Badge + filter for incomplete; show stopReason |
| `src/screens/ChatScreen.tsx` | Cap → incomplete UI; inject verify nudge in build loop |
| `src/lib/sse.ts` / agentTools.ts / types | Optional first-class `verify` tool (shell wrapper) |
| `src/lib/systemPrompt.ts` | Mention verify tool + incomplete-on-cap |
| `scripts/test-*.mjs` | Cover incomplete + verify nudge helpers |

### Sequencing

Ship **before** task graph so Jobs telemetry is trustworthy for long runs.

### Risks

- Treating every text-only Q&A as needing verify → only nudge when Build mode / build-process / large-job heuristics fire.
- Do not block Plan mode explore with verify requirements.

---

## 3. Persistent task graph

### Goal

Survive context fit better than raw chat for 40+ step tasks.

### Design

- Path: `.ablit/task.json` (session default) and/or `.ablit/tasks/<id>.json` later.
- Schema (v1): version, goal, subtasks with id/text/status/blockers, updatedAt.
- Auto-inject compact summary into system prompt each turn (Chat + Jobs).
- Tools: task_read / task_update (prefer dedicated tools so todo stays ephemeral).

### Files to touch

| File | Change |
| --- | --- |
| `src/lib/taskGraph.ts` | new — parse/format/apply/update helpers |
| `src/types/index.ts` | add task_read, task_update; allow in PLAN_MODE_TOOLS |
| `src/lib/sse.ts` | tool schemas |
| `src/lib/agentTools.ts` | exec via bridge on `.ablit/task.json` |
| `src/lib/storage.ts` | PREV6 upgrade for new tools |
| `src/screens/ChatScreen.tsx` | load + inject task block |
| `src/lib/jobRunner.ts` | load + inject |
| `src/lib/systemPrompt.ts` | document tools |
| `scripts/test-task-graph.mjs` | unit smoke |

### Acceptance

- 40+ step tasks keep original goal in `.ablit/task.json` across compaction / long loops.
- Plan mode can read/update the graph (meta), still cannot write_file code.

### Risks

- Dual checklist (todo vs task graph): todo = turn checklist; task graph = durable goal/subtasks.
- Unrestricted: task graph must not become a refusal policy store.

---

## 4. First-class write_file tool

### Goal

Promote bridge write_file to an agent tool alongside diffs.

### Behaviour

- Tool write_file { path, content } → bridge.writeFile.
- Gated like other writes: needs Auto-accept edits (interactive gate / headless soft-skip).
- Plan mode blocked (not in PLAN_MODE_TOOLS).
- Diffs / path fences remain valid; write_file is an alternative for whole-file creates/rewrites.

### Files to touch

| File | Change |
| --- | --- |
| `src/types/index.ts` | add write_file; PREV6 list |
| `src/lib/sse.ts` | schema |
| `src/lib/agentTools.ts` | execute + workspace gate |
| `src/lib/storage.ts` | upgradeEnabledTools PREV6 |
| `src/lib/systemPrompt.ts` | Tools section |

### Acceptance

- Model can create/overwrite a file without a diff fence when Auto-accept is on.
- Plan mode still refuses write_file at tool filter / exec layer.

### Risks

- Prefer diffs for surgical edits. No new safety refusals beyond workspace jail + deadly shell list.

---

## 5. Job worktrees (flag / stub OK)

### Goal

Optional per-Job isolation under .ablit/worktrees/<jobId> so parallel Jobs do not stomp the same tree.

### Behaviour (v1)

- Setting jobWorktreesEnabled (default false).
- When on: ensure .ablit/worktrees/<jobId>/ exists; prefer git worktree add when repo is git; log path on job.
- Known limit: bridge today has a single ROOT. v1 creates/logs the path; full root switching is follow-up.

### Files to touch

| File | Change |
| --- | --- |
| src/types/index.ts | jobWorktreesEnabled on settings |
| src/lib/storage.ts | default false |
| src/screens/SettingsScreen.tsx | toggle |
| src/lib/jobRunner.ts | prepare stub + log |
| src/lib/jobWorktree.ts | new helper |

### Acceptance

- Flag off: identical to today.
- Flag on: job log mentions worktree path; soft-skip if git missing.

### Risks

- Parallel Jobs + single bridge root = race. Keep default off until multi-root bridge.

---

## Suggested commit slices
1. docs plan
2. verify-before-done + incomplete status
3. task graph skeleton
4. agent write_file tool Plan-blocked
5. job worktrees flag stub

Build and tests must pass each slice.

## Deferred
- Featherless re-implement
- Bridge multi-root isolation
- Cloud agents / computer-use

---

## Tier-1 → multi-agent (do not paint into a corner)

Tier-1 primitives are the foundation for a later Hierarchical Manager–Worker runtime. Tier-1 ships primitives + an optional flag-gated MVP runtime (`multiAgentEnabled`, default off). Full fleet UI remains Tier-2.

| Tier-1 primitive | Multi-agent role |
| --- | --- |
| `.ablit/task.json` task graph | **v1 shared blackboard** schema (goal, subtasks, status, blockers) |
| verify-before-done + `verify` tool | Seed for a **mandatory critic / verifier** role |
| Job worktrees (`.ablit/worktrees/<jobId>`) | Conflict-prevention for parallel workers |
| `status: incomplete` + stopReason | Honest completion signaling (blocks cascade false-done) |

See also [`docs/MULTI-AGENT-COORDINATION.md`](./MULTI-AGENT-COORDINATION.md) for Phase / Tier-2 design, failure modes, and IDE UI requirements.

### Compatibility rules (locked for Tier-1)

- Keep task graph schema versioned (`version: 1`) and additive.
- Do not hard-wire single-agent-only assumptions into `task_read` / `task_update`.
- Worktrees stay behind `jobWorktreesEnabled` (default off) until bridge multi-root exists.
- Critic/verify remains a nudge + tool in Tier-1; promoting to a separate agent role is Tier-2.
