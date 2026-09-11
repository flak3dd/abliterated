# AI Self-Learning System on MemPalace — Design

> Status: design (2026-09-11). Turns the app's existing episodic memory into a genuine
> learning loop. Grounded in the real mempalace primitives and agent-loop hooks; no cloud.

## 1. Summary & goal

"Self-learning" here means: **the agent gets measurably better at recurring tasks over time
by recording what actually worked (verified), generalizing it into durable knowledge, and
recalling the right knowledge at the right moment** — without retraining weights and without
leaving the machine.

Today the app already has the two ends of a memory system but not the middle:

- **Recall** — `bridge.mempalaceWake(wing)` injects a verbatim "wake-up" block into the system
  prompt at session start ([useAgentLoop.ts:789](../src/hooks/useAgentLoop.ts), injected ~965),
  and the model has `memory_search / memory_save / memory_status / memory_wake` tools
  ([agentTools.ts:711](../src/lib/agentTools.ts)).
- **Store** — after each turn it saves the **raw** user+assistant transcript via
  `formatSessionMemory()` ([mempalace.ts:90](../src/lib/mempalace.ts),
  [useAgentLoop.ts:1297](../src/hooks/useAgentLoop.ts)).

**The gap:** it stores raw episodes and recalls them. There is no reflection/distillation, no
outcome/success signal, no credit assignment, no episodic→semantic consolidation, and no
decay. That is episodic memory, not learning. This design closes that gap.

### Primitive constraints (design against these, not assumed features)

MemPalace entries are **free text** ([daemon/mempalace.js](../daemon/mempalace.js) `mempalaceSave`
uses the CLI `mine` verb, clips to 24k chars). There is **no native schema, tags, scoring, or
TTL**, and the adapter currently exposes only `mine / search / wake / status / init / install`
— **no delete/prune**. Therefore:

- All structure is encoded **by convention** in the saved text + in **room** names.
- Reinforcement scores live **in the entry text** and are updated by *superseding* (writing a
  newer, higher-scored version) — not by mutating in place.
- **Forgetting has to be emulated** (tombstones + room rewrites during consolidation), or we
  extend the CLI adapter. ⚠️ *Open item: confirm whether the `mempalace` CLI supports a delete/
  forget/list verb; if it does, wire it in `daemon/mempalace.js`; if not, use the tombstone
  strategy in §6.*

## 2. Architecture — the closed loop

```
                 ┌─────────────────────────────────────────────────────┐
                 │                     MemPalace                        │
                 │  wing = workspace   rooms = memory layers (§3)        │
                 └───────▲───────────────────────────────────┬─────────┘
      (7) improved       │ store (scored)          recall (2)│
          recall         │                                    ▼
   ┌───────────────┐   (5)distill+score        ┌────────────────────────┐
   │ CONSOLIDATE   │◀──(6)"sleep" job──┐        │  RECALL (gated inject) │
   │ episodic→     │                   │        │  wake + per-turn search│
   │ semantic/proc │                   │        └───────────┬────────────┘
   │ + decay/merge │                   │                    ▼
   └───────────────┘                   │              (3)  ACT  (normal turn)
                                        │                    │
                                        │                    ▼
                                 ┌──────┴───────┐   (4) OBSERVE verified outcome
                                 │  DISTILL     │◀──  auditTurnChanges / build /
                                 │  1 lesson +  │     tests / tool status / user
                                 │  outcome tag │     correction / edit-accept
                                 └──────────────┘
```

Steps: **(2) Recall → (3) Act → (4) Observe verified outcome → (5) Distill + score →
store → (6) Consolidate (sleep) → (7) Improved recall.**

## 3. Memory model (wings, rooms, by-convention entry schema)

- **Wing** = per-workspace partition (already derived from the workspace folder name,
  `mempalaceWingFor` in [mempalace.ts:27](../src/lib/mempalace.ts)). Keep as-is.
- **Rooms = memory layers** (new convention; each a distinct `--room`):

  | Room | Holds | Lifetime |
  |------|-------|----------|
  | `episodic` | raw turn digests (feedstock for consolidation) | short — pruned after consolidation |
  | `lessons` | one distilled, generalized lesson per meaningful turn | medium, reinforced |
  | `semantic` | durable **verified** facts (project/user/decisions) | long |
  | `procedural` | step recipes / heuristics (Skill-promotion candidates) | long, reinforced |
  | `antipatterns` | what failed + the corrected approach | long |
  | `preferences` | user/style prefs learned from corrections | long |

- **Entry schema by convention** — a small `@key: value` header the writer emits and the reader
  greps/parses, followed by the body:

  ```
  @type: lesson
  @sig: build/react-vite/scaffold      # task signature — the recall key
  @outcome: success                     # success | failure | mixed | unverified
  @score: 3                             # running reinforcement counter
  @uses: 5                              # times recalled & applied
  @ts: 2026-09-11T10:22:04Z
  @source: audit+build:thread_ab12
  ---
  When scaffolding a Vite+React app, create the app.html entry and vite.config
  BEFORE writing components; the dev server 404s otherwise. Verified: build passed
  after adding app.html (see turn audit).
  ```

  Parsing/formatting helpers live next to `formatSessionMemory` in
  [src/lib/mempalace.ts](../src/lib/mempalace.ts): `formatLesson(entry)`, `parseEntry(text)`,
  `bumpScore(entry)`.

## 4. The learning loop wired to REAL hooks

| Step | Where (file / function) | What happens |
|------|-------------------------|--------------|
| **Recall (session)** | `useAgentLoop` wake effect (~789) | `mempalaceWake(wing)` — unchanged, but now the palace holds distilled lessons, so the block is higher-signal. Keep it small (budget via `fitChatPayload`). |
| **Recall (per-turn, gated)** | `runCompletion` pre-turn | Compute the request's **task signature**; if it matches stored `lessons`/`antipatterns` above a threshold, `memory_search` and inject top-k. Skip entirely for trivial/chat turns (gating, §7). |
| **Act** | existing turn | normal agent turn. |
| **Observe** | post-turn finalize, where `auditTurnChanges` + the change-summary already run (~1297) | compute an **outcome score** (§5) from verified signals. |
| **Distill** | piggyback on the existing post-turn change-summary call | one cheap reflection producing **one** generalized lesson + `@outcome`. Persist only if the **verification gate** (§8) passes. |
| **Store** | `mempalaceSave` into the room for `@type` | new signature → new entry; repeat signature → **supersede** with `@score+1`, `@uses+1`. |
| **Consolidate** | idle / session-end / every N episodes (§6) | compress `episodic`→`semantic`/`procedural`, merge dupes, decay, resolve conflicts, promote to Skills. |

Nothing here blocks the user-visible response: distill/store/consolidate run **after** the turn
is streamed (fire-and-forget, like today's auto-save), so learning is off the hot path.

## 5. Outcome signal & credit assignment

Signals already available in the app, mapped to a score:

| Signal | Source | Weight |
|--------|--------|--------|
| Files changed as claimed | `auditTurnChanges` (verified change-audit) | strong + |
| Build / verify passed | `looksLikeBuildOutput`, verify steps, `/serve` logs (new) | strong + |
| Tool calls succeeded | per-tool result status | mild + |
| Edit accepted (no revert) | `autoAcceptEdits` / grok edit acceptance | mild + |
| User correction / retry / stop next turn | subsequent user message, retry, abort | strong − |

`turnScore = Σ(weights)` → classify `success | mixed | failure`.

**Credit assignment across a multi-tool turn:** attribute the score to the **strategy
signature** (the ordered *kinds* of steps taken — e.g. `explore→scaffold→write→verify`), not to
individual tokens. On success, store the winning sequence as a `procedural` memory; on
failure/correction, store the failing sequence + the fix as an `antipattern`. Because entries are
free text, the score is encoded as `@score`/`@uses` and updated by superseding the prior entry
for that `@sig`.

## 6. Consolidation & forgetting (the "sleep" job)

- **Trigger:** whichever comes first — editor idle > T, session end, or every N new `episodic`
  entries. Runs entirely in the background.
- **Compression:** read the `episodic` room, group by `@sig`, and produce a *smaller* set of
  `semantic` facts + `procedural` heuristics (one reflection call per group). Then prune the
  consumed episodic entries.
- **Conflict resolution:** newer **verified** wins; genuinely context-dependent conflicts are
  kept as two entries tagged with their conditions; the loser is tombstoned.
- **Decay without TTL:** since there's no native delete, "forget" = write a `@type: tombstone`
  entry that supersedes the target `@sig` with `@outcome: retired`, and have recall filter out
  tombstoned/`unverified`/low-`@score` entries. Consolidation periodically **rewrites a room**
  (save survivors under a fresh room, retire the old) to physically shed junk. *(If the CLI gains
  a delete verb, replace tombstones with real deletes.)*
- **Skill promotion:** a `procedural` memory with `@score ≥ P` and `@uses ≥ U` is promoted to a
  first-class Skill via `suggest_skill`, so it becomes reusable, inspectable tooling.

## 7. Retrieval / injection policy

Injecting everything wrecks latency and adds noise. Gate injection:

- **Session start:** the small `wake` block (already budgeted).
- **Per-turn:** inject only when the task signature matches stored `lessons`/`antipatterns`
  above a similarity threshold; otherwise inject nothing.
- **Ranking:** `score × recency × similarity`; take top-k (small k). Filter out
  `unverified`/tombstoned entries.
- **Budget:** reuse `fitChatPayload`'s system-prompt budgeting so memory never crowds out the
  operational nudges.

## 8. Safety — anti-hallucination & anti-poisoning

The #1 risk is **learning wrong things**. Mitigations:

- **Verification gate before persistence (default on):** a `lesson`/`semantic` fact persists
  only if the turn outcome was **verified** (audit/build/test/user-accept) — not merely asserted
  by the model. Unverified insights are stored `@outcome: unverified` and **never injected**.
- **Facts need a source:** `semantic` entries must cite a file/command output (`@source`), not a
  model claim.
- **Poisoning/drift:** the distill prompt extracts only what the evidence supports; consolidation
  resolves contradictions (newer verified wins); rooms are periodically rewritten to shed drift.
- **User controls (new settings, [storage.ts:123](../src/lib/storage.ts) neighborhood):**
  `mempalaceLearnEnabled`, `mempalaceLearnVerifiedOnly` (default true), `mempalaceConsolidateCadence`,
  plus a Memory tab view ([MemoryTab.tsx](../src/components/settings/MemoryTab.tsx)) to inspect,
  edit, and forget entries. All learning respects the existing `mempalaceEnabled` master switch.

## 9. Phased implementation plan

- **Phase 0 (today):** raw transcript save + wake recall. *(baseline)*
- **Phase 1 — MVP loop:** replace the raw-transcript auto-save with a **distilled lesson +
  outcome tag** behind the verification gate. Wire `turnScore` from `auditTurnChanges` + build.
  Rooms `lessons` + `antipatterns`. Per-turn gated recall by signature.
  *Test:* a failed→corrected build stores an `antipattern` that is recalled on the next similar
  request (extend `scripts/test-mempalace.mjs`).
- **Phase 2 — reinforcement:** `@score`/`@uses`, supersede-on-repeat, recall ranks by score.
  *Test:* repeated success raises `@score` and the entry surfaces first.
- **Phase 3 — consolidation/sleep:** idle/session-end job compresses episodic→semantic/procedural,
  decays stale, resolves conflicts (tombstone strategy).
  *Test:* N episodes collapse into fewer semantic entries; stale low-score pruned.
- **Phase 4 — skill induction:** promote high-value `procedural` memories to Skills via
  `suggest_skill`; tune the gating policy.
  *Test:* a recurring verified recipe appears in `list_skills`.

## 10. Metrics (is it actually learning?)

- **Outcome trend per `@sig`:** success rate rising over repeated encounters.
- **Correction rate falling** (fewer user corrections/retries on familiar task types).
- **Recall hit-rate:** injected memories that were actually applied that turn.
- **Injection cost:** tokens spent on memory vs. turns improved.
- **Store health:** dedup/compression ratio after consolidation; % of lessons `verified`.

## Integration points (file-level)

- [src/hooks/useAgentLoop.ts](../src/hooks/useAgentLoop.ts) — recall injection (~789/965),
  post-turn observe+distill+store at finalize (~1297, alongside `auditTurnChanges`), per-turn
  gated `memory_search`.
- [src/lib/mempalace.ts](../src/lib/mempalace.ts) — `formatLesson`, `parseEntry`, `bumpScore`,
  room constants, task-signature helper; keep `formatSessionMemory` for the episodic room.
- [src/lib/agentTools.ts](../src/lib/agentTools.ts) — memory tools already exist; the loop uses
  `memory_save`/`memory_search` internally; optionally add an internal consolidation op.
- [daemon/mempalace.js](../daemon/mempalace.js) — add a `forget`/`list` verb **iff** the CLI
  supports it (verify); otherwise the tombstone strategy needs no daemon change.
- [src/lib/storage.ts](../src/lib/storage.ts) — new learning settings + defaults.
- [src/components/settings/MemoryTab.tsx](../src/components/settings/MemoryTab.tsx) — inspect /
  edit / forget UI.
