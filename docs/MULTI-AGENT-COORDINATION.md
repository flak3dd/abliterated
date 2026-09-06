# Multi-agent coordination — Tier-2 design (docs only)

**Status:** design / not implemented in Tier-1.
**Depends on:** Tier-1 primitives in [`COMPLEX-TASK-TIER1-PLAN.md`](./COMPLEX-TASK-TIER1-PLAN.md).
**Posture:** unrestricted regime — no new refusals; coordination must not become a content filter.

---

## 1. Why this is the ceiling-raiser

Single-loop agents hit a structural wall on long tasks: context fit, false-done, and parallel write stomps. Multi-agent coordination raises the ceiling when grounded in:

1. A **shared blackboard** (task graph) that survives chat compaction.
2. A **mandatory critic** that blocks unverified success.
3. **Worktrees** so parallel workers do not clobber each other.
4. Hierarchical control with specialist roles + heartbeats + DAG dependencies.

Abliterated stays local-first: orchestrator + workers run through the existing Jobs / bridge harness, not a cloud-only mission control (that can come later).

---

## 2. Tier-1 primitives as foundation

| Primitive | Path / API | Multi-agent use |
| --- | --- | --- |
| Task graph | `.ablit/task.json` + `task_read` / `task_update` | **Shared blackboard** — goal, subtasks, blockers, status |
| Verify-before-done | `verify` tool + nudges + incomplete-on-cap | **Critic seed** — no done without evidence |
| Job worktrees | `.ablit/worktrees/<jobId>` + `jobWorktreesEnabled` | Parallel worker isolation (conflict prevention) |
| Jobs stopReason / incomplete | `jobRunner` | Honest terminal states for orchestrator heartbeats |

Schema evolution rule: bump `version` only for breaking changes; prefer additive fields (`assignee`, `role`, `dependsOn`, `heartbeatAt`).

---

## 3. Phase / Tier-2 — Hierarchical Manager–Worker

### Roles

| Role | Responsibility |
| --- | --- |
| **Orchestrator (Manager)** | Owns goal; decomposes DAG; assigns workers; merges results; never silent-success |
| **Coder** | Implements diffs / write_file in its worktree |
| **Researcher** | Read-only explore, web_search/fetch, notes to blackboard |
| **Tester** | Runs scoped tests; posts evidence |
| **Verifier (Critic)** | Mandatory; re-checks claims; can veto `done` → `incomplete` |

### Control plane (hybrid)

- **Hierarchical control:** Manager assigns / reassigns / kills workers.
- **Blackboard:** all roles read/write structured task graph + messages (not free-form chat as source of truth).
- **Persistent critic:** Verifier is always-on for Build / Job completion — not optional deepen.

### Messages / heartbeats / DAG

- Structured messages: `{ from, to, type, taskId, payload, ts }` (types: assign, progress, blocked, evidence, veto, done).
- Heartbeats: workers refresh `heartbeatAt`; Manager marks stale workers failed.
- DAG: subtask `blockers` / `dependsOn` already sketched in Tier-1 schema — extend, do not replace.

---

## 4. Failure modes (abliterated multi-agent)

| Failure | Symptom | Mitigation |
| --- | --- | --- |
| **Goal drift** | Workers optimize a side quest; original goal forgotten | Blackboard `goal` inject every turn; Manager refuses done if goal unmet |
| **Conflicting writes** | Parallel edits stomp same files | Per-worker worktrees; merge only via Manager + critic |
| **Cascade hallucinated success** | One false-done becomes fleet-wide green | Mandatory critic; incomplete-on-cap; evidence artifacts required |
| **Coordination tax** | More tokens talking than shipping | Compact structured messages; specialist prompts; turn budgets per role |
| **Parallel destructive tool use** | Concurrent `rm`, force-push, migrate | Worktree jail; existing deadly-command refuse; serialize dangerous tools via Manager |

Unrestricted note: mitigations are **coordination / integrity** controls, not content refusals.

---

## 5. IDE UI requirements (Tier-2+)

- **Live task graph** view (goal, DAG edges, status colors).
- **Per-agent traces** (orchestrator / coder / researcher / tester / verifier lanes).
- **Blackboard inspector** (raw `.ablit/task.json` + message log).
- **Operator controls:** inject note, reassign subtask, kill worker, pause fleet.
- **Session checkpoint** (save/restore blackboard + worktree refs under `.ablit/`).

Tier-1 already surfaces Jobs incomplete + stopReason and injects task graph into prompts — UI chrome above is deferred.

---

## 6. Ship strategy

1. **Tier-1 (this PR):** task graph, verify-before-done, write_file, worktrees flag — flags default safe.
2. **Tier-1.5:** bridge multi-root or serialized set_root so worktrees actually isolate Jobs.
3. **Tier-2:** orchestrator Job type + role prompts + structured message bus + mandatory critic agent.
4. **Progressive rollout:** settings flags per capability; never force multi-agent on Free tier without license gates.

### Non-goals for Tier-1 PR

- Do **not** implement full multi-agent runtime, role bus, or fleet UI here.
- Do **not** re-implement Featherless large-Qwen (merge that guide separately).
- Do **not** add safety refusal layers under the guise of coordination.

---

## 7. MVP runtime (flag-gated) — shipped in Tier-1 branch

Setting: `multiAgentEnabled` (default **false**).

When a Job is enqueued with **Multi-agent fleet** (Jobs UI) and the setting is on:

1. Seeds `.ablit/task.json` DAG (orchestrator → coder → tester → verifier).
2. Runs role loops via `src/lib/multiAgentRunner.ts` (reuses `streamChatCompletion` + `executeAgentTool`).
3. Appends structured events to `.ablit/agent-bus.jsonl`.
4. Heartbeats update `lastBeatAt`; stale in_progress can be reclaimed.
5. Verifier role is mandatory critic (verify-oriented tools; soft-skip writes).
6. Prefer `jobWorktreesEnabled` for isolation (bridge ROOT still shared — Tier-1.5).

Files: `multiAgent.ts`, `multiAgentRunner.ts`, `agentBus.ts`, extended `taskGraph.ts`.
