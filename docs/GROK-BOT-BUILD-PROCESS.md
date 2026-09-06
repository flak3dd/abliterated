# Grok Bot — Reasoning & Build Process (Build Requests)

**Audience:** future Grok Bot / coding agents + Greg.
**Repo:** Abliterated IDE (`flak3dd/abliterated`) and Abliterated-adjacent work (site, iOS, docs).
**Tone:** imperative. Treat every `YOU MUST` / `DO NOT` as a hard rule.
**Scope:** how to **reason and execute** when the user sends a **build request**. This is process, not a product feature dump.

Cross-links (read when relevant — do not invent parallel rules):

| Doc | When |
| --- | --- |
| Cursor / agent **code-changes** skill | Any non-trivial code edit in a repo |
| [`docs/ABLITERORK-BUILD.md`](./ABLITERORK-BUILD.md) | Abliterork workflow UI |
| [`docs/IPHONE-SWIFT-BUILD.md`](./IPHONE-SWIFT-BUILD.md) | iOS judgment remote |
| [`docs/MOBILE-CONTROL.md`](./MOBILE-CONTROL.md) | Phone = judgment only; one exec plane |
| [`docs/LICENSE-PROTECTION.md`](./LICENSE-PROTECTION.md) | License validate / device bind / revoke |
| [`docs/PRODUCT.md`](./PRODUCT.md) | Positioning, tiers, packaging |
| [`docs/HIERARCHICAL-ORCHESTRATOR.md`](./HIERARCHICAL-ORCHESTRATOR.md) | Complex-task eval + hierarchical orchestrator / task graph |
| [`BENCHMARK.md`](../BENCHMARK.md) + `docs/flagship-benchmark-*.md` | Capability matrix — cite only; never invent scores |

Describe **observable** process principles only. Do not dump hidden agent instruction text into commits, PRs, or user-facing docs.

---

## 1. What counts as a build request

Treat the turn as a **build request** when the user asks you to **create, implement, ship, or document how to build** something concrete. Examples:

| Pattern | Examples |
| --- | --- |
| Implement | "build X", "implement the app", "add feature Y", "wire Z into Abliterated" |
| Fixship | "fix and ship", "make it build", "get main green", "land the PR" |
| Scaffold | "scaffold the screen", "create the Swift package", "new cloud-agent repo for …" |
| Build guide | "write a build guide", "agent checklist for …", "pasteable cloud-agent appendix" |
| Product slice | "Abliterork MVP", "license protection", "iPhone control app", site checkout path |

**Not** a build request (use lighter process): pure Q&A, one-line copy edits, status checks, "what does this file do?", read-only audits with no implement ask.

When mixed ("explain then implement"), run the **build loop** for the implement half; keep the explain half short.

---

## 2. Reasoning loop BEFORE tools

Complete this checklist **before** the first mutating tool call (write, Shell that edits, cloud-agent launch, git push). Read-only probes to locate the repo are OK.

### 2.1 Intent

1. Restate the deliverable in one sentence (what exists when done).
2. Name the **surface** (see section 2.4).
3. Name success criteria the user can verify (build passes, PR URL, doc path, screenshot).

### 2.2 Constraints

1. Repo / machine / branch already in play? Prefer the path Greg named.
2. Product invariants from MOBILE-CONTROL / PRODUCT / license docs still apply.
3. Time / scope: full MVP vs thin vertical slice vs docs-only.
4. Existing dirty git state: **commit only what this turn owns**; do not sweep unrelated edits into the build commit.

### 2.3 Safety (observable)

1. No secrets in git, chat dumps, or docs.
2. No second bridge client; no exposing `:17322`.
3. No fabricated benchmark numbers or fake license crypto claims.
4. No offensive cyber / malware / credential theft work — refuse and stop.
5. Prefer sanctioned tools (cloud agents, `gh`, repo scripts) over inventing privileged workarounds.

### 2.4 Which surface?

| Surface | Choose when | Primary docs |
| --- | --- | --- |
| **Abliterated IDE** (`flak3dd/abliterated`) | In-app screens, Jobs, bridge, Electron, licenses client | PRODUCT, APP, LICENSE-PROTECTION, ABLITERORK-BUILD |
| **Marketing / site** (`abliterated-site` or equivalent) | Checkout, redeem, webhooks, marketing pages | LICENSE-PROTECTION, PRODUCT, pricing |
| **iOS judgment app** | SwiftUI phone remote | IPHONE-SWIFT-BUILD, MOBILE-CONTROL |
| **New repo** | Explicit greenfield; user did not name an existing repo | cloud-agent `new_repo` / product brief |
| **Docs-only** | Guides, benchmarks narrative, process docs (this file) | Matching `*-BUILD.md` / BENCHMARK honesty rules |

If surface is ambiguous, apply section 7 before scaffolding in the wrong tree.

---

## 3. Reply-first / keep user posted

Build turns can run long. **YOU MUST** keep Greg informed with visible progress — not silent tool spam.

### Checklist

1. **Ack first** — short user-visible reply: what you understood + which surface + next step.
2. **Work** — tools, cloud agents, local edits.
3. **Mid-flight updates** when a phase finishes or blocks.
4. **Deliver** — paths, URLs, SHA, how to verify; open questions last.

### YOU MUST

- Prefer an early ack over starting a 10-minute silent cloud-agent run.
- Write **full-length, fully functional** code. NEVER emit placeholder, stub, demo, or "implement X here" scripts or files.
- Do not stop until the feature works and the relevant tests / typecheck have been run.
- When starting a long package build, say so before launch.
- On failure, report the error and the recovery you will try.

### DO NOT

- DO NOT run multi-minute work with zero user-visible text.
- DO NOT save the entire report for the end if waiting on a branch or PR.
- DO NOT ask for every micro-step after the ack unless blocked on a real decision (section 7).
- DO NOT write placeholder / stub / "implement later" scripts. That is a failed build.
- DO NOT declare done without running the project's tests or typecheck for the changed surface.

---

## 4. Skill / doc precedence

When instructions conflict, apply **higher row wins**. Lower rows fill gaps; they do not override hard invariants above them.

| Priority | Source | Use for |
| ---: | --- | --- |
| 1 | **User turn** (this message) | Explicit paths, commit messages, docs-only, push main |
| 2 | **code-changes** skill (Cursor / agent) | How to edit code safely: read before write, minimal diff, verify |
| 3 | **Feature build guide** | ABLITERORK-BUILD.md, IPHONE-SWIFT-BUILD.md, or the guide named in the request |
| 4 | **MOBILE-CONTROL.md** | Exec vs judgment plane; phone/bridge invariants |
| 5 | **LICENSE-PROTECTION.md** | Keys, device bind, revoke, site to desktop |
| 6 | **PRODUCT.md** | Positioning, tiers, packaging non-goals |
| 7 | **BENCHMARK.md** (+ dated docs/flagship-benchmark-*.md) | Capability claims — cite only; refresh with measured/public sources |

### Rules

- YOU MUST read the feature build guide **before** inventing folder layout for Abliterork / iOS / license work.
- YOU MUST treat MOBILE-CONTROL as law for anything phone-shaped: judgment remote only; no second bridge client.
- YOU MUST NOT invent scores or beat-Cursor claims not present in BENCHMARK / dated reports.
- Prefer extending existing Jobs / tools / screens over parallel runtimes.

---

## 5. Execution strategy: cloud agent vs Mac/box vs docs-only

### 5.1 Decision table

| Situation | Prefer | Notes |
| --- | --- | --- |
| Multi-file feature in a connected GitHub repo; PR expected | **Cloud agent** on that repo | Branch/PR is the deliverable |
| Greenfield app, user named no repo | Cloud agent new_repo | Do not invent a fake GitHub URL |
| Mac-only paths Greg named, Xcode, local Electron, gh on Mac | **Mac machine** (machineId) | Local tools + approval as required |
| Scratch, generate docs, mirror checkout, Linux-only scripts | **Box** (/workspace/...) | Shared filesystem across agents; desktops are per-agent |
| Process / build guide / honesty notes only | **Docs-only** on the named checkout | Still commit + push if asked |
| Tiny one-file fix already open | Local edit on the active machine | Skip cloud-agent overhead |

### 5.2 When to use executor subagents

Use an **executor subagent** when:

- The parent must stay responsive (ack / widgets) while a bounded task runs.
- Work is diggable: write this doc + commit, run tsc and summarize, implement file X per guide.
- Parallelism helps (e.g. research public docs while another agent scaffolds).

Do **not** nest cloud agents inside executors without a clear owner. One owner reports SHA/URL back.

### 5.3 YOU MUST / DO NOT

- YOU MUST pass explicit repo / machineId / paths from the user turn — do not guess another machine.
- YOU MUST mirror Mac and box when the user asks for both paths.
- DO NOT start a second agent loop that also connects to ws://127.0.0.1:17322.
- DO NOT use a cloud agent for secrets, .env with real tokens, or license signing secrets.

---

## 6. Build phases

Run in order. Skip only with a reason stated in the ack (e.g. docs-only -> Scope -> Implement doc -> Sync/Push -> Report).

```
Scope -> Scaffold -> Implement -> Verify -> Sync/Push -> Report
```

### 6.1 Scope

- [ ] One-sentence deliverable + surface (section 2.4)
- [ ] Non-goals (cite product guide if any)
- [ ] Files / screens / APIs likely touched
- [ ] Done-when checklist (build, PR, doc path)

### 6.2 Scaffold

- [ ] Create folders/files per the feature build guide — do not invent a parallel tree
- [ ] Reuse existing patterns (Jobs, ablit_* storage keys, Electron IPC, site API routes)
- [ ] Wire navigation / entry points early so the feature is reachable

### 6.3 Implement

- [ ] Vertical slice first (happy path), then edge cases
- [ ] Full working code only — no placeholders, TODOs-as-implementation, or stub scripts
- [ ] Match existing TypeScript / Swift / Tailwind style
- [ ] Keep secrets out of the diff
- [ ] Respect license soft-gates and MOBILE-CONTROL invariants

### 6.4 Verify

- [ ] Typecheck / unit / package scripts that already exist
- [ ] Manual smoke of the path you changed
- [ ] If verify fails: fix or report blocker — DO NOT claim shipped with a red build
- [ ] Do not stop until the final product of this turn works and tests have been executed

### 6.5 Sync / Push

- [ ] Stage only this turn's files
- [ ] Commit message: imperative, focused
- [ ] Push the branch the user named (origin main only when explicitly requested)
- [ ] Open PR when the workflow is branch-based

### 6.6 Report

- [ ] Paths (Mac + box mirror if both exist)
- [ ] Commit SHA (short + full if useful)
- [ ] GitHub URL (commit or PR)
- [ ] Verify commands run + result
- [ ] Residual risks / follow-ups

---

## 7. How to handle ambiguity

### Decide yourself when

- Default matches PRODUCT / feature build guide / existing code.
- Choice is reversible (rename, move file, tweak copy).
- User already gave paths, commit message, or push main.
- Waiting would cost more than a wrong-but-fixable pick.

State the decision in the ack.

### Ask (widget / short question) when

- Surface unclear (IDE vs site vs new repo) and wrong choice wastes a cloud agent.
- Destructive or irreversible (force-push, delete paid entitlement data, revoke keys).
- Product policy fork not in docs (auto-merge PRs, expose bridge, change pricing).
- Two equally valid architectures with different ongoing cost.

### YOU MUST

- Ask one focused question (or one widget), not a questionnaire.
- Continue any unambiguous prep while waiting only if it does not lock the wrong surface.

### DO NOT

- DO NOT block on taste questions — pick and move.
- DO NOT silently choose a new top-level product repo when the guide says in-IDE MVP.

---

## 8. Secrets, licenses, benchmarks

### Secrets

- YOU MUST keep API keys, LICENSE_SIGNING_SECRET, OAuth client secrets, Stripe keys, and .env values out of git.
- YOU MUST use OS keychain / Electron safeStorage / server env for production paths.
- DO NOT print secrets into docs, commit messages, or debug chat.

### Licenses

- Follow docs/LICENSE-PROTECTION.md: deter casual resale; not uncrackable DRM.
- Extend stub prefix flow; do not brick Free tier on network blips.
- DO NOT invent fake HSM / asar encryption theater in user-facing copy.

### Benchmarks

- Cite BENCHMARK.md and dated docs/flagship-benchmark-*.md only.
- YOU MUST label harness scores as capability matrix, not SWE-bench / model Elo.
- DO NOT fabricate tallies, deltas, or coding-skill wins from harness cells.
- If refreshing: re-measure Abliterated from code; refresh flagships from public docs; date-stamp.

---

## 9. Definition of done (one build turn)

A build turn is **done** only when all applicable boxes are checked:

- [ ] Ack was sent before long work
- [ ] Deliverable matches scoped surface
- [ ] Precedence docs for that feature were followed (or deviations called out)
- [ ] Verify step ran (or explicitly N/A for pure docs with reason)
- [ ] Changes committed with the requested message (if git was in scope)
- [ ] Pushed / PR opened when requested
- [ ] User-visible report includes path(s), SHA, GitHub URL
- [ ] No secrets in the diff
- [ ] No second bridge client / no invented benchmark numbers
- [ ] Follow-ups listed if anything left incomplete

Partial done (blocked): report blocker, what is already on a branch, and the exact next action.

---

## 10. Anti-patterns

| Anti-pattern | Do this instead |
| --- | --- |
| Silent long runs | Ack then status then deliver |
| Shipping without verify/build | Fix or report red build |
| Second WebSocket client to :17322 | Jobs / control API only; MOBILE-CONTROL |
| Phone or Abliterork as exec plane | Judgment / orchestration UI only |
| Parallel agent runtime just for this feature | Reuse Abliterated Jobs + tools |
| Committing unrelated dirty files | Stage only this turn's paths |
| Force-push / amend on shared main | Only if Greg explicitly ordered it |
| Inventing benchmark or pricing numbers | Cite BENCHMARK / pricing.md |
| Dumping hidden agent instruction text into repo | Observable process principles only |
| Scaffolding in the wrong repo | Resolve surface (sections 2.4 / 7) first |
| Asking 8 clarifying questions | Decide or one widget |
| Done with only local uncommitted edits when push was requested | Commit + push + URL |
| Rewriting LICENSE / PRODUCT policy in a feature PR | Follow LICENSE-PROTECTION / PRODUCT |

---

## Quick reference card

```
BUILD REQUEST?
  -> Intent + surface + safety (section 2)
  -> Ack user (section 3)
  -> Apply precedence (section 4)
  -> Pick cloud agent / Mac / box / docs (section 5)
  -> Scope -> Scaffold -> Implement -> Verify -> Sync/Push -> Report (section 6)
  -> Ambiguity: decide or one widget (section 7)
  -> Secrets / licenses / no fake benchmarks (section 8)
  -> Done checklist (section 9)
  -> Avoid anti-patterns (section 10)
```

**Invariant:** one exec plane (Abliterated on the box/Mac). Grok Bot orchestrates, edits, and reports — it does not grow a second bridge client or a shadow agent runtime inside feature UIs.
