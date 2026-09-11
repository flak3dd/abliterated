# Chat Workflow — Full-Depth Walkthrough (corrected)

Grounded in the actual source as of 2026-09-11. Every reference below was verified
against the tree. **There is no backend chat server, no API route, and no
`EventSource`.** Abliterated is a Vite + Electron client that runs the entire agent
loop client-side and streams tokens directly from an OpenAI-compatible inference
endpoint via `fetch`. The only "server" involved is a **localhost file/exec daemon**
(`ws://127.0.0.1:17322`), which is for reading/writing workspace files and running
shell — not for chat.

> If you read the older "walkthrough" that mentions `pages/api/chat.ts`,
> `modelDispatcher.ts`, `toolRunner.ts`, `EventSource`, `listenToSSE`, or
> `enqueueChatAsJob` as the send path — none of that exists. This file replaces it.

---

## 0️⃣ Big picture

```
ChatScreen (JSX only)  ──uses──▶  useAgentLoop  ──calls──▶  streamChatCompletion (sse.ts)
   form / MessageBubble            (the whole                 fetch(<baseUrl>/chat/completions)
   ModeIndicator / chips            agent loop)               response.body.getReader() → tokens
                                        │                            │
                                        ├─ executeAgentTool ─────────┼─▶ bridge (ws://127.0.0.1:17322)
                                        │  (tool_calls)              │    read/write files, shell, git
                                        └─ runGrokLayer ─────────────┘
                                           (content-fence diffs → bridge.writeFile)
```

- **Model/endpoint selection** is settings-driven: `resolveActiveSettings`
  ([src/lib/activeEndpoint.ts:70](../src/lib/activeEndpoint.ts)) picks the provider
  (`abliteration` / `dgx-spark` / `featherless` / `platform` / `custom`) and its base
  URL, token, and model. There is no `modelDispatcher`.
- **File writes / shell / git** go through the bridge daemon
  ([src/lib/bridgeClient.ts](../src/lib/bridgeClient.ts) → `daemon/bridge.js`), not
  through the inference request.

---

## 1️⃣ UI input capture — `ChatScreen.tsx`

`ChatScreen` is **presentation only** ([src/screens/ChatScreen.tsx](../src/screens/ChatScreen.tsx), ~700 lines). All state and logic live in the `useAgentLoop` hook it calls.

| Element | What it does | Where |
|---|---|---|
| `<form onSubmit>` | Prevents default, calls `send()` | [ChatScreen.tsx:565](../src/screens/ChatScreen.tsx) |
| `useAgentLoop({...})` | Returns `messages`, `busy`, `input`, `send`, `sendText`, `stop`, … | [ChatScreen.tsx:332](../src/screens/ChatScreen.tsx) |
| `useImperativeHandle` | Exposes `stop`/`retry`/`continueAfterTool`/`fillInput` as `ChatScreenHandle` | [ChatScreen.tsx:349](../src/screens/ChatScreen.tsx) |
| `MessageBubble` | Renders each message (markdown, reasoning, tool result, diffs, change summary) | [ChatScreen.tsx:499](../src/screens/ChatScreen.tsx) |
| `AgentStatusMonitor` | Live phase/turn/elapsed while `busy` | [ChatScreen.tsx:573](../src/screens/ChatScreen.tsx) |
| `ModeIndicator` | Collapsed strip for Agent/Ask/Plan/Debug + plan checklist + approve/cancel | [ChatScreen.tsx:148](../src/screens/ChatScreen.tsx) |
| `QuickChipsToggle` | ⚡ button that reveals the `QuickChips` row | [ChatScreen.tsx:99](../src/screens/ChatScreen.tsx) |

The **"Job" button** is separate: it calls `enqueueChatAsJob`
([ChatScreen.tsx:684](../src/screens/ChatScreen.tsx)) to run a prompt as a background
Job. This is **not** the normal send path.

---

## 2️⃣ The core loop — `useAgentLoop.ts`

Everything below lives in [src/hooks/useAgentLoop.ts](../src/hooks/useAgentLoop.ts).

| Function | Line | Role |
|---|---|---|
| `useAgentLoop({...})` | 413 | Owns all state/refs; returns the API ChatScreen renders |
| `sendText(text)` | 2379 | Validates workspace, persists the user message; if `busy`, queues a mid-run barge-in; else `await runCompletion(history)` |
| `send()` | 2433 | `sendText(input)` |
| `runCompletion(history)` | 1302 | The turn loop (see §3) |
| `runGrokLayer(msg)` | 1016 | Parse path-headed fences/diffs from content → apply to workspace |
| `executeTool(tool)` | 1099 | Run one tool call via `executeAgentTool` |
| `finalizeAssistant()` | 1633 | Coalesce/guard reasoning, lift code out of thought, apply grok, paint workflow |

Key state (all in the hook): `messages` (+ `messagesRef` for stale-closure-free reads),
`busy`, `loopTurn`/`maxTurns`, `agentPhase`/`phaseMeta`, `planChecklist`, `agentProfile`,
`effectiveTools`. Streaming callbacks use eagerly-updated refs (`loopTurnRef`,
`queuedMidRunRef`, `agentPhaseRef`) to stay correct mid-turn.

---

## 3️⃣ One turn — `runCompletion` ([useAgentLoop.ts:1302](../src/hooks/useAgentLoop.ts))

1. Set `busy`, `loopTurn=1`, phase `starting`; create an `AbortController` (used by `stop()`).
2. Optionally **prefetch** pinned/mentioned workspace files (`prefetchWorkspaceFiles`, raced against abort).
3. For each turn up to `maxTurns`:
   - Build the API messages with `toApiMessages` (assembles the system prompt via
     `assembleSystemPrompt` — steering directives first, bulk context last, budget-pruned).
    - Call **`streamChatCompletion`** ([useAgentLoop.ts](../src/hooks/useAgentLoop.ts)) with
      callbacks: `onDelta` (content), `onReasoningDelta` (thinking),
      `onToolCallDelta` (switches phase to `tool_plan` immediately on tool tokens),
      and the abort signal.
   - `finalizeAssistant()` runs the content transforms and the grok layer.
   - **No tool calls** → the decision cascade decides finish vs. self-deepen (see §6).
   - **Tool calls** → split into parallel (safe) vs. gated (git/shell/verify/create_pr),
     execute via `executeTool` (each raced against abort), persist results, continue.
4. `finally`: clear the abort ref, set the end phase, `busy=false`, record the run, drain
   any queued mid-run notes, compute the run proof/idle monitor.

`stop()` calls `abortRef.current?.abort()`. Because bridge RPCs carry no signal, in-flight
tool/prefetch awaits are wrapped in `raceAbort` ([src/lib/raceAbort.ts](../src/lib/raceAbort.ts))
so the loop stops waiting immediately.

---

## 4️⃣ Streaming — `streamChatCompletion` ([sse.ts:675](../src/lib/sse.ts))

This is the real "SSE" — a `fetch` with a streamed body reader, **not** `EventSource`.

1. `resolveActiveSettings(settings)` ([sse.ts:699](../src/lib/sse.ts)) → provider, base URL, token, model.
2. `endpointUrl(..., '/chat/completions')` ([sse.ts:715](../src/lib/sse.ts)) builds the URL
   (DEV rewrites cloud/Spark/Featherless hosts through Vite proxies to dodge CORS).
3. **Offline / no-endpoint fallback**: `dummyEcho` ([sse.ts:91](../src/lib/sse.ts)) streams
   `[Local Dummy] Echo: …` so the loop is exercisable without a live model.
4. `POST` the OpenAI-compatible body (`model`, `messages`, `stream:true`, `tools`,
   `chat_template_kwargs` for Qwen-class thinking models, `reasoning_effort` for Spark
   GPT-OSS, sampling params).
5. **Read the stream**: `response.body.getReader()` + `TextDecoder`
   ([sse.ts:1088](../src/lib/sse.ts)); split on `data:` lines; each JSON chunk goes to
   **`applyCompletionChunk`** ([sse.ts:1117](../src/lib/sse.ts) → [sseParse.ts:240](../src/lib/sseParse.ts)),
   which normalizes provider field aliases (`content`/`delta`/`message`,
   `reasoning_content`/`reasoning`/`thinking`, `tool_calls`) and invokes the handlers.
6. Robustness: context-window fit (`fitChatPayload`), 400/invalid-request retries that
   strip `chat_template_kwargs`/tools, token-collapse detection, and a cloud fallback URL.

**Model selection lives in settings**, resolved per request — not in a dispatcher module.
"Claude" is not a served model here; providers are OpenAI-compatible endpoints.

---

## 5️⃣ Tools & file edits (client-side)

Two channels, both applied by the client:

- **API tool calls** — the model returns OpenAI `tool_calls`; each runs through
  `executeAgentTool` ([src/lib/agentTools.ts:200](../src/lib/agentTools.ts)). File-touching
  tools (`write_file`, `apply_patch`, shell, git, verify…) hit the **bridge daemon**;
  writes are **pinned to the thread workspace root** (`{ root }`) so a drifted daemon root
  can't misroute them.
- **Grok layer (content fences)** — for models with weak tool-calling, the client parses
  ` ```diff ` / `// relative/path` fences from the message content and applies them
  (`runGrokLayer` → `applyGrokEdits` → `bridge.writeFile`). Fences already covered by a
  `write_file` tool call this turn are de-duped so nothing double-writes.

There is **no** `toolRunner.ts` and **no** `src/lib/tools/` registry; the switch lives in
`executeAgentTool`.

---

## 6️⃣ Plans, workflow, and self-correction (all client-side)

- **Plan / Edit / Check / Done workflow** is built from the user prompt and synced from the
  run: `buildTurnPlan` ([turnWorkflow.ts:93](../src/lib/turnWorkflow.ts)) +
  `syncStepsFromRun` ([turnWorkflow.ts:247](../src/lib/turnWorkflow.ts)), painted onto the
  host message (`paintWorkflow`). There are **no** `planItem` stream events; plans come from
  parsing the model's own content (`parseTodoItems`).
- **Modes**: `AgentMode = 'agent' | 'ask' | 'plan' | 'debug'` gates the tool set
  (`ASK_MODE_TOOLS`, `PLAN_MODE_TOOLS`, `DEBUG_MODE_TOOLS` in `src/types`). Plan mode is
  read-only until Approve.
- **Completion footer + change audit**: on file-modifying turns the model must emit a
  `Done / Changes / Verified / Continue` footer; `auditTurnChanges`
  ([src/lib/changeAudit.ts](../src/lib/changeAudit.ts), invoked at
  [useAgentLoop.ts:1352](../src/hooks/useAgentLoop.ts)) checks it and can nudge for a
  verified summary.
- **Reasoning-execution gate**: if reasoning maps ≥2 file steps the content didn't execute,
  `reasoningStepsNotExecuted` ([src/lib/reasoningWork.ts](../src/lib/reasoningWork.ts),
  [useAgentLoop.ts:1845](../src/hooks/useAgentLoop.ts)) injects a one-shot nudge to actually
  perform them.
- **Reasoning coalescing & Thought display**: when models emit pure reasoning with empty content,
  `finalizeReasoningChannel` promotes reasoning into `content`. `MessageBubble.tsx` preserves
  the text in `displayContent` with `hasAnswer=true` and suppresses the duplicate Thought
  accordion so the answer is never hidden.
- Other gates in the no-tools cascade: fake-tool recovery, build todo/implement/verify
  nudges, self-deepen, prove-improve, MCP/skill follow-ups.

---

## 7️⃣ Error handling & abort

- **Abort** (`stop()` / Esc): aborts the fetch; partial content is preserved, phase → `stopped`.
- **Provider error inside HTTP 200**: `completionChunkError` surfaces it.
- **Network / 4xx**: retried (context-fit, strip-kwargs, cloud fallback) then shown as an error message.
- **Bridge down**: file tools return a clear error; writes are gated by `shouldWriteWorkspaceFiles`.

---

## 8️⃣ Verify

```bash
npx tsc -b            # type-check / project build (build mode; not --noEmit)
npm test              # unit + daemon integration suite
npm run dev           # Vite dev server (http://localhost:5173)
```

The offline `dummyEcho` path lets you exercise the full loop (streaming, finalize, grok,
persist, phases) without a live model.

---

## 📂 Real file map

| File | What you'll find |
|---|---|
| [src/screens/ChatScreen.tsx](../src/screens/ChatScreen.tsx) | Form, message list, `ModeIndicator`, `QuickChipsToggle`, `useAgentLoop` wiring (JSX only) |
| [src/hooks/useAgentLoop.ts](../src/hooks/useAgentLoop.ts) | The whole agent loop: `sendText`, `runCompletion`, `finalizeAssistant`, `executeTool`, `runGrokLayer`, `toApiMessages` |
| [src/lib/sse.ts](../src/lib/sse.ts) | `streamChatCompletion` — fetch + stream reader; endpoint URL; retries; `dummyEcho` |
| [src/lib/sseParse.ts](../src/lib/sseParse.ts) | `applyCompletionChunk`, provider field aliases, thinking-model detection |
| [src/lib/activeEndpoint.ts](../src/lib/activeEndpoint.ts) | `resolveActiveSettings` — provider/model/base-URL/token |
| [src/lib/agentTools.ts](../src/lib/agentTools.ts) | `executeAgentTool` — the tool switch (bridge-backed) |
| [src/lib/grokLayer.ts](../src/lib/grokLayer.ts) | Parse + apply content-fence diffs |
| [src/lib/turnWorkflow.ts](../src/lib/turnWorkflow.ts) | Plan/Edit/Check/Done workflow model |
| [src/lib/bridgeClient.ts](../src/lib/bridgeClient.ts) → `daemon/bridge.js` | Localhost file/shell/git daemon (ws://127.0.0.1:17322) |
| [src/components/chat/MessageBubble.tsx](../src/components/chat/MessageBubble.tsx) | Message rendering (markdown, reasoning, diffs, change summary) |

## TL;DR

1. `<form>` → `send()` → `sendText()` (in `useAgentLoop`) — **no job, no server**.
2. `runCompletion()` runs the turn loop and calls `streamChatCompletion()`.
3. `streamChatCompletion` `fetch`es `<baseUrl>/chat/completions` and reads
   `response.body.getReader()`, feeding chunks to `applyCompletionChunk`.
4. Content streams via `onDelta`; reasoning via `onReasoningDelta`; tools via `tool_calls`
   → `executeAgentTool`; content-fence diffs → `runGrokLayer` → bridge `write_file`.
5. Plans/workflow/footers are computed **client-side**; the no-tools cascade decides
   finish vs. self-correct.
6. `finalizeAssistant` + the `finally` block settle the turn (phase, `busy=false`, run record).
