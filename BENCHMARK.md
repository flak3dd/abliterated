# Abliterated IDE vs flagship coding agents — harness benchmark

**Date:** 2026-09-06 (Australia/Melbourne)  
**Source of truth for Abliterated:** Mac checkout `/Users/adminuser/abliterated` (code + docs inventory)  
**Prior report:** [`docs/flagship-benchmark-2026-09-04.md`](docs/flagship-benchmark-2026-09-04.md) · dated copy: [`docs/flagship-benchmark-2026-09-06.md`](docs/flagship-benchmark-2026-09-06.md)

## Honest notes (read first)

- This is a **harness / capability matrix**, not a model-quality or SWE-bench leaderboard.
- **No SWE-bench, Terminal-Bench, or LiveCodeBench run was executed for this report.** Do not treat tallies as coding skill scores.
- Flagship cells are from **public product docs / announcements** (Cursor docs + computer-use blog, Claude Code docs, GitHub Copilot blog/changelog, OpenAI Codex docs, Gemini Code Assist / CLI docs, Windsurf/Cascade secondary writeups, xAI Grok Build announcements). Light refresh 2026-09-06 confirmed Cursor Cloud Agents + computer use + MCP still match the 2026-09-04 flagship posture. Features ship and rename quickly — treat Partial where public claims are ambiguous.
- Scoring: **Yes = 1**, **Partial = 0.5**, **No = 0**. Same 75-item rubric for every product.
- Abliterated scores reflect **what the code implements today**, including opt-in features (Spark, Images, Plan mode, licenses) counted when the path exists in-product.

---

## Unrestricted / abliterated benchmarking considerations

> **Read this before quoting any score.**

1. This chart measures **harness / product capability density**, not coding-arena Elo or SWE-bench solve rate.
2. Abliterated is optimized for **refusal-stripped / local BYO** workflows. Hosted flagships often refuse or soft-refuse categories Abliterated will attempt. **Do not claim a “smarter model” from this chart.**
3. Comparing an unrestricted local agent to safety-tuned hosted products **mixes policy with capability**. A higher score on agent-freedom axes can mean fewer product refusals, not better engineering quality.
4. Scores can look “higher” on BYOK / uncensored / local-daemon axes without meaning better SWE-bench, Terminal-Bench, or human eval performance.
5. Treat **“uncensored” as a product axis**, not a quality cheat code. Readers who need model skill should run (or cite) dedicated coding benchmarks separately.
6. Sources are date-stamped; **no fabricated numbers**. Abliterated cells come from this repo’s code/docs; flagship cells from public claims only.

---

## 1. TL;DR capability tally ( /75 )

| Product | Score | Notes |
| --- | ---: | --- |
| **Cursor** (IDE + Agent + Cloud Agents) | **66.5** | Broadest surface: Tab, local agent, cloud VM + computer use, MCP, checkpoints, PR/CI loops |
| **OpenAI Codex** (CLI / IDE / App / Cloud) | **62.0** | Multi-surface + sandbox + MCP + cloud PRs; desktop computer use claimed |
| **Claude Code** (CLI / IDE / Desktop / Web) | **60.5** | Strong agent harness + MCP + multi-surface; less “Tab IDE” than Cursor |
| **GitHub Copilot** (Agent mode + Cloud agent) | **58.5** | Synchronous IDE agent + async issue→PR cloud agent; MCP; plan mode |
| **Abliterated IDE** | **56.5** | Local bridge workbench + Plan/Build + real Jobs + MCP stdio + git/checkpoints/PR; Electron + licenses; still no cloud/Tab/browser |
| **Grok Build** (xAI `grok` CLI) | **53.5** | Real terminal agent (plan, MCP, subagents, ACP); early/beta vs mature IDEs |
| **Gemini CLI / Code Assist agent** | **50.0** | Open ReAct + MCP + huge context; thinner PR/cloud/checkpoint story than Cursor/Codex |
| **Windsurf / Cascade** | **49.5** | Cascade + MCP + autocomplete IDE; less public cloud-agent depth than Cursor |

**Abliterated delta vs prior:**

| Reference | Score | Notes |
| --- | ---: | --- |
| Early 2026-09-04 memory baseline | ~42/75 | Pre Phase 0/1 densify |
| Mid 2026-09-04 report body | ~53/75 | After deepen / mid-run / footer / images |
| 2026-09-04 evening TL;DR estimate | ~58.5/75 | Additive Phase 2–4 note; **cell arithmetic on that matrix was ~55.5** |
| **2026-09-06 honest recount** | **56.5/75** | Corrected subtotals + product reality: Plan/Build UI, Electron/licenses/token caps, MCP client→Yes, checkpoints→Yes |

Closest peers on *local harness density* remain Grok Build / Gemini CLI / mid Copilot band. Flagship *product completeness* still led by Cursor, then Codex / Claude Code / Copilot. Abliterated leads the listed set on **inference & uncensored posture** (section H) and localhost-daemon safety shape — that is a **product niche**, not a model-IQ claim.

Narrow claim supported by this matrix: **highest local BYO / uncensored posture score among the listed products** (H = 8.0/8). Not “#1 overall.”

---

## 2. Rubric (75 items) + matrix

Legend: **Y** Yes · **P** Partial · **N** No  

Columns: **Abl** Abliterated · **Cur** Cursor · **CC** Claude Code · **Cop** Copilot · **Cdx** Codex · **Gem** Gemini CLI/Assist · **Win** Windsurf/Cascade · **Grk** Grok Build

### A. Agent loop & orchestration (12)

| # | Capability | Abl | Cur | CC | Cop | Cdx | Gem | Win | Grk |
| ---: | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | Multi-turn tool/agent loop | Y | Y | Y | Y | Y | Y | Y | Y |
| 2 | Configurable turn / step cap | Y | Y | Y | P | Y | P | P | P |
| 3 | Abort / stop mid-run | Y | Y | Y | Y | Y | Y | Y | Y |
| 4 | Resume after human tool gates | Y | Y | Y | Y | Y | Y | Y | Y |
| 5 | Run telemetry / stop-reason history | Y | Y | P | P | Y | P | P | P |
| 6 | Self-deepen / answer self-review passes | Y | N | N | N | N | N | N | N |
| 7 | Plan-then-act (same run) | Y | Y | Y | Y | Y | Y | Y | Y |
| 8 | Mid-run user inject / queue | Y | Y | P | P | P | P | P | P |
| 9 | Completion summary + next-step chips | Y | P | P | P | P | N | P | P |
| 10 | Parallel subagents | N | Y | Y | P | Y | P | P | Y |
| 11 | Real background job runners (not UI mock) | Y | Y | Y | Y | Y | P | P | Y |
| 12 | Cloud / remote VM agent | N | Y | Y | Y | Y | P | P | N |

**Subtotal /12:** Abl **10.0** · Cur **10.5** · CC **9.5** · Cop **9.0** · Cdx **10.0** · Gem **7.5** · Win **7.5** · Grk **8.0**

### B. Tools & codebase access (15)

| # | Capability | Abl | Cur | CC | Cop | Cdx | Gem | Win | Grk |
| ---: | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 13 | `read_file` / equivalent | Y | Y | Y | Y | Y | Y | Y | Y |
| 14 | First-class edit/write tool (not only diffs) | P | Y | Y | Y | Y | Y | Y | Y |
| 15 | Grep / content search | Y | Y | Y | Y | Y | Y | Y | Y |
| 16 | Glob / file find | Y | Y | Y | Y | Y | Y | Y | Y |
| 17 | List directory | Y | Y | Y | Y | Y | Y | Y | Y |
| 18 | File outline / symbols | Y | Y | P | P | P | P | P | P |
| 19 | Semantic / codebase search | P | Y | Y | Y | Y | Y | Y | Y |
| 20 | Shell / terminal exec | Y | Y | Y | Y | Y | Y | Y | Y |
| 21 | Web fetch URL | Y | Y | Y | Y | Y | Y | Y | Y |
| 22 | Web / doc search (indexed) | N | Y | Y | Y | Y | Y | Y | Y |
| 23 | Image generation tool | Y | Y | N | N | P | N | N | N |
| 24 | Browser / computer use | N | Y | Y | P | Y | P | P | N |
| 25 | MCP client (extensible tools) | Y | Y | Y | Y | Y | Y | Y | Y |
| 26 | @file / pin context tokens | Y | Y | Y | Y | Y | Y | Y | Y |
| 27 | Smart prefetch into context | Y | Y | P | P | P | P | P | P |

**Subtotal /15:** Abl **12.0** · Cur **15.0** · CC **13.0** · Cop **12.5** · Cdx **13.5** · Gem **12.5** · Win **12.5** · Grk **12.0**

### C. Edit apply, gates, safety (10)

| # | Capability | Abl | Cur | CC | Cop | Cdx | Gem | Win | Grk |
| ---: | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 28 | Unified-diff / patch apply path | Y | Y | Y | Y | Y | Y | Y | Y |
| 29 | Confirm-gated file apply | Y | Y | Y | Y | Y | Y | Y | Y |
| 30 | Opt-in auto-accept edits | Y | Y | Y | Y | Y | Y | Y | Y |
| 31 | Opt-in auto-run shell (separate) | Y | Y | Y | Y | Y | Y | Y | Y |
| 32 | Per-hunk accept / reject UI | Y | Y | P | P | P | P | Y | P |
| 33 | Preserve encoding / EOL on write | Y | P | P | P | P | P | P | P |
| 34 | Workspace path-escape blocking | Y | Y | Y | Y | Y | Y | Y | Y |
| 35 | Dangerous command refuse list | Y | Y | Y | Y | Y | Y | Y | Y |
| 36 | OS sandbox (Seatbelt/bubblewrap/etc.) | N | P | P | P | Y | P | P | P |
| 37 | Localhost-only execution daemon | Y | N | N | N | N | N | N | N |

**Subtotal /10:** Abl **9.0** · Cur **8.0** · CC **7.5** · Cop **7.5** · Cdx **8.0** · Gem **7.5** · Win **8.0** · Grk **7.5**

### D. Git, PR, checkpoints (8)

| # | Capability | Abl | Cur | CC | Cop | Cdx | Gem | Win | Grk |
| ---: | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 38 | Branch + dirty in UI / status | Y | Y | Y | Y | Y | P | Y | P |
| 39 | First-class `git_status` / `git_commit` tools | Y | P | Y | P | P | P | P | P |
| 40 | `git_diff` / structured diff tool | Y | Y | Y | Y | Y | Y | Y | Y |
| 41 | Create / open pull request | P | Y | Y | Y | Y | P | P | N |
| 42 | Non-git checkpoints / restore | Y | Y | P | P | P | N | P | N |
| 43 | Auto CI fix on agent PRs | N | Y | P | Y | Y | N | N | N |
| 44 | Worktree / isolated checkout agents | N | Y | Y | P | Y | N | P | Y |
| 45 | Never-push commit policy (explicit) | Y | P | P | P | P | P | P | P |

**Subtotal /8:** Abl **5.5** · Cur **7.0** · CC **6.0** · Cop **5.5** · Cdx **6.0** · Gem **3.0** · Win **4.5** · Grk **3.5**

### E. Extensibility & project memory (6)

| # | Capability | Abl | Cur | CC | Cop | Cdx | Gem | Win | Grk |
| ---: | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 46 | MCP servers | P | Y | Y | Y | Y | Y | Y | Y |
| 47 | Skills / plugins / hooks ecosystem | N | Y | Y | Y | Y | P | P | Y |
| 48 | Editable system / agent prompt | Y | Y | Y | Y | Y | Y | Y | Y |
| 49 | Per-thread tool allowlist | Y | P | P | P | P | P | P | P |
| 50 | Project rules file auto-load (AGENTS.md / CLAUDE.md / .cursor) | N | Y | Y | Y | Y | Y | Y | Y |
| 51 | Pairing / remote-host settings surface | P | Y | Y | Y | Y | P | P | P |

**Subtotal /6:** Abl **3.0** · Cur **5.5** · CC **5.5** · Cop **5.5** · Cdx **5.5** · Gem **4.5** · Win **4.5** · Grk **5.0**

### F. Cloud, mobile, integrations (6)

| # | Capability | Abl | Cur | CC | Cop | Cdx | Gem | Win | Grk |
| ---: | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 52 | Issue → background PR agent | N | Y | Y | Y | Y | P | P | N |
| 53 | Mobile / web steer of agents | N | Y | Y | Y | Y | N | N | N |
| 54 | Slack / Linear / GitHub assign integrations | N | Y | Y | Y | Y | P | P | N |
| 55 | Multi-agent mission-control UI | N | Y | Y | Y | Y | N | P | P |
| 56 | Event subscriptions / wake-on-CI | N | Y | P | P | P | N | N | N |
| 57 | Headless / CI scriptable agent | P | P | Y | P | Y | Y | N | Y |

**Subtotal /6:** Abl **0.5** · Cur **5.5** · CC **5.0** · Cop **4.5** · Cdx **5.0** · Gem **2.0** · Win **1.5** · Grk **1.5**

### G. IDE / UI affordances (10)

| # | Capability | Abl | Cur | CC | Cop | Cdx | Gem | Win | Grk |
| ---: | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 58 | Full editor + extensions ecosystem | P | Y | P | Y | Y | P | Y | N |
| 59 | Command palette | Y | Y | P | Y | Y | P | Y | P |
| 60 | Status bar (bridge / agent / gates) | Y | Y | P | Y | Y | P | Y | P |
| 61 | Tab / inline autocomplete model | N | Y | N | Y | P | Y | Y | N |
| 62 | Diff review UI in chat | Y | Y | Y | Y | Y | Y | Y | Y |
| 63 | One-click copy on messages / commands | Y | Y | Y | Y | Y | Y | Y | Y |
| 64 | Quick-action composer chips | Y | P | P | P | P | P | P | P |
| 65 | Multi-thread / session management | Y | Y | Y | Y | Y | Y | Y | Y |
| 66 | Images workspace / gen UI | Y | P | N | N | P | N | N | N |
| 67 | Jobs UI backed by real workers | Y | Y | Y | Y | Y | P | P | Y |

**Subtotal /10:** Abl **8.5** · Cur **8.5** · CC **5.5** · Cop **8.0** · Cdx **8.0** · Gem **5.5** · Win **7.5** · Grk **5.0**

### H. Inference & product posture (8)

| # | Capability | Abl | Cur | CC | Cop | Cdx | Gem | Win | Grk |
| ---: | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 68 | BYOK / OpenAI-compatible custom base URL | Y | Y | Y | P | P | Y | P | P |
| 69 | Multi-provider switch in UI | Y | Y | P | Y | Y | P | Y | P |
| 70 | First-class local / self-host path (e.g. Spark) | Y | P | P | N | P | P | N | P |
| 71 | Reasoning effort controls | Y | Y | Y | Y | Y | Y | P | Y |
| 72 | Model picker / per-thread model | Y | Y | Y | Y | Y | Y | Y | Y |
| 73 | Client claims no product telemetry | Y | N | P | N | N | P | N | P |
| 74 | Abliterated / uncensored model path as product niche | Y | N | N | N | N | N | N | P |
| 75 | Densified, version-upgrading system prompt | Y | P | Y | P | Y | Y | P | Y |

**Subtotal /8:** Abl **8.0** · Cur **5.0** · CC **5.5** · Cop **4.0** · Cdx **5.0** · Gem **5.5** · Win **3.5** · Grk **5.0**

### Totals

| | Abl | Cur | CC | Cop | Cdx | Gem | Win | Grk |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| **Score /75** | **56.5** | **66.5** | **60.5** | **58.5** | **62.0** | **50.0** | **49.5** | **53.5** |

---

## 3. Abliterated inventory (from code, 2026-09-06)

### Agent loop
- Real OpenAI-tools agent loop in `ChatScreen` + `sse.ts` + shared `agentTools.ts`.
- **Default max turns 24**, hard clamp **50**; stop reasons include `no_tools | cap | abort | error | pending_gate | deepened`.
- **Plan mode** (`PLAN_MODE_TOOLS`, Approve unlock) + **Build mode** toggle in chat chrome — read-only explore/checklist until operator Approves writes.
- Self-deepen, mid-run inject, completion footer chips, gate resume, agent-phase monitor (`agentPhase.ts`).
- Last **50** agent-run records for telemetry / status.

### Tools
`read_file`, `grep`, `glob`, `list_dir`, `file_outline`, `semantic_search`, `git_status`, `git_commit`, `git_diff`, `create_pr`, `checkpoint_save`, `checkpoint_restore`, `shell`, `web_fetch`, `generate_image` (if Images), plus MCP `mcp__*`.

Edits still primarily via unified-diff / path-comment fences (`grokLayer.ts`) — first-class `write_file` tool remains Partial.

### Jobs / MCP / Git
- **Jobs:** real queue (`jobRunner.ts`), license-clamped concurrency (Free/Starter 1; Pro/Team up to 4; admin higher). SSE completion flight still serializes streams (audit note) — not true parallel subagents.
- **MCP:** stdio via `daemon/mcp.js` + Settings; tools merge into chat/jobs. HTTP MCP / multi-transport UI still Partial on “MCP servers.”
- **Git depth:** `git_diff`, checkpoints under `.ablit/checkpoints/`, `create_pr` via `gh` when present.

### Product packaging (post–Sept 4)
- **Electron** desktop shell (`electron/`, `dist:mac` / `dist:win`) spawning localhost bridge.
- **Licenses** + tier gates (`license.ts`): Plan mode, MCP count, Jobs concurrency, built-in unrestricted **token caps** (`builtinTokens.ts`).
- Marketing/payments (Solana/crypto/Stripe) live on **abliterated-site**, not in the harness rubric.
- **Mobile control** documented (`docs/MOBILE-CONTROL.md`) as judgment remote — **not shipped** → rubric #53 stays No.

### Still missing / Partial
| Gap | Status |
| --- | --- |
| MCP HTTP / multi-transport | **Partial** (stdio Yes) |
| Cloud / remote VM agents | **Missing** |
| Browser / computer use | **Missing** |
| Tab / inline autocomplete | **Missing** |
| Web search (vs fetch) | **Missing** |
| Parallel subagents / worktrees | **Missing** (Jobs ≠ subagents) |
| Project AGENTS.md auto-load | **Missing** |
| Embedding semantic index | **Partial** (lexical) |
| OS sandbox beyond daemon deny-list | **Missing** |
| First-class write_file tool | **Partial** (diff/fence apply) |

---

## 4. What moved since 2026-09-04 evening

| Area | 2026-09-04 evening | 2026-09-06 |
| --- | --- | --- |
| Plan/Build in chat | Prompt plan-then-act | Formal Plan mode + Approve + Build toggle |
| Jobs | Real single-flight runner | License-capped concurrency (still SSE-serialized) |
| MCP | stdio Partial | Client counted **Yes**; servers transport still **Partial** |
| Checkpoints | Partial | **Yes** (save + restore paths in product) |
| Packaging | Web/Vite primary | Electron desktop + freemium licenses + token caps |
| Score bookkeeping | TL;DR ~58.5 (additive) | Cell-accurate **56.5** |

---

## 5. Flagship snapshots (public claims, refreshed 2026-09-06)

- **Cursor:** Cloud Agents on isolated VMs with **computer use**, artifacts, MCP (HTTP + stdio), PR/CI loops. Docs: [capabilities](https://cursor.com/docs/cloud-agent/capabilities), [computer use blog](https://cursor.com/blog/agent-computer-use).
- **Claude Code:** Terminal / IDE / desktop / web; MCP; background agents; Agent SDK. [code.claude.com/docs](https://code.claude.com/docs).
- **GitHub Copilot:** IDE agent mode + plan/ask; async cloud coding agent. GitHub blog/changelog (2026).
- **OpenAI Codex:** CLI + IDE + desktop + cloud; MCP; OS sandboxes; cloud PRs. [developers.openai.com/codex](https://developers.openai.com/codex/).
- **Gemini CLI / Code Assist:** Open-source ReAct CLI; MCP; Search grounding; large context.
- **Windsurf / Cascade:** AI IDE with Cascade + MCP + autocomplete; weaker public cloud-agent story than Cursor.
- **Grok Build (xAI):** Terminal coding agent; plan mode; MCP/skills/hooks; parallel subagents; early/beta posture.

Flagship **numeric cells unchanged** from 2026-09-04 except where this file already matched; no invented deltas.

---

## 6. Abliterated strengths / gaps

### Strengths
1. Localhost bridge + path jail + deadly refuse + separate edit vs shell autos.
2. Loop UX density: Plan/Build, self-deepen, mid-run barge-in, footer chips, gate resume.
3. BYOK + Spark + abliterated / unrestricted niche + no product telemetry claim.
4. Real Jobs + MCP stdio + git_diff / checkpoints / create_pr.
5. Electron freemium desktop with explicit license feature gates.

### Gaps (biggest score left on table)
1. Cloud / worktree / mission-control depth vs Cursor–Codex band.
2. Browser / computer use for verify loops.
3. Tab / full editor extension ecosystem.
4. MCP HTTP + skills/hooks marketplace.
5. AGENTS.md project memory + true embedding index.
6. First-class write tool (not only diffs).

---

## 7. Files / evidence pointers

| Topic | Path |
| --- | --- |
| Tools list | `src/lib/sse.ts`, `src/types/index.ts` |
| Plan mode | `PLAN_MODE_TOOLS`, `ChatScreen.tsx`, `App.tsx` |
| Loop / deepen / mid-run | `ChatScreen.tsx`, `agentHelpers.ts`, `agentPhase.ts` |
| Jobs | `jobRunner.ts`, `JobsScreen.tsx` |
| MCP | `mcpClient.ts`, `daemon/mcp.js` |
| License / tokens | `license.ts`, `builtinTokens.ts` |
| Electron | `electron/`, `package.json` desktop scripts |
| Promo charts | [harness](docs/assets/harness-2026-09-06.png) · [restrictive posture](docs/assets/restrictive-posture-2026-09-06.png) · site `public/benchmark/` |

---

*Generated for Greg · 2026-09-06 · harness matrix only · not SWE-bench · see Unrestricted benchmarking considerations above.*
