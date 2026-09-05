# Mobile control plane (phone as judgment remote)

**One-liner:** Abliterated stays the only brain + hands on the box. The phone is a remote control for judgment (Approve / Reject / Deepen / Inject). Headless Jobs can park on a gate until that judgment arrives. The phone never opens tools, never talks to `ws://127.0.0.1:17322`, never becomes a second exec client of the bridge.

---

## 1. Split: Desktop/daemon vs Phone

| | Desktop + daemon (box) | Phone (judgment remote) |
| --- | --- | --- |
| **Role** | Brain + hands | Judgment remote |
| **Allowed** | Model calls, tool use, file/shell/MCP, Jobs lifecycle, bridge WS, gate evaluation | View job/gate state; Approve / Reject / Deepen / Inject; push/poll notifications |
| **Forbidden** | Treating phone as a second agent | Opening tools; connecting to `ws://127.0.0.1:17322`; becoming a bridge exec client; running shell/file/MCP |

Invariant: **one exec plane, one judgment channel.** The phone does not share the bridge.

---

## 2. Control plane vs exec plane

| Plane | Where | What travels |
| --- | --- | --- |
| **Exec** | Desktop/daemon on the box | Completions, tool calls, workspace I/O, MCP, Jobs runners — via the local bridge |
| **Control** | Phone ↔ control API (not the bridge) | Gate reasons, job summaries, verb payloads (approve/reject/deepen/inject), status fan-out |

Rules:

- The bridge remains localhost-only and single-purpose: local IDE ↔ daemon.
- Phone traffic never touches `:17322`.
- Gated Jobs **park** on the box; they do not migrate execution to the phone.
- Control-plane messages are small, intentional, and human-authored (or human-confirmed).

---

## 3. Job gate state machine

```
running
   │
   ▼
gated(reason)  ←── park until judgment
   │
   ├── Approve  → running
   ├── Reject   → failed | cancelled  (product choice per gate type)
   ├── Deepen   → running  (resume with deepen instruction)
   └── Inject   → running  (resume with injected context)
```

Notes:

- `gated(reason)` is a first-class Job state, not a UI spinner. Persist reason + timestamp + optional context digest.
- While gated, the runner holds the job; no tool progress, no silent timeout-as-approve.
- Timeouts (if any) must be explicit policy: `fail`, `cancel`, or stay gated — never auto-approve.
- Resume paths re-enter `running` with an auditable judgment record attached to the job.

---

## 4. Four phone verbs

| Verb | Meaning | Effect on gated Job |
| --- | --- | --- |
| **Approve** | Proceed as proposed | Clear gate → `running` |
| **Reject** | Stop this path | → `failed` or `cancelled` with reason |
| **Deepen** | Not enough — think harder / dig more | → `running` with deepen directive (passes / budget from product rules) |
| **Inject** | Here's missing context / constraint | → `running` with injected user text as control input (not a tool call from the phone) |

All four are **judgment**, not execution. The box agent interprets the verb and continues (or stops) on-box.

---

## 5. Why refusal-stripped still matters

Human gates ≠ corporate refusal.

- Abliterated / refusal-stripped models reduce **model-side** “I won’t help” dead-ends.
- Phone gates are **operator** judgment: risk, taste, scope, spend, irreversible actions.
- Mixing them is a product bug: a corporate-style model refusal is not a substitute for Approve/Reject, and a phone gate is not a content filter pretending to be safety theater.
- Keep the split sharp: the model can attempt the work; the human parks dangerous or ambiguous steps behind `gated(reason)`.

---

## 6. Anti-patterns

- Phone opens tools or shells “for convenience.”
- Phone connects to the local bridge (`ws://127.0.0.1:17322`) as a second client.
- Auto-approve on notification dismiss or push timeout.
- Treating Deepen/Inject as remote tool execution instead of control verbs.
- Shipping a second agent loop on the phone that races the desktop brain.
- Exposing the bridge beyond localhost so “the phone can reach it.”
- Collapsing human gates into model refusal / safety refusals.

---

## 7. Suggested build sequence

1. **Gate state in Jobs** — persist `gated(reason)`, UI on desktop, no phone yet.
2. **Control API surface** — authenticated, minimal: list gated jobs, post verb + payload; no tool endpoints.
3. **Phone thin client** — read gates, fire the four verbs, show reason + short digest.
4. **Push / poll** — notify on enter-gate; deep-link to the gated job.
5. **Audit trail** — every resume/stop records who/when/verb (local, no telemetry product requirement beyond local job history).
6. **Hardening** — rate limits, device pairing, revoke; still never bridge exposure.
7. **Polish** — offline queue of verbs, conflict if job left gated state, multi-job inbox.

Ship judgment first. Exec stays on the box forever.
