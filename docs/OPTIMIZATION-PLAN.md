# Abliterated IDE — Optimization Plan

Grounded in measurements (2026-09-11) plus a 6-dimension parallel audit that verified every
item against the live tree. Ordered by value-to-risk. **Nothing here is implemented yet.**

**Measured baseline**
- `src/hooks/useAgentLoop.ts` — 2,609 LOC. Per turn: `toApiMessages` re-assembles the full system prompt; `auditTurnChanges` runs 3–5×; the no-tools cascade recomputes pure predicates on unchanged content (`isAnswerCompleteMarker` ×12, `shouldSkipSelfDeepen` ×6, `looksLikeBuildOutput` ×3); tool-evidence join rebuilt ~4×; `extractLockedGoal`/`lastOperatorPrompt` scan the whole list 2–3×.
- `MessageBubble` is `React.memo`'d — but the memo is **defeated** by 3 unstable inline callbacks passed from `ChatScreen`.
- `src/lib/systemPrompt.ts` — active prompt built by chaining ~43 `PREVIOUS_SYSTEM_PROMPT_V*` strings. **These are load-bearing** (`storage.ts:265` `LEGACY_PROMPTS.includes(stored)` auto-upgrades stale persisted prompts) — do **not** delete/hash them.
- `npm test` — 35 serial steps; **38** test scripts spawn `tsc` **without `--skipLibCheck`**.
- `fitChatPayload` re-estimates tokens each fit attempt → effectively O(n²).

> Corrections from my first draft: (1) `buildCapabilityPlan` is **already** deduped by `capabilityCache` (useAgentLoop.ts:837-859) — the residual is only a cache key that ignores the query text + a per-turn MCP-list rebuild; (2) the legacy prompt constants are **not** safe to delete/flatten (migration match).

---

## Quick wins (S effort, high value, low risk)

### Q1. Restore the `MessageBubble` memo — `useCallback` the inline handlers ★ biggest render win
`ChatScreen` passes 3 fresh closures (`onApprovePlan`, `onDeclinePlan`, `onOpenFile`) to every `MessageBubble` each render, defeating the `React.memo`, so **every** bubble re-renders on **every** token. Wrap them in `useCallback` (or lift beside the other handlers in `useAgentLoop`). — `src/screens/ChatScreen.tsx:516-526`.

### Q2. Add `--skipLibCheck` to the 38 test scripts ★ biggest dev-loop/CI win
Each test spawns a cold `tsc` that type-checks `@types` too. Append `--skipLibCheck` to the `execFileSync` tsc args (`grep -L skipLibCheck scripts/test-*.mjs` lists them). Fully isolated from app code. — `scripts/test-*.mjs`.

### Q3. Hoist the repeated pure predicates in the no-tools cascade
At the top of `if (!toolCalls.length)` compute once: `answerComplete`, `junkTurn`, `buildOutput`, `todos`, `toolEvidence`; replace all inline calls. Pure functions of unchanged content → no behavior change. — `useAgentLoop.ts:1657-2103`.

### Q4. Cut redundant `auditTurnChanges` passes
Skip it on the empty seed paint (host.content empty, no new writes); in the changeVerify branch reuse the `ChangeAuditResult` the preceding `paintWorkflow` already produced instead of recomputing. Keep the post-content/post-tool paints. — `useAgentLoop.ts:1352,1529,2065-2094`; `src/lib/changeAudit.ts:136-178`.

### Q5. Compute `lockedGoal` / `operatorPrompt` / `toolEvidence` once per turn
Hoist to the top of each turn iteration; pass into `toApiMessages` + `paintWorkflow`; keep the `lastUser?.content` fallback. Refresh `toolEvidence` after tools run. — `useAgentLoop.ts:896,912,1329-1332,1535,1797,1887,1997,2316`; `harnessGates.ts:45-65`.

### Q6. Stop persisting tool results twice
Strip `toolCall.result` on `role==='tool'` rows before `saveMessage` (content is canonical) — halves stored bytes for tool-heavy threads. — `storage.ts` saveMessage; `useAgentLoop.ts:1087-1096`; `agentTools.ts:133-145`.

### Q7. Use `messagesRef.current` instead of `getMessages(thread.id)` inside the turn loop
Replace in-loop `getMessages` (JSON parse of localStorage) with the ref; reserve `getMessages` for the initial thread-switch load. — `useAgentLoop.ts:1282,1412,2139,2311,2316`.

### Q8. Delete dead code + dedup `THINKING_MODEL_RE`
Remove `reasoningLooksLikeStalledWork` / `buildReasoningOnlyNudge` (`reasoningWork.ts:115,205`, only used by a test) and the duplicated `THINKING_MODEL_RE` (import from `sseParse.ts:24` into `modelSettingsGuide.ts:4,69`). Drop the dead `sse.ts:815` `body.messages` assignment. — plus fix the `capabilityCache` key (add a query hash) and memoize the connected-MCP→OpenAI array per run.

### Q9. (Optional) Lazy-load non-default screens
`ImagesScreen` (2,459 LOC), `ApiScreen`, `SettingsScreen`, `VllmScreen`, `WorkspaceScreen`, `ModelsScreen`, `JobsScreen` are statically imported but the app opens on Chat. `React.lazy` + `<Suspense>`; `App.tsx` already gates on `visitedTabs`. — `src/App.tsx:39-46`.

---

## Medium (M effort)

### M1. Memoize the run-invariant system-prompt blocks in `toApiMessages`
`useMemo` the run-invariant head/tail block array (keyed on agent mode, `agentProfile`, write root, tools-off, project-memory/skills/workspace-skills/mempalace/task-graph blocks, base system prompt); compute only the small dynamic middle (locked-goal block, build/large nudges tied to the latest user msg, `capPlan.systemBlock`) per turn. **Preserve exact block order + essential flags** (they drive `fitChatPayload` tail-clipping). — `useAgentLoop.ts:861-951`.

### M2. Make `fitChatPayload` O(n) instead of O(n²)
Precompute `msgs.map(estimateMessageTokens)` once; keep a running sum, subtract on `movable.shift()`, re-estimate a single entry only when its content is clipped. Bit-identical result. — `contextWindow.ts:154-224`; `sse.ts:868,889`.

### M3. In-memory parsed-messages cache + cap stored tool-result size
Module-level parsed-array cache in `storage.ts` (lazy hydrate, updated on write, invalidated on wipe/replace/storage events); separately cap stored tool-result at persistence time (head+tail with a truncation note). — `storage.ts:485-502`; `useAgentLoop.ts:1087-1096`.

### M4. Debounce the IndexedDB mirror separately from localStorage
Coalesce the IDB mirror for bulky keys to ~every few seconds + on turn end/visibilitychange; keep localStorage as the synchronous hot cache. Durability preserved. — `storage.ts:203-211`; `durableStore.ts:51-112`.

### M5. Memoize daemon write-root & `.venv` validation with a short TTL
Cache the validated `realpath` per normalized root (3–5s TTL) and `.venv`-bin existence per execCwd; **keep the pure-string `assertNotAppInstall()` guard uncached** (run every call — a symlink swap in the window is a real security regression). — `daemon/bridge.js:203,242,269,452,490`.

### M6. Shared `compileLib.mjs` helper + parallelize independent unit tests
One place for tsc flags/caching; run the pure unit tests via a small Promise-pool (exclude the network/daemon tests, which stay serial). — `package.json`; new `scripts/compileLib.mjs`.

---

## Larger (do LAST, behind added test coverage)

### L1. Refactor the no-tools branch into a data-driven nudge cascade
Ordered array of `{ guard(ctx), build(ctx), onceFlag }` evaluated against one precomputed `ctx` — makes Q3's hoisting natural and the cascade unit-testable. Add before/after nudge-order tests first. — `useAgentLoop.ts:1657-2103`.

### L2. Shard message persistence per thread
Per-thread keys (`ablit_messages::<threadId>`) + a light thread index, so a write is O(one thread) not O(all messages); coalesce the ~18 boundary flushes into the debounce, forcing a synchronous write only at true turn end/abort. — `storage.ts:485-502`.

---

## Recommended sequence
1. **Q1** — `MessageBubble` `useCallback` (trivial, biggest render win).
2. **Q2** — `--skipLibCheck` across the 38 test scripts (fastest feedback-loop win, isolated).
3. **Q3–Q5** as one cluster — agent-loop hot-path pure-function memoization (no behavior change).
4. **Q6–Q7** — persistence quick wins.
5. **Q8 (+Q9)** — dead-code/dedup + optional lazy screens.
6. **M1 → M2 → M3 → M4 → M5 → M6** in that impact order.
7. **L1 then L2** last, each behind new tests.

## Do NOT do
- **Don't** delete/flatten/hash the `PREVIOUS_SYSTEM_PROMPT_V*` / `LEGACY_PROMPTS` constants — they auto-upgrade stale stored prompts via exact-string match (`storage.ts:265`). At most prune the very oldest (V3–V10) as a deliberate migration.
- **Don't** virtualize the transcript — `MESSAGE_WINDOW` (80) already caps it, and Q1 restores the memo so only the streaming bubble re-renders.
- **Don't** rewrite `useAgentLoop` as a state machine mid-development — the refs-ahead-of-`setState` pattern is deliberate for streaming callbacks; L1 is the only structural change worth doing, and only behind tests.
- **Don't** cache daemon root validation without a TTL or with `assertNotAppInstall()` cached — symlink/venv swap in the window is a security regression.
- **Don't** remove the post-fit `sanitizeOpenAiMessages` pass in `sse.ts:876` (only the dead `:815` assignment) — it's defensive.
- **Don't** coalesce all 18 `flushStreamPersist` writes into the debounce — keep a synchronous write at true turn end/abort so a crash can't lose a completed message.
- **Don't** optimize streaming markdown/highlight per-token — highlight is already gated off while streaming (`MessageBubble.tsx:339-341,503`); and the elapsed ticker is already isolated (`AgentStatusMonitor.tsx:44-54`).

---

*Sourced from directly-verified measurements + the `abliterated-optimization-audit` workflow (7 agents, 6 dimensions). Full per-dimension findings are in the workflow transcript.*
