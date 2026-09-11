# Enhanced CLI Flow — Design

> Status: design (2026-09-11). Replaces the CLI's ad-hoc, stacked "rules and filters" with
> ONE predictable, visible turn lifecycle, and upgrades the CLI from a no-tool text chat into a
> bounded, transparent tool-using surface that reuses the main agent's infrastructure.
> Grounded in the current [CliScreen.tsx](../src/screens/CliScreen.tsx), reusing
> [agentTools.ts](../src/lib/agentTools.ts), [sse.ts](../src/lib/sse.ts),
> [bridgeClient.ts](../src/lib/bridgeClient.ts), [agentHelpers.ts](../src/lib/agentHelpers.ts).

## 1. Goals

1. **One flow, not many filters.** Every AI turn runs the *same* lifecycle; behavior differences
   come from a single, visible **intent classification** — not from a stack of independent
   `looksX()` prepends and post-processors firing in unpredictable combinations.
2. **Make the CLI actually capable.** Today AI mode enables **zero tools**
   ([CliScreen.tsx:1329](../src/screens/CliScreen.tsx)), so it can only emit text; side effects
   happen through fragile auto-run/scaffold layers. Give it a **bounded, transparent tool loop**.
3. **Stop diverging from the main agent.** Reuse `executeAgentTool` and the shared tool schemas
   so the CLI and `useAgentLoop` obey the *same* rules instead of two rule sets.
4. **Transparency & control.** The user always sees how the turn was interpreted and what side
   effects will happen, under one autonomy policy — no surprise file writes or shell runs.
5. **Keep it lean & local.** Uncensored, local-first; the CLI stays a fast terminal surface, not
   a second full IDE agent.

## 2. The enhanced turn lifecycle

Every AI turn is one small, visible state machine. Trivial chat falls straight through Act; a
build fans out through every phase. Each phase emits a compact status line in the transcript.

```
  input ─▶ ┌──────────┐   the ONE place intent is decided (visible chip, overridable)
           │ CLASSIFY │──▶ intent ∈ {chat, web, build, edit, run, debug, command}
           └────┬─────┘
                │  (per-intent toolset + which phases run)
        ┌───────┼───────────────────────────────────────────────┐
        ▼       ▼                                                 ▼
   ┌────────┐  ┌────────┐  ┌────────┐  ┌──────────────┐  ┌──────────┐  ┌───────────┐
   │ RECALL │─▶│  PLAN  │─▶│  ACT   │─▶│ TOOL-LOOP    │─▶│  VERIFY  │─▶│ SUMMARIZE │
   │(mem,   │  │(build: │  │(stream │  │(exec tool →  │  │(build/   │  │(build/    │
   │ opt.)  │  │ scaf-  │  │ answer)│  │ feed back →  │  │ edit:    │  │ edit only)│
   │        │  │ fold)  │  │        │  │ continue,    │  │ build/   │  │           │
   │        │  │        │  │        │  │ ≤ N steps)   │  │ test)    │  │           │
   └────────┘  └────────┘  └────────┘  └──────────────┘  └──────────┘  └───────────┘
                                             ▲   │
                                             └───┘  bounded loop (step budget + abort)
```

| Phase | Runs for | What it does | Wired to |
|-------|----------|--------------|----------|
| **Classify** | every turn | decide intent once; render an intent chip; allow override | new `classifyCliTurn()` folding today's `looksBuildIntent`/`looksWebInteractionDirective`/`looksReadOnlyOrControlPrompt`/`looksFactualQuestion` |
| **Recall** | opt-in | inject relevant memory (mempalace lessons) for the task signature | [self-learning design](./SELF-LEARNING-MEMPALACE.md) |
| **Plan** | build | scaffold the file skeleton first (existing Phase-1) | `runPreBuildScaffold` |
| **Act** | every turn | stream the model answer | `streamChatCompletion` |
| **Tool-loop** | web/edit/run/debug (and build if needed) | execute model tool calls, feed results back, continue until done or step budget | **`executeAgentTool`** (reused) |
| **Verify** | build/edit | run build/tests or a diff audit and report pass/fail | `bridge.runCommand`, `looksLikeBuildOutput`, `/serve` logs |
| **Summarize** | build/edit | the opt-in `### Summary` (never on plain chat) | existing opt-in summary |

## 3. Intent classifier — the single source of behavior

Replace the scattered `looksX()` prepends with ONE `classifyCliTurn(text, ctx)` returning
`{ intent, toolset, phases, confidence }`. Render a small **intent chip** on the user's turn
(`▷ build`, `▷ web`, `▷ edit`…) with a click-to-override menu, so interpretation is visible and
correctable — not magic.

| Intent | Trigger (folds today's heuristics) | Toolset | Extra phases |
|--------|-----------------------------------|---------|--------------|
| `command` | `/…`, `$…`, `continue` | — | (routed as today) |
| `chat` | default; factual/explain Q&A | none | — |
| `web` | `looksWebInteractionDirective` | `web_search`, `web_fetch` | Tool-loop |
| `build` | `looksBuildIntent && !debug` | `list_dir`, `read_file`, `write_file`, `run_shell` | Plan → Tool-loop → Verify → Summarize |
| `edit` | modify existing workspace files | `read_file`, `grep`, `list_dir`, `write_file`, `run_shell` | Tool-loop → Verify → Summarize |
| `run` | start/serve/execute | `run_shell`, `spawn_server` | Tool-loop |
| `debug` | error/traceback/"why fails" | `read_file`, `grep`, `run_shell` | Tool-loop → Verify |

The classifier is heuristic-first with an optional cheap LLM tiebreak only when confidence is low.

## 4. Bounded agentic tool loop (the core upgrade)

Today's turn enables no tools, and the *old* web tool handling dead-ended (results dumped as
system messages the model never saw). Replace both with a **real, bounded loop that reuses the
main agent's executor**:

```
answer, toolCalls, finishReason = stream(messages, tools = intent.toolset)
steps = 0
while toolCalls.length and steps < STEP_BUDGET and !aborted:
    for call in toolCalls:
        render a tool card (name + args)              # transparent
        if call is destructive: apply autonomy policy # §5
        result = executeAgentTool(call, {workspaceRoot, settings})   # REUSED
        append assistant(tool_calls) + tool(result) to messages
        render result under the card
    answer, toolCalls, finishReason = stream(messages, tools)
    steps++
finalize(answer)
```

- **Reuse** `executeAgentTool` ([agentTools.ts:200](../src/lib/agentTools.ts)) and `mcpToolsToOpenAi`
  so tool schemas, sanitization (`sanitizeToolForGrammar`), and guards match the main agent — no
  second rule set.
- **Bounded:** `STEP_BUDGET` (default ~6) with a visible "step k/N" and the existing Stop/abort.
- **Transparent:** each call renders as a labeled step with its result, so the flow reads like a
  clean agent transcript instead of opaque system-message dumps.
- **Proper protocol:** assistant `tool_calls` + `tool` result messages fed back (fixes the
  dead-end); the model synthesizes a real final answer.

## 5. One autonomy policy (replaces scattered toggles)

Collapse `autoRunShell` + `autoScaffoldOnBuild` (+ implicit auto-writes) into **one** setting with
three levels, shown in the header and honored by every side-effecting tool:

- **Read-only** — model may read/search/list; write/shell/serve are proposed, never executed.
- **Ask** (default) — destructive tools pause for a one-click Approve/Skip in the transcript.
- **Auto** — destructive tools run automatically, each announced (today's auto-run behavior).

This makes scaffold writes, shell runs, and server spawns obey a single, predictable rule the
user controls — instead of two independent toggles plus hidden writes.

## 6. Unified `runTurn()` + honor settings

- One `runTurn({ text, intentOverride?, resume? })` powers **send, continue, retry, and
  intent-override** — no divergent `sendAiChat`/`handleContinue` pipelines (which today differ in
  prompt, tools, and reasoning handling).
- Respect `settings.maxTokens`/reasoning instead of the hardcoded `8192`
  ([:1312](../src/screens/CliScreen.tsx), [:596](../src/screens/CliScreen.tsx)); keep 8192 only as
  a named fallback default.
- One reasoning path (`splitThinkFromContent` → promote-only-if-empty) shared by all entry points.

## 7. Memory (optional, ties to the self-learning design)

Recall relevant lessons in the **Recall** phase and record the verified outcome after **Verify**,
per [SELF-LEARNING-MEMPALACE.md](./SELF-LEARNING-MEMPALACE.md). Off by default; when on, the CLI
gets better at recurring tasks without changing the visible flow.

## 8. Architecture: extract `useCliAgent`

Move the orchestration (classify, runTurn, tool-loop, scaffold, serve, workspace, shell) out of
the 3,206-line component into `src/hooks/useCliAgent.ts`, leaving `CliScreen.tsx` as presentation
— mirroring the `ChatScreen`→`useAgentLoop` extraction. This shrinks the monolith and reduces the
collision surface for concurrent edits.

## 9. Phased implementation plan

- **Phase 1 — Classifier + intent chip.** Add `classifyCliTurn()`; render the chip + override;
  route today's behavior through it (no behavior change yet). *Test:* unit-test the classifier on
  a prompt corpus (build/web/edit/debug/chat).
- **Phase 2 — Bounded tool loop.** Wire `executeAgentTool` with `STEP_BUDGET` and tool cards for
  `web`/`edit`/`debug`; delete the dead-end tool handling. *Test:* a `web` turn performs a search
  and returns a synthesized answer (not a raw dump); step budget + abort honored.
- **Phase 3 — Autonomy policy.** Replace `autoRunShell`+`autoScaffoldOnBuild` with the
  three-level control; gate destructive tools. *Test:* Ask pauses a `write_file`; Auto runs it;
  Read-only proposes only.
- **Phase 4 — Unify + settings.** Single `runTurn()`; honor `settings.maxTokens`; one reasoning
  path. *Test:* send/continue/retry produce a consistent voice; maxTokens respected.
- **Phase 5 — Extract `useCliAgent`** (mechanical move, `tsc`/render parity). *Optional:*
  Phase 6 — memory recall/record.

## 10. Before → after (what the user feels)

| Before | After |
|--------|-------|
| Hidden `looksX()` prepends stack unpredictably | One visible intent chip, overridable |
| AI mode can't use tools; web dead-ends | Bounded, transparent tool loop that actually searches/reads/runs |
| Two toggles + hidden writes | One autonomy policy (Read-only / Ask / Auto) |
| `sendAiChat` ≠ `handleContinue` | One `runTurn()` |
| Mandatory/ fabricated summaries (removed) | Summary only on build/edit |
| 3,206-line monolith | `useCliAgent` hook + thin view |
