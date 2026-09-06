# Complex-Task Agents — Evaluation + Hierarchical Orchestrator

**Audience:** implementers of Abliterated’s next agent-control plane.  
**Repo:** Abliterated IDE.  
**Date:** 2026-09-06.  
**Priority axis:** autonomous completion of long-horizon, multi-step work under **unrestricted / abliterated** models. Everything else is subordinated to that.  
**Safety theater:** none. Product gates stay **localhost bridge + click-to-Apply/Run** (judgment), not content refusals.

This document is the Phase 1–4 review of **this** IDE, then the Hierarchical Orchestrator design mapped onto existing primitives (Chat loop, Jobs, `todo`, checkpoints, Plan/Build). Schema code: [`src/lib/taskGraph.ts`](../src/lib/taskGraph.ts).

Cross-links: [`docs/GROK-BOT-BUILD-PROCESS.md`](./GROK-BOT-BUILD-PROCESS.md) · [`docs/FEATHERLESS-QWEN-BUILD.md`](./FEATHERLESS-QWEN-BUILD.md) · [`BENCHMARK.md`](../BENCHMARK.md) · [`docs/flagship-benchmark-2026-09-06.md`](./flagship-benchmark-2026-09-06.md)

---

## Missing measurements (read first)

No SWE-bench / Terminal-Bench / LiveCodeBench was run for this product. Flagship scores are **harness density**, not solve rate (`BENCHMARK.md`). There is **no stored corpus of failed 100–500 step traces** — only `AgentRunRecord` (turns, stopReason, tools, ms) kept 50-deep in localStorage.

Assumptions used below:

- Intended complex-task model = builtin `api.abliteration.ai` (`abliterated-model`, ~128k). Featherless 7B/8B/A3B is a **harness mismatch**, not the target (see Featherless-Qwen guide).
- Default Chat: `maxAgentTurns = 24`, hard cap **50**; self-deepen 2; Build on; Plan off; Auto-accept **off**; Auto-run shell **off**.
- Jobs: real background loop, license concurrency **1 (Free) / 4 (Pro)**, **shared workspace root**, no file locks.
- Parallel subagents = **No** in the 2026-09-06 matrix (item 10).

Critical traces still needed before treating scores as measured (not inferred): one successful 80+ turn multi-file feature; one failed large refactor at `stopReason=cap`; one Job collision (two jobs writing the same file); one Featherless Qwen3-32B vs builtin A/B on the same Build prompt.

---

# Phase 1 — Exhaustive mapping

## 1. Agent architecture overview

**What exists today is one ReAct agent, cloned.**

| Surface | What it is |
| --- | --- |
| Chat | Single-threaded tool loop in `ChatScreen.tsx`: stream → native/`fake` tools → execute → persist `role:tool` → next turn until no tools / cap / abort / error / pending_gate. |
| Jobs | `jobRunner.ts` is the **same loop** without a chat UI. `enqueueJob` → queue → one `streamChatCompletion` agent. Concurrent jobs are **N copies of the same agent**, not specialists. |
| Plan / Build | Prompt-mode locks, not a second process. Plan = read-only tools + checklist + stop. Build = todo → tools → diffs in **content**. |
| Self-deepen | After a no-tool turn, inject a user nudge (“expand or `[ANSWER_COMPLETE]`”), up to 2–5 extra turns. Completeness checklist is Abliterated-only (`deepenComplete.ts`). |
| MCP | Extra tools on the **same** loop when `allowMcp` and license allow. Not sub-agents. |

There is **no** planner/executor split in code. The model is both. Orchestration is prompt text (`SYSTEM_PROMPT` V17 Modes + per-turn nudges).

**Reasoning style:** optional CoT in `reasoning_content` (Abliteration `X-Reasoning`; Featherless Qwen3 `enable_thinking`). Not ToT, not process-supervised reflection. “Reflection” = self-deepen, which is the **same weights** scoring their own answer.

**Invocation:** OpenAI-compatible `POST /chat/completions`, stream SSE, `max_tokens` default 4096 (thinking should be 8192 — see Featherless-Qwen guide). Temperature / top_p / speculative decoding are **not** first-class settings. Sampling is whatever the host defaults.

**Abliterated models:** builtin unrestricted path is the product. Unrestricted generation is a **baseline**, not a flag. Dual-use asks are not refused in the system prompt. Destructive **shell** is still daemon-refused (`rm -rf` class) and Run is gated unless Auto-run is on. That is **exec judgment**, not alignment.

## 2. Task decomposition & planning surface

| Mechanism | Strength | Limit |
| --- | --- | --- |
| `todo` tool | Session checklist; merge=true to tick | **Flat.** No `depends_on`, no verification, no assignee, no budget |
| Plan mode | Forces a checklist before writes | Human must Approve; graph is markdown bullets (`parseTodoBullets`) |
| `looksLargeJob` / `shouldApplyBuildProcess` | Heuristic nudges for implement/refactor | Regex on the user string; not a HTN |
| Job `todos?: string[]` | Copied from planning output | Display only |
| Completion footer | “Done / Continue 1–3” | Next prompts, not a DAG |

**Ambiguous goals:** prompt says pick the repo default in one line and proceed. There is no clarify-or-decompose gate. Underspecified “build X” → Build nudge → often a todo list **without diffs** (then a one-shot implement nudge). That is the crypto-exploit failure mode: checklist / directory sketch, no grounded work.

**Re-plan triggers:** none as a first-class event. Cap, abort, pending_gate, or the user sending another message (mid-run inject). No “node failed verification twice → replan.”

## 3. Tool use & environment

Inventory (Chat `CHAT_TOOLS` + MCP + gated fences):

- **Workspace:** `read_file`, `grep`, `glob`, `list_dir`, `file_outline`, `semantic_search` (partial / keyword-ish), `write` via **diffs / `// path` fences** (Grok layer), not a first-class `write_file` tool in the agent schema.
- **Git:** `git_status`, `git_diff`, `git_commit`, `create_pr`, `checkpoint_save` / `checkpoint_restore` (`.ablit/checkpoints`).
- **Shell:** `shell` tool + ````bash` fences. Confirm-gated. Daemon binds **127.0.0.1:17322** only.
- **Web:** `web_search`, `web_fetch` (http(s)).
- **Skills:** `list_skills`, `read_skill`, `suggest_skill`, `write_skill`.
- **Images:** `generate_image` if Images tab on (local server; Abliteration cloud has no image gen).
- **MCP:** `mcp__server__tool` when configured.
- **No:** browser/computer-use, debugger/DAP, LSP diagnostics as tools, network scanner, disassembler.

**Reliability under abliterated / Qwen:**

- Builtin: tools generally work; explore turn 1 can send `tool_choice: required`.
- Featherless (pre-Qwen-lock): `tool_choice` forced `auto`; empty 200 **drops tools**; 400 strips tools — agent then **invents** listings. That is the #1 tool-reliability bug for catalog models.
- Fake tool JSON in content is parsed (`fakeToolCalls.ts`) or nudged. Abliterated models still do this when the tool channel fails.
- Parallel tool calls: the API can return multiple; the loop executes them **sequentially** in one turn, then calls the model again. No DAG of tool results. No write locks. Two Jobs can patch the same file.

**Recovery:** tool errors are strings fed back as `role: tool`. Compile failure is **not** a loop event unless the model chose to run tests. Empty tool results often get hallucinated-over rather than retried with a different query.

## 4. Memory & state for long horizons

| Layer | Implementation | Horizon |
| --- | --- | --- |
| Short-term | Thread messages in localStorage; `fitChatPayload` keeps system + newest, drops oldest | Dies at window (8k–128k) |
| Tool dumps | `MAX_API_TOOL_CHARS = 8000` | Early grep/read truncated |
| Reasoning history | Kept on Abliteration; **stripped** on Featherless Instruct | Qwen3 tool loops lose thought if stripped |
| Project memory | AGENTS.md / CLAUDE.md / `.cursorrules` / `.ablit/rules.md` clipped to **16k chars** | Static conventions, not episodic |
| Skills | Catalog + up to 6 workspace SKILL.md bodies (3k each) | Recipe, not task state |
| Checkpoints | File snapshots under `.ablit/checkpoints` | Rollback files, not agent mind |
| Jobs logs | Timestamped strings | Not queryable memory |
| Agent runs | Last 50 `{turns, stopReason, tools, ms}` | Telemetry, not retrieval |

There is **no** episodic store, **no** blackboard, **no** compressed global summary that later agents can query. Multi-day work = the human re-pastes context or the thread is packed until the packer deletes the original goal.

Context overflow handling is **drop-from-the-middle**, not salience. That is the memory-physics limit.

## 5. Execution loop & self-correction

Core cycle (Chat):

```
user → [optional Plan lock]
  for turn in 1..maxTurns:
    stream completion (tools?)
    coerce thought (no code) / coalesce reasoning → content
    apply grok diffs if auto-accept
    if tool_calls: execute (gates may pause → pending_gate) → append tool msgs → continue
    if fake tools in text: parse or nudge
    if Build and no diffs: todo/implement nudge (once each)
    if no tools: self-deepen unless footer valid or [ANSWER_COMPLETE]
  stop: no_tools | cap | abort | error | pending_gate | deepened
```

**Loop / dead-end detection:** fake-tool theater once; Build nudges once each; turn cap. No hash-of-actions “we listed src/ three times.” No goal-drift critic. Self-deepen can **extend** a bad answer.

**Backtrack:** `checkpoint_restore` if the model calls it; human Apply/Run; abort. No automatic restore on verify fail.

**Sub-agents:** none. Jobs are not children of Chat; they do not report a TaskResult to a parent.

## 6. Complex task coverage (inferred, not bench’d)

| Class | Can complete E2E today? | Why |
| --- | --- | --- |
| Trivial one-file patch, workspace connected, builtin model, auto-accept on | **Yes**, often | Tools + diffs; <10 turns |
| Multi-file feature, tests, Build on, human clicks Apply | **Sometimes** | Todo + explore; dies at 24 turns or “todo with no diffs” |
| Large refactor / migration | **Rarely** | Window + cap + no DAG; packer drops early files |
| Multi-stage research + implement | **Partial** | `web_search`/`web_fetch` exist; no researcher role; findings rot in the thread |
| Reverse-engineering / debugger workflows | **No** | No DAP, no binary tools |
| Dual-use / unrestricted content | **Attempts** | Prompt does not refuse; quality is model+harness. Gated shell. This doc does **not** add an exploit toolchain. |
| Overnight / multi-day autonomous | **No** | 50-turn wall; no team; no resume of a graph |

Observed pattern (prior session): a small Featherless model loop-pasted a directory sketch ~11 times and declared progress. That is **hallucinated progress** under tool amputation.

## 7. Failure modes (complex tasks)

| Mode | How it shows up here |
| --- | --- |
| Premature termination | `stopReason=no_tools` after a todo list; `[ANSWER_COMPLETE]` on a thin answer; cap at 24 |
| Hallucinated progress | Invented `list_dir` / file bodies; repeated skeletons; footer “Done” without diffs |
| Tool-call storms | Less common than **tool-call drought** (auto + empty retry). MCP can add storms |
| Memory corruption | Packer drops the original goal; 8k tool truncations; Featherless strips reasoning |
| Infinite loops | Fake-tool / Build nudges are once; remaining risk is model re-reading the same files until cap |
| Goal drift | Mid-run inject helps; no Goal Keeper. Deepen can wander into completeness essays |
| Over-confidence | Self-deepen and critic are the **same model**. No compile gate |
| Residual refusal | Builtin: low by design. Some Featherless “abliterated” forks still refuse or empty-200 |
| Job collision | Two jobs, one ROOT, no locks — last apply wins |
| Unrestricted aggression | Parallel auto-run shell would be the danger; default is gated. Do **not** auto-approve destructive tools to chase autonomy |

---

# Phase 2 — Adversarial scores (1–10)

Scores are **this product as shipped**, builtin path, default settings. Not a future orchestrator. Not a 72B on a perfect prompt.

| Dimension | Score | Justification |
| --- | --- | --- |
| **Long-horizon reliability** | **3** | Hard cap 50 turns (~24 default). No graph, no heartbeat, no resume of a plan across sessions. 50–500 steps is **out of band**. |
| **Decomposition quality** | **4** | Flat `todo` + Plan bullets. No dependencies, no success criteria per node, no re-decompose. Heuristic Build nudges. |
| **Error recovery** | **4** | pending_gate resume, fake-tool parse, empty coalesce, Featherless retries (often amputate tools). No verify-fail → restore checkpoint. |
| **Memory fidelity** | **3** | Drop-oldest packing, 8k tool clip, 16k conventions, no episodic blackboard. Early facts do not survive late stages by design. |
| **Autonomy** | **4** | With Auto-accept+Auto-run a small task can finish unattended. Complex tasks need clicks, re-prompts, or die at cap. Zero-intervention **complex** rate is low. Raising this by ungating shell is the wrong lever. |
| **Unrestricted task efficacy** | **7** | Prompt/posture is the niche (H=8/8 on flagship matrix). Builtin will attempt dual-use/unrestricted work aligned products refuse. **Quality** of those attempts still tracks the single-agent cap. |
| **Verification & grounding** | **3** | Self-declared `[ANSWER_COMPLETE]`, optional bash fence, no independent critic, no must-pass tests. `looksLikeBuildOutput` is a regex. |
| **Scalability of complexity** | **3** | Linear ReAct. Context and turn cap bind first. Jobs×N share a disk without a graph. Performance falls off a cliff past ~one-module changes. |

**Single biggest bottleneck**

Not model IQ (on the builtin). Not “need more tools.”

**A single ReAct loop with a 24–50 turn ceiling, a flat todo list, LLM-self-declared completion, and no shared task graph.** That is why parallel subagents scored **N**, why large jobs become directory sketches, and why adding another Job just races the same agent.

Second bottleneck (when not on builtin): **Featherless catalog models + crippled harness** (compact prompt, strip reasoning, drop tools). Fix with the large-Qwen guide; do not confuse it with the orchestration gap.

---

# Phase 3 — Ranked enhancement roadmap

Organizing principle: **hierarchical orchestrator + task DAG + specialist workers + independent critic**, on top of the **existing** Chat/Jobs/bridge. Do not spawn a second bridge. Do not spawn grok CLI. Do not re-introduce refusals.

## Mapping onto this repo (do not rebuild the IDE)

| Design piece | Existing primitive | New |
| --- | --- | --- |
| Human interface | Chat, Jobs tab, Plan Approve, mid-run inject, abort | Task graph panel |
| Orchestrator | Plan-mode agent (read-only tools) | Only writer of the graph |
| Task graph | `todo` items (flat) | `src/lib/taskGraph.ts` persisted at `.ablit/task-graph.json` + Job record |
| Blackboard | thread messages + job logs | Graph + artifacts + checkpoints |
| Workers | `enqueueJob` / Chat loop | Jobs with **scoped packet** (node id, criteria, budget, allowed tools, role) |
| Critic | self-deepen (same context) | Job with Plan-like tools + `shell` for tests; **cannot** complete a node |
| File conflicts | none | Orchestrator write-lock on `artifacts[].path` |
| Heartbeat | none | Job watchdog: no log line in N s → reassign |
| Checkpoints | `checkpoint_save` | One checkpoint per node start; restore on verify fail |
| Sandbox | daemon ROOT + gated exec | Keep. Per-node tool allow-list already exists (`enabledTools`) |
| Models | builtin + Featherless | Role → model: orchestrator/critic = thinking Qwen3-32B or builtin; coder = same; no 7B |

**Roles in v1 (Abliterated):** `orchestrator`, `coder`, `researcher`, `critic`, `integrator`.  
**Not in v1:** a specialist that emits working exploit payloads. Unrestricted **analysis** can live on researcher/coder with the same gated exec. Dual-use efficacy stays a **model posture**, not a new toolchain.

Orchestrator **does not** emit diffs. It only mutates the graph (already encoded: `assignNode` refuses unverified deps; `verifyNode` is the only path to `completed`).

## Tier 1 — High-leverage / next 1–2 cycles

### T1.1 Ship the Task Graph as the Build/Job spine

- **Change:** Persist `TaskGraph` on large jobs / Build mode. Orchestrator turn writes nodes via a new tool `task_graph` (create/add/assign/verify) instead of a markdown todo. Workers are `enqueueJob` with a packet. A node is not complete until `verifyNode` pass.
- **Why:** Stops “todo with no diffs” and “Done footer on a sketch.” Dependents cannot start on hallucinated success.
- **Surface:** `src/lib/taskGraph.ts` (done), `jobRunner.ts`, `agentTools.ts`, `types` Job.graphId, `.ablit/task-graph.json`, Chat header.
- **Acceptance:** On a 4-file “add feature + tests” fixture, ≥70% of trials produce a graph with ≥1 coder node **verified** by compile/unit_test or critic+script, with zero human graph edits. Mean “declared complete but tests fail” drops vs current Build.
- **Risk:** Coordination tax. Mitigate: trivial one-shot still skips the graph (`looksLargeJob` false → current loop). Unrestricted: graph does not add refusals; it adds **grounding**.

### T1.2 Independent critic (different context, execution-based)

- **Change:** When a coder node hits `verification_pending`, spawn a critic job with **only** the node packet + artifacts + test command. No coder thought. Must run the verify script (compile/test) when one exists; LLM pass without a script is allowed only for analysis nodes and is labeled `method: critic`.
- **Why:** Breaks same-window self-congratulation — the main verification failure.
- **Surface:** `jobRunner.ts` role, Plan-like tool filter + `shell` for tests, `verifyNode()`.
- **Acceptance:** Inject a failing test in the fixture; critic **fails** the node ≥90%. Inject a passing test; critic **passes** ≥90%. Self-deepen `[ANSWER_COMPLETE]` is **not** sufficient to complete a coder node.
- **Risk:** Extra tokens. Cap critic at 8 turns / 32k tokens. Do not let critic write product files (integrator/coder only).

### T1.3 Node budgets, heartbeats, checkpoint per node

- **Change:** Each node `budget.max_steps` (default 16 coder / 8 critic / 12 researcher). `consumeBudget` from existing `AgentRunRecord`. Watchdog: job log silence > 90s → fail node + reassign once. `checkpoint_save` at assign; `checkpoint_restore` on second verify fail.
- **Why:** Stops 24-turn death spirals on one subtask from burning the whole run. Enables 50–200 **graph** steps as many short workers.
- **Surface:** `jobRunner.ts`, `agentHelpers` stopReason, daemon checkpoints (exist).
- **Acceptance:** Mean steps-to-recovery after a forced tool error drops; no single node exceeds budget without `replan` history entry.
- **Risk:** Aggressive abort of slow compiles — exclude `shell` wall-time from the 90s heartbeat or ping on tool start.

### T1.4 Write locks + integrator

- **Change:** Blackboard lists claimed paths. Two in_progress nodes cannot share a write path. Integrator node merges branches / sequentializes.
- **Why:** Jobs already warn they share ROOT; collisions are the multi-agent unrestricted failure mode.
- **Acceptance:** Two parallel coder nodes on different files succeed; on the same file the second stays blocked until integrator or serial replan.
- **Risk:** False blocks on unrelated paths. Lock exact relative paths, not directories, in v1.

### T1.5 Orchestrator-only Goal Keeper

- **Change:** Graph `original_goal` + `success_criteria` injected into **every** worker packet (≤2k chars). Workers cannot edit them. Human “Inject guidance” appends a history `escalate` and triggers replan — does not kill the run.
- **Why:** Goal drift across specialists.
- **Acceptance:** Critic or human audit: worker outputs that contradict `original_goal` get a fail, not a complete.

## Tier 2 — Structural

- Dynamic spawn/retire of workers with `global_budgets.max_parallel_agents` (license `maxConcurrentJobs`).
- Persistent blackboard queryable next session (`.ablit/task-graph.json` + artifact index).
- Cross-model routing: orchestrator/critic = thinking 32B+ or builtin; coder = same; never 7B.
- Human-editable graph UI (status colors, Force Replan, Terminate Node) — Jobs tab first, not a new product.
- Process supervision: store (packet → tools → artifacts → verify) as JSONL under `.ablit/runs/` for eval.

## Tier 3 — Moat

- Competing solution branches with prune-on-verify (keep two coder attempts, critic picks).
- Overnight Jobs with OS notification only on `graph.status` completed/failed (Electron).
- Self-improving decomposition: store which node templates succeeded; **do not** fine-tune refusals back in.
- Not: cloud VM agents, second exec plane, ungated mass shell.

## What must not regress

- Localhost-only bridge; gated Apply/Run defaults.
- Plan mode write lock.
- Unrestricted builtin path (no new content refusals).
- Single-shot Chat for small asks (no orchestrator tax).
- Featherless large-Qwen lock (do not reopen the junk catalog to “give workers variety”).

## Ship strategy

1. **Flag** `orchestratorEnabled` (Settings, default off; Pro/Team if you must gate compute — not a content gate).
2. Schema + unit tests (this PR).
3. JobRunner packet + critic verify on `looksLargeJob` only.
4. Chat panel (read-only graph) then edit actions.
5. Eval harness: 10 frozen fixtures (multi-file feature, failing test, lock conflict, cap recovery). No live dual-use scoring in CI.

---

# Phase 4 — Synthesis

## Top 5 ROI (gain in complex-task completion / engineering cost)

1. **Task graph with verified deps** — cheap (schema exists); kills hallucinated handoff.  
2. **Execution critic** — medium; biggest jump in “don’t declare victory.”  
3. **Node budgets + checkpoint restore** — cheap; turns 24-turn wall into many hops.  
4. **Write locks / integrator** — cheap; required the moment Jobs > 1.  
5. **Large-Qwen / builtin only on workers** — already specified; without it the orchestrator assigns work to 7B clowns.

Not in top 5: swarm voting, dynamic personality spawning, computer-use, “exploiter” role.

## If we only improve three things this quarter

1. **Graph + verify-to-complete** on Jobs/Build.  
2. **Critic job with tests.**  
3. **Stop sending ineligible Featherless models** (Qwen 32B+ / builtin).

That trio attacks decomposition, grounding, and checkpoint quality — the three reasons complex work dies here.

## Critical missing eval harnesses

- Frozen **multi-file feature** fixture (apply, `npm test` or pytest must pass).  
- **Injected failure**: break a test after coder “done”; critic must fail.  
- **Horizon**: count graph nodes completed, not Chat turns. Target: 30+ nodes, zero human, on a medium repo.  
- **Collision**: two writers one file.  
- **Memory**: fact planted at node 1 required at node 12 — must live on the blackboard, not in dropped chat.  
- **Unrestricted posture check:** same fixtures on builtin vs a refusing hosted API — **policy axis**, not a quality cheat code. Do not use exploit-success as a CI metric.

## Architectural limits feature work cannot overcome

- **Context physics:** one 128k window cannot hold a large repo. Blackboard + scoped packets are the workaround; infinite context is not.  
- **Single-threaded cognition:** even a 72B serial ReAct will goal-drift at hundreds of steps. Hierarchy is the point.  
- **Self-critique:** same weights, same context, will rubber-stamp. Independent critic + **exec** is mandatory.  
- **Turn cap vs wall clock:** 50 Chat turns ≠ 500 graph steps unless workers are short.  
- **Human exec gates:** default click-to-run caps autonomy by product law. Autonomy % should be measured with Auto-accept **on** for eval, **off** for daily unrestricted safety. Do not remove the gate to inflate the score.  
- **Model class:** 8B Instruct will not become an orchestrator. Allowlist is a hard floor.

---

# Hierarchical Orchestrator — IDE contracts

## Control messages (schema-validated; no free-form bus)

| Message | Dir | Payload |
| --- | --- | --- |
| `AssignTask` | Orch → Worker | `{graph_id, node_id, role, description, success_criteria, artifacts, budget, allowed_tools}` |
| `StatusUpdate` | Worker → Orch | `{node_id, consumed, note, blocker?}` |
| `TaskResult` | Worker → Orch | `{node_id, artifacts, self_assessment}` — **not** completion |
| `VerificationRequest` | Orch → Critic | `{node_id, artifacts, method, command?}` |
| `VerificationResult` | Critic → Orch | `{status, method, notes}` → `verifyNode` |
| `Escalation` | Worker → Orch | `{reason}` → replan or human |
| `ReplanTrigger` | Internal | verify fail ×2, budget, stall, human inject |

Workers stay **stateless wrt the global goal**. Packet + blackboard only.

## Re-plan triggers (implement these, not vibes)

- Node verify fail twice → split or reassign; keep verified siblings.  
- Budget exceeded → fail node, do not let it wander.  
- No node completed in 10 minutes of wall clock with workers alive → heartbeat reassign.  
- Human inject / Plan-mode edit of success_criteria → version++ replan.  
- Critic finds cross-artifact inconsistency → block dependents.

## Human UI (Jobs-first MVP)

- Live graph (node status colors: pending/ready/in_progress/verification/completed/failed/blocked).  
- Per-worker log (reuse Job logs).  
- Inject guidance, Force replan, Pause team, Terminate node, Mark verify human-pass (explicit; not the default for coder nodes).  
- Do not require a new product shell.

## Metrics to log per graph

`zero_intervention_success`, `nodes_completed`, `nodes_per_replan`, `tokens_to_verified_end`, `conflicting_writes`, `verify_fail_then_recover`, `human_rescues`, `residual_empty_replies` (model health).

---

# Implementation status

| Piece | State |
| --- | --- |
| Task graph types, parse, DAG, assign/verify/budget | **`src/lib/taskGraph.ts`** |
| Unit tests | **`npm run test:task-graph`** |
| `task_graph` tool, Job packets, critic, UI | Not built — Tier 1 |
| Zod | **Not added** (repo has no Zod; parser is hand-rolled and strict) |

MVP path: keep Chat one-shot; turn **Build + Jobs** into orchestrator+graph; 3 workers (coder, researcher, critic); verify hooks = existing `shell` + tests; heartbeat = job logs; panel = Jobs.

The central spine is **Orchestrator + Task Graph**. Specialists do the generative work. Completion is **verified or it did not happen.**
