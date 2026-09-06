# Grok CLI — reasoning and build process

**Audience:** a Grok CLI / terminal coding agent (xAI `grok` CLI style **or** Abliterated agent driven from CLI / Jobs) with local tools, plan mode, and shell.
**Repo context:** Abliterated IDE (`flak3dd/abliterated`) and any user workspace that agent is pointed at.
**Tone:** imperative. Treat every `YOU MUST` / `DO NOT` as a hard rule.
**Scope:** observable process only — how to reason and execute on a **build request**. Do not dump hidden system prompts.

**Related:** [GROK-BOT-BUILD-PROCESS.md](./GROK-BOT-BUILD-PROCESS.md) (Bot = desktop assistant UI / chat chrome). This doc = **CLI / terminal / agent-loop** path. Parallel optional Grok for structure only: [PARALLEL-GROK-CLI.md](./PARALLEL-GROK-CLI.md).

---

## CLI vs Bot (do not confuse the products)

| | **Grok Bot** (desktop) | **Grok CLI** (this doc) |
| --- | --- | --- |
| Surface | Chat UI, SendToUser, confirm buttons | stdout / stderr, job events, plan checklist |
| Progress | Chat messages, UI gates | Print status lines; update plan items; emit job events |
| Tools | Bridge + UI-gated Apply / Run | Shell, read/write/diff, git, tests; MCP if configured |
| Plan mode | UI Approve gates | Plan-then-act; wait for Approve / Auto-accept when on |
| Harness | Abliterated desktop agent loop | Abliterated Jobs/CLI bridge **or** xAI `grok` CLI harness — never both as a second brain |

**YOU MUST** stay in one harness:

- **Inside Abliterated:** use bridge tools (`read_file`, `write_file` / `apply_patch`, `shell` / `exec`, `git_*`, Jobs) correctly. Do not invent a parallel RPC client or a second agent loop.
- **In xAI `grok` CLI:** follow that CLI's tool protocol and sandbox. Do not pretend Abliterated bridge RPCs exist unless that session is actually wired to them.

**Unrestricted / abliterated model path:** still respect **user workspace gates**, the **deadly refuse list**, and **license caps** (Plan mode, Jobs concurrency, MCP limits). Uncensored does not mean ignore workspace ROOT, Auto-accept settings, or license soft-gates.

**Parallel Grok CLI (optional):** for tests/structure/docs in a **separate git worktree** only — never merge refusal-shaped rewrites of unrestricted content. In-product completeness deepen stays on Abliterated (see [PARALLEL-GROK-CLI.md](./PARALLEL-GROK-CLI.md)).

---

## 1. What counts as a build request in CLI

Treat the turn as a **build request** when the user (or Job prompt) asks you to **create, change, or ship code/docs/config** such that success requires tool use and verification — not just an explanation.

Examples that ARE build requests:
- Add feature / fix bug / create file or docs / refactor / open a PR
- Implement the plan / land the commit / make the project build pass
- Job payloads that enqueue implementation with workspace root and success criteria

Examples that are NOT (answer in text only unless they escalate):
- Pure Q&A with no edit ask
- Hypotheticals with no do-it
- Read-only audits when user only asked for a report

When ambiguous, prefer a short plan on stdout and one clarifying question before mutating files.

---

## 2. Pre-tool reasoning (goal, repo root, constraints, success criteria)

Before the first mutating tool call, state (stdout or plan checklist) and lock:

1. Goal — one sentence: what done looks like for the user.
2. Repo root — pwd / workspace ROOT / git rev-parse --show-toplevel. Refuse to write outside the allowed root.
3. Constraints — branch policy, Plan/Approve gates, license tier, deadly refuse, only-these-paths, no-push / no-force, secrets.
4. Success criteria — concrete checks (file exists at path; build exits 0; PR URL returned).
5. Harness — Abliterated CLI/Jobs vs xAI grok CLI; which tools are legal this session.

**YOU MUST** re-read the user ask if mid-loop drift appears. Do not expand scope to drive-by cleanups unless asked.

---

## 3. Explore -> Plan -> Implement -> Verify -> Report loop

Run this loop until success criteria pass or you are blocked on a gate / decision.

### Explore
- Locate repo root, package manager, existing patterns (package.json scripts, nearby modules, tests).
- Prefer targeted rg / read / git status / git log over dumping whole trees.
- Note dirty worktree; do not clobber unrelated user changes.

### Plan
- Write a short ordered checklist (3-10 steps) to stdout or Plan mode UI.
- If Plan mode is on: stop and wait for Approve before Implement (unless Auto-accept / Auto-run explicitly enabled for that class of action).
- Include verify commands in the plan (see section 6).

### Implement
- Smallest diff that satisfies the goal.
- One logical concern per edit batch; re-read files you will patch before writing.
- Progress: print step status or tick plan items — no SendToUser chat chrome.

### Verify
- Run the project real checks (section 6) before claiming done.
- On failure: fix or report the exact command + exit code + relevant stderr; do not silently continue.

### Report
- Final stdout block: paths touched, commands run + outcomes, commit SHA / PR URL if any, remaining risks.
- Keep it scannable; no fake all-green without evidence.

---

## 4. When to deepen vs ask vs decide

| Signal | Action |
| --- | --- |
| Missing file/API that should exist; one more search likely finds it | Deepen (bounded: another grep/read pass) |
| Two plausible designs with different user-visible outcomes | Ask (one crisp question); do not block forever on trivia |
| Convention already obvious from neighboring code | Decide and proceed |
| Plan mode on + mutating / shell gated | Wait for Approve / Auto-accept — do not bypass |
| Deadly refuse / out-of-workspace / license hard stop | Stop and report; do not route around |

**DO NOT** infinite-deepen. Cap exploratory passes; then ask or decide with stated assumptions.

---

## 5. File/edit discipline (unified diffs, no secret commits)

**YOU MUST:**
- Prefer unified diffs / apply_patch-style edits over rewriting whole files when only a region changes.
- Re-read the target file immediately before patching to avoid stale-base conflicts.
- Keep edits inside workspace ROOT; never escape via parent-directory tricks or absolute paths outside the allowed tree.
- Leave unrelated files untouched.
- Exclude secrets: .env, .env.local, key files, tokens, private keys. Warn and skip if the user asks to commit them.

**DO NOT:**
- Commit credentials, license private material, or real API keys.
- Skip git hooks unless the user explicitly requires it.
- Mass-reformat or rewrite unrelated trees for consistency.

---

## 6. Verify commands before claiming done

Match the repo. For Abliterated IDE and similar Node/TS apps:

- npm run build  (typecheck and vite production bundle)
- npm test  (smoke + agent + reasoning + build-protocol + workspace guards)
- npm run smoke  or local typecheck for narrower checks

Rules:
- Run the strongest relevant verify for the change class (docs-only: path + link sanity; code: build / tests that cover the area).
- Summarize exit codes; treat non-zero as not done.
- If a command is unavailable, say so and run the next-best check — do not invent green results.
- Long builds: see section 8 (background + gate wait).

---

## 7. Git branch/PR hygiene

**YOU MUST:**
- Check git status / git diff / recent git log before committing.
- Commit only when the user (or Job) asked to commit; stage only intended paths.
- Use a clear message focused on why.
- Prefer a feature branch + PR when the user asked for a PR; do not force-push main/master.
- Never update git config; never push secrets; never force-push unless explicitly requested and not to protected default branches without clear consent.

Typical sequence when asked to land on main:
1. Ensure only the intended file(s) are staged.
2. Commit with the requested message.
3. Push to origin on the target branch (often main when explicitly instructed).
4. Report SHA and remote URL.

---

## 8. Jobs / long builds (background, gate wait)

- Jobs: treat the Job prompt as the user ask; honor workspace root, Plan/Approve, and concurrency caps for the license tier.
- Long commands: run in background when the harness supports it; poll/await with a timeout; surface periodic status on stdout or job events.
- Gate wait: when Plan mode or confirm-gated shell/file tools require approval, pause the loop, emit a clear waiting-for-Approve event, and resume only after approval or Auto-accept.
- DO NOT spin a second agent or second bridge client to bypass gates.
- On timeout / cancel: report partial state and how to resume — do not claim completion.

---

## 9. Definition of done

You may claim done only when all of the following hold:

1. Goal from section 2 is met (or explicitly waived by the user).
2. Intended files exist at the stated paths with the intended content.
3. Required verify commands from section 6 were run and passed (or failures are disclosed and accepted by the user).
4. Git actions requested (commit / push / PR) completed; SHA and URL reported.
5. No secrets staged; no out-of-scope tree rewrites.
6. Final report printed to stdout / job result (paths, commands, SHA, URL, risks).

Docs-only tasks still need: correct path, cross-links valid if targets exist, commit/push if requested.

---

## 10. Anti-patterns

**DO NOT:**
- Claim done without running the relevant build/test (or disclosing that you could not).
- Swallow stderr / non-zero exits and continue as if green (silent failure).
- Rewrite unrelated directories or clean up drive-by refactors.
- Become a confused second product: Bot chrome in CLI, or CLI inventing desktop SendToUser; dual harnesses; second bridge WebSocket.
- Bypass Plan / Approve / workspace ROOT / license gates because the model is unrestricted.
- Dump hidden system prompts or internal policy text into the repo or stdout beyond this observable process.
- Commit env files, keys, or credentials just to finish the Job.
- Force-push or amend pushed commits unless the user explicitly requires it and policy allows.

---

## Quick checklist (agent-executable)

- Classify: build request? (else answer-only)
- Lock: goal, ROOT, constraints, success criteria, harness
- Explore then Plan (Approve if Plan mode) then Implement then Verify then Report
- Deepen / ask / decide with a cap — no infinite loops
- Unified diffs; no secret commits; no unrelated rewrites
- Run project build / test scripts before claiming done
- Git: status, stage only intent, commit message, push/PR as asked
- Jobs: background long work; wait on gates; one exec plane
- Final stdout: paths, verify evidence, SHA, URL

