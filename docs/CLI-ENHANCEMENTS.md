# CLI Enhancements — Phase Roadmap & Status

> Single tracker for every enhancement to the Abliterated CLI ([src/screens/CliScreen.tsx](../src/screens/CliScreen.tsx)).
> Design rationale lives in [CLI-ENHANCED-FLOW.md](./CLI-ENHANCED-FLOW.md); this file tracks
> **what ships in each phase, its status, files, and how it's verified.**
> Legend: ✅ shipped · 🟡 in progress · ⬜ planned.

## Goal

Turn the CLI from a text chat whose behavior emerged from a stack of ad-hoc `looksX()`
filters into **one predictable turn lifecycle** — visible intent, a bounded/transparent tool
loop, one autonomy policy — that reuses the main agent's infrastructure instead of maintaining a
second rule set.

The lifecycle every AI turn flows through:

```
input ─▶ CLASSIFY ─▶ [RECALL] ─▶ [PLAN] ─▶ ACT ─▶ [TOOL-LOOP] ─▶ [VERIFY] ─▶ [SUMMARIZE]
```

---

## ✅ Phase 0 — Groundwork (shipped)

Foundations the phased flow builds on.

| Enhancement | What | Status |
|-------------|------|--------|
| Workspace commands | `/workspace|/ws|/mkws` — create (mkdir -p) & pin a workspace root | ✅ |
| Scaffolding | `/scaffold [paths|auto]` + pre-build scaffold; tree/flat manifest parser (`parseScaffoldSpec`, `scaffoldStub`) | ✅ |
| Spin servers | daemon `spawn_server`/`list_servers`/`server_logs`/`stop_server`; `/serve` commands; orphan-safe shutdown | ✅ |
| Web + venv | `/search`, `/fetch`, `/venv`; proactive web augmentation; auto-run shell toggle | ✅ |

## ✅ Phase 0.5 — Pipeline cleanup & stability (shipped · commit `4e4865e`)

Removed the "many rules and filters" that produced confusing responses.

- One lean system prompt (dropped λ theatrics, the duplicate web block, the mandatory summary).
- Response summary is **opt-in** on build turns; no client-side fabrication.
- Dropped the dead-end built-in web tools (mid-answer calls had no follow-up completion).
- Truncation keys only on `finishReason === 'length'`.
- Auto-run shell only when the reply has exactly one shell block.
- **Fixed an infinite render loop** (`Maximum update depth exceeded`): `bridge.onRootChange`
  fires on subscribe, so an unstable callback prop caused resubscribe→setState→rerender — now
  held in a ref and subscribed once on mount.
- **Verify:** `tsc -b` clean; fresh-load render → zero console errors.

## ✅ Phase 1 — Intent classifier + chip (shipped · commit `a08a12b`)

The single, visible interpretation of each turn.

- New [src/lib/cliIntent.ts](../src/lib/cliIntent.ts): `classifyCliTurn()` → one of
  `command · debug · web · build · edit · run · chat`, precedence
  `command > debug > web > build > edit > run > chat`. Self-contained; the authoritative
  build/web signals are injected by the caller (`looksBuildIntent`/`looksWebInteractionDirective`).
- `CliScreen` classifies each turn once, tags the user message, renders an **intent chip**, and
  routes the build gate / web augmentation / opt-in summary through that one classification
  (behavior preserved).
- **Test:** [scripts/test-cli-intent.mjs](../scripts/test-cli-intent.mjs) — 39 assertions.
- **Verify:** live turn shows `▷ CHAT`; `tsc` clean; no console errors.

## ✅ Phase 1.5 — Response UX (shipped · commit `a08a12b`)

- **Minimal "thinking":** the model is asked for a 1–3 line thought process; rendered as a live
  `⊙ thinking` box during streaming, kept out of the answer body.
- **Response-related suggestions:** `getPromptSuggestions` now gets the turn intent, the answered
  question, and produced files; `deriveSubject()` (heading → inline code → fenced-code identifier
  → cleaned prompt) makes follow-ups name the actual topic instead of a generic "this".
- **Verify:** existing `test-prompt-suggestions.mjs` 8/8; subject extraction unit-checked
  (`closure → "javascript closure"`, `Promise`, `AuthService`, `debounce`).

---

## ✅ Phase 2 — Bounded, transparent tool loop + intent override (shipped)

Makes the CLI genuinely capable and removes the no-tools limitation.

- **Per-intent toolsets** (`CLI_TOOLSETS` in [CliScreen.tsx](../src/screens/CliScreen.tsx)):
  web→`web_search/web_fetch`; edit→read/grep/glob/list/outline/semantic (+`write_file`);
  debug→read/grep/glob/list/outline/`git_status`/`git_diff` (+`shell`); run→read/list (+`shell`);
  build→list/read/glob/grep (+`write_file`/`shell`); chat/command→none. `write_file` and `shell`
  are gated by the Auto-accept-edits / Auto-run-shell toggles until Phase 3.
- **Bounded loop reusing `executeAgentTool`** ([agentTools.ts](../src/lib/agentTools.ts)): model
  tool call → execute → feed the result back (proper `assistant.tool_calls` + `role:'tool'`
  protocol, mirroring `useAgentLoop`) → continue, capped at `CLI_TOOL_STEP_BUDGET` (6) with abort.
- **Transparent:** each call renders as a labeled step (`⚙ step k/N · read_file(...)` + `↳ status: …`)
  instead of the old dead-end system-message dump.
- **Intent override:** the chip is now a button → a "re-run as" menu (build/edit/run/debug/web/chat)
  that re-runs the turn with a forced intent (`sendAiChat(prompt, forcedIntent)`).
- **Verify:** `tsc -b` clean; live — DEBUG turn classified + chip override menu renders all intents;
  no console errors. Loop activation is model-driven (the model must emit tool calls); the
  execution path is the same one E2E-verified earlier (web_search, exec, spawn).

## ⬜ Phase 3 — One autonomy policy (planned)

Collapse `autoRunShell` + `autoScaffoldOnBuild` + implicit writes into a single control:

- **Read-only** — read/search/list only; writes/shell/serve proposed, never executed.
- **Ask** (default) — destructive tools pause for one-click Approve/Skip.
- **Auto** — destructive tools run automatically, each announced.
- **Test:** Ask pauses a `write_file`; Auto runs it; Read-only proposes only.

## ⬜ Phase 4 — Unify `runTurn()` + honor settings (planned)

- One `runTurn({text, intentOverride?, resume?})` powers send / continue / retry / override
  (kills the `sendAiChat` ≠ `handleContinue` divergence).
- Respect `settings.maxTokens`/reasoning instead of the hardcoded `8192` (named fallback only).
- One reasoning path across all entry points.
- **Test:** send/continue/retry produce a consistent voice; `maxTokens` respected.

## ⬜ Phase 5 — Extract `useCliAgent` (planned)

- Move orchestration (classify, runTurn, tool-loop, scaffold, serve, workspace, shell) into
  `src/hooks/useCliAgent.ts`, leaving `CliScreen.tsx` as presentation (mirrors the
  `ChatScreen`→`useAgentLoop` split). Shrinks the ~3.2k-line monolith.
- **Test:** `tsc` + render parity; no behavior change.

## ⬜ Phase 6 — Self-learning memory (optional)

- Recall relevant lessons in **Recall**, record verified outcomes after **Verify**, per
  [SELF-LEARNING-MEMPALACE.md](./SELF-LEARNING-MEMPALACE.md). Off by default.

---

## Before → after (net effect once Phases 2–5 land)

| Before | After |
|--------|-------|
| Hidden `looksX()` prepends stacked unpredictably | One visible, overridable intent chip |
| AI mode can't use tools; web dead-ended | Bounded, transparent tool loop |
| Two toggles + hidden writes | One autonomy policy (Read-only / Ask / Auto) |
| `sendAiChat` ≠ `handleContinue` | One `runTurn()` |
| Mandatory / fabricated summaries | Summary only on build/edit |
| ~3.2k-line monolith | `useCliAgent` hook + thin view |

## Verification snapshot (current)

`tsc -b` clean · `test-cli-intent.mjs` 39/39 · `test-prompt-suggestions.mjs` 8/8 · live CLI:
intent chip + `⊙ thinking` box render, zero console errors, render loop gone.
