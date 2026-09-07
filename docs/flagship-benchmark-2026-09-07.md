# Abliterated IDE vs flagship coding agents — harness benchmark

**Date:** 2026-09-07 (Australia/Melbourne)  
**Source of truth for Abliterated:** Mac checkout `/Users/adminuser/abliterated` (code + docs inventory)  
**Prior report:** [`flagship-benchmark-2026-09-06.md`](./flagship-benchmark-2026-09-06.md) · summary also in root [`BENCHMARK.md`](../BENCHMARK.md)

## Honest notes (read first)

- This is a **harness / capability matrix**, not a model-quality or SWE-bench leaderboard.
- **No SWE-bench, Terminal-Bench, or LiveCodeBench run was executed for this report.** Do not treat tallies as coding skill scores.
- Flagship cells are from **public product docs / announcements** (Cursor docs + computer-use blog, Claude Code docs, GitHub Copilot blog/changelog, OpenAI Codex docs, Gemini Code Assist / CLI docs, Windsurf/Cascade secondary writeups, xAI Grok Build announcements). Light refresh 2026-09-07 confirmed Cursor Cloud Agents + computer use + MCP still match the prior flagship posture; **flagship numeric cells carried forward** from 2026-09-06 unless a claim clearly changed (none did). Features ship and rename quickly — treat Partial where public claims are ambiguous.
- Scoring: **Yes = 1**, **Partial = 0.5**, **No = 0**. Same 75-item rubric for every product.
- Abliterated scores reflect **what the code implements today**, including opt-in features (Spark, Images, Plan mode, licenses, multi-agent, worktrees, MemPalace) counted when the path exists in-product.

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
| **Abliterated IDE** | **61.0** | Local bridge + Plan/Build + Jobs + write_file + web_search + skills + AGENTS.md + worktrees + MCP stdio; still no cloud/Tab/browser/true parallel subagents |
| **Claude Code** (CLI / IDE / Desktop / Web) | **60.5** | Strong agent harness + MCP + multi-surface; less “Tab IDE” than Cursor |
| **GitHub Copilot** (Agent mode + Cloud agent) | **58.5** | Synchronous IDE agent + async issue→PR cloud agent; MCP; plan mode |
| **Grok Build** (xAI `grok` CLI) | **53.5** | Real terminal agent (plan, MCP, subagents, ACP); early/beta vs mature IDEs |
| **Gemini CLI / Code Assist agent** | **50.0** | Open ReAct + MCP + huge context; thinner PR/cloud/checkpoint story than Cursor/Codex |
| **Windsurf / Cascade** | **49.5** | Cascade + MCP + autocomplete IDE; less public cloud-agent depth than Cursor |

**Abliterated delta vs prior:**

| Reference | Score | Notes |
| --- | ---: | --- |
| Early 2026-09-04 memory baseline | ~42/75 | Pre Phase 0/1 densify |
| Mid 2026-09-04 report body | ~53/75 | After deepen / mid-run / footer / images |
| 2026-09-04 evening TL;DR estimate | ~58.5/75 | Additive Phase 2–4 note; **cell arithmetic on that matrix was ~55.5** |
| 2026-09-06 honest recount | **56.5/75** | Plan/Build UI, Electron/licenses, MCP client→Yes, checkpoints→Yes |
| **2026-09-07 re-verify** | **61.0/75** | +4.5: write_file, web_search, job worktrees, skills ecosystem, AGENTS.md auto-load |

Closest peers on *local harness density* now sit near the Codex / Claude band on this matrix. Flagship *product completeness* still led by Cursor, then Codex. Abliterated leads the listed set on **inference & uncensored posture** (section H) and localhost-daemon safety shape — that is a **product niche**, not a model-IQ claim.

Narrow claim supported by this matrix: **highest local BYO / uncensored posture score among the listed products** (H = 8.0/8). Not “#1 overall.” **Does not beat Cursor** (66.5).

**Section deltas (Abl only, 2026-09-06 → 2026-09-07):**

| Section | Was | Now | Δ |
| --- | ---: | ---: | ---: |
| A Agent loop /12 | 10.0 | 10.0 | 0 |
| B Tools /15 | 12.0 | 13.5 | +1.5 |
| C Edit/gates /10 | 9.0 | 9.0 | 0 |
| D Git/PR/checkpoints /8 | 5.5 | 6.5 | +1.0 |
| E Extensibility /6 | 3.0 | 5.0 | +2.0 |
| F Cloud/mobile /6 | 0.5 | 0.5 | 0 |
| G IDE UI /10 | 8.5 | 8.5 | 0 |
| H Inference posture /8 | 8.0 | 8.0 | 0 |
| **Total /75** | **56.5** | **61.0** | **+4.5** |

Arithmetic check: 10.0 + 13.5 + 9.0 + 6.5 + 5.0 + 0.5 + 8.5 + 8.0 = **61.0**.

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
| 8 | Mid-run user inject / barge | Y | Y | P | P | P | P | P | P |
| 9 | Completion summary + next-step chips | Y | P | P | P | P | N | P | P |
| 10 | Parallel subagents | N | Y | Y | P | Y | P | P | Y |
| 11 | Real background job runners (not UI mock) | Y | Y | Y | Y | Y | P | P | Y |
| 12 | Cloud / remote VM agent | N | Y | Y | Y | Y | P | P | N |

**Subtotal /12:** Abl **10.0** · Cur **10.5** · CC **9.5** · Cop **9.0** · Cdx **10.0** · Gem **7.5** · Win **7.5** · Grk **8.0**

### B. Tools & codebase access (15)

| # | Capability | Abl | Cur | CC | Cop | Cdx | Gem | Win | Grk |
| ---: | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 13 | `read_file` / equivalent | Y | Y | Y | Y | Y | Y | Y | Y |
| 14 | First-class edit/write tool (not only diffs) | Y | Y | Y | Y | Y | Y | Y | Y |
| 15 | Grep / content search | Y | Y | Y | Y | Y | Y | Y | Y |
| 16 | Glob / file find | Y | Y | Y | Y | Y | Y | Y | Y |
| 17 | List directory | Y | Y | Y | Y | Y | Y | Y | Y |
| 18 | File outline / symbols | Y | Y | P | P | P | P | P | P |
| 19 | Semantic / codebase search | P | Y | Y | Y | Y | Y | Y | Y |
| 20 | Shell / terminal exec | Y | Y | Y | Y | Y | Y | Y | Y |
| 21 | Web fetch URL | Y | Y | Y | Y | Y | Y | Y | Y |
| 22 | Web / doc search (indexed) | Y | Y | Y | Y | Y | Y | Y | Y |
| 23 | Image generation tool | Y | Y | N | N | P | N | N | N |
| 24 | Browser / computer use | N | Y | Y | P | Y | P | P | N |
| 25 | MCP client (extensible tools) | Y | Y | Y | Y | Y | Y | Y | Y |
| 26 | @file / pin context tokens | Y | Y | Y | Y | Y | Y | Y | Y |
| 27 | Smart prefetch into context | Y | Y | P | P | P | P | P | P |

**Subtotal /15:** Abl **13.5** · Cur **15.0** · CC **13.0** · Cop **12.5** · Cdx **13.5** · Gem **12.5** · Win **12.5** · Grk **12.0**

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
| 44 | Worktree / isolated checkout agents | Y | Y | Y | P | Y | N | P | Y |
| 45 | Never-push commit policy (explicit) | Y | P | P | P | P | P | P | P |

**Subtotal /8:** Abl **6.5** · Cur **7.0** · CC **6.0** · Cop **5.5** · Cdx **6.0** · Gem **3.0** · Win **4.5** · Grk **3.5**

### E. Extensibility & project memory (6)

| # | Capability | Abl | Cur | CC | Cop | Cdx | Gem | Win | Grk |
| ---: | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 46 | MCP servers | P | Y | Y | Y | Y | Y | Y | Y |
| 47 | Skills / plugins / hooks ecosystem | Y | Y | Y | Y | Y | P | P | Y |
| 48 | Editable system / agent prompt | Y | Y | Y | Y | Y | Y | Y | Y |
| 49 | Per-thread tool allowlist | Y | P | P | P | P | P | P | P |
| 50 | Project rules file auto-load (AGENTS.md / CLAUDE.md / .cursor) | Y | Y | Y | Y | Y | Y | Y | Y |
| 51 | Pairing / remote-host settings surface | P | Y | Y | Y | Y | P | P | P |

**Subtotal /6:** Abl **5.0** · Cur **5.5** · CC **5.5** · Cop **5.5** · Cdx **5.5** · Gem **4.5** · Win **4.5** · Grk **5.0**

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
| **Score /75** | **61.0** | **66.5** | **60.5** | **58.5** | **62.0** | **50.0** | **49.5** | **53.5** |

---

## 3. Abliterated inventory (from code, 2026-09-07)

### Agent loop
- Real OpenAI-tools agent loop in `ChatScreen` + `sse.ts` + shared `agentTools.ts`.
- **Default max turns 24**, hard clamp **50**; stop reasons include `no_tools | cap | abort | error | pending_gate | deepened`.
- **Plan mode** (`PLAN_MODE_TOOLS`, Approve unlock) + **Build mode** toggle in chat chrome — read-only explore/checklist until operator Approves writes.
- Self-deepen, mid-run inject, completion footer chips, gate resume, agent-phase monitor (`agentPhase.ts`).
- Last **50** agent-run records for telemetry / status.
- **Multi-agent fleet** (`multiAgentRunner.ts`, opt-in `multiAgentEnabled`): sequential orchestrator → specialist role loops + agent bus + task graph. **Not scored as #10 Parallel subagents** (roles are serial `pickNextSubtask`, not concurrent).

### Tools
`read_file`, **`write_file`**, `grep`, `glob`, `list_dir`, `file_outline`, `semantic_search` (lexical), `git_status`, `git_commit`, `git_diff`, `create_pr`, `checkpoint_save`, `checkpoint_restore`, `shell`, `verify`, `web_fetch`, **`web_search`**, `generate_image` (if Images), `todo`, `task_read` / `task_update`, skills tools, MemPalace `memory_*`, plus MCP `mcp__*`.

### Jobs / MCP / Git / worktrees
- **Jobs:** real queue (`jobRunner.ts`), license-clamped concurrency; optional **git worktrees** (`jobWorktree.ts` + `jobWorktreesEnabled`) with `bridge.setRoot`.
- **MCP:** stdio via `daemon/mcp.js` + Settings; catalog one-clicks (incl. Playwright / MemPalace). HTTP MCP / multi-transport UI still Partial on “MCP servers.”
- **Git depth:** `git_diff`, checkpoints under `.ablit/checkpoints/`, `create_pr` via `gh` when present.

### Skills / project memory / MemPalace
- **Skills:** `list_skills` / `read_skill` / `suggest_skill` / `write_skill`; bundled + user + workspace `.ablit/skills`; Settings toggle; `capabilityRouter.ts` auto-match.
- **AGENTS.md auto-load:** `daemon/projectMemory.js` loads AGENTS.md / CLAUDE.md / `.cursorrules` / `.ablit/rules.md` / `.cursor/rules/*` into Chat + Jobs system prompts.
- **MemPalace:** first-party `memory_*` tools + optional MCP server wiring (`mempalace.ts` / `daemon/mempalace.js`).

### Product packaging
- **Electron** desktop shell (`electron/`, `dist:mac` / `dist:win`) spawning localhost bridge.
- **Licenses** + tier gates (`license.ts`); in-app **auth / billing** (Settings) landed 2026-09-07 pull — outside the 75 harness cells.
- **Mobile control** documented — **not shipped** → rubric #53 stays No.

### Still missing / Partial
| Gap | Status |
| --- | --- |
| MCP HTTP / multi-transport | **Partial** (stdio Yes) |
| Cloud / remote VM agents | **Missing** |
| Browser / computer use (built-in) | **Missing** (Playwright via MCP catalog only) |
| Tab / inline autocomplete | **Missing** |
| True parallel / concurrent subagents | **Missing** (multi-agent fleet is sequential roles) |
| Multi-agent mission-control UI | **Missing** (Jobs checkbox ≠ mission control) |
| Embedding semantic index | **Partial** (lexical `daemon/semantic.js`) |
| OS sandbox beyond daemon deny-list | **Missing** |

---

## 4. Cells that flipped (2026-09-06 → 2026-09-07)

| # | Capability | Was | Now | Evidence |
| ---: | --- | :---: | :---: | --- |
| 14 | First-class edit/write tool | P | **Y** | `write_file` in `ALL_TOOL_TYPES`; `agentTools.ts` → `bridge.writeFile`; `sse.ts` tool schema |
| 22 | Web / doc search | N | **Y** | `web_search` tool; `daemon/webSearch.js` (Brave/Bing/Searx/Wikipedia); Settings keys |
| 44 | Worktree / isolated checkout | N | **Y** | `jobWorktree.ts` + `jobWorktreesEnabled` in Jobs / multi-agent runners; real `git worktree` + `setRoot` |
| 47 | Skills / plugins / hooks | N | **Y** | `list_skills`/`read_skill`/`suggest_skill`/`write_skill`; `daemon/skills.js`; Settings; `docs/SKILLS.md`; bundled `skills/` |
| 50 | Project rules auto-load | N | **Y** | `daemon/projectMemory.js` + Chat/Jobs inject via `formatProjectMemoryPrompt` |

**Explicitly not flipped:** #10 stays **N** (multi-agent exists but roles are sequential, not parallel). #12/#24/#55/#61 stay **N**. #19/#46 stay **P**.

---

## 5. Flagship snapshots (public claims, light-refreshed 2026-09-07)

- **Cursor:** Cloud Agents on isolated VMs with **computer use**, self-hosted workers / My Machines / Team Pools, MCP (HTTP + stdio). Docs still match prior Yes cells. [computer use](https://cursor.com/docs/cloud-agent/self-hosted/computer-use).
- **Claude Code / Copilot / Codex / Gemini / Windsurf / Grok Build:** **Flagships carried forward** from 2026-09-06 numeric cells (no clear public claim change found in this light refresh).

Flagship **numeric cells unchanged** from 2026-09-06; no invented deltas.

---

## 6. Abliterated strengths / gaps

### Strengths
1. Localhost bridge + path jail + deadly refuse + separate edit vs shell autos.
2. Loop UX density: Plan/Build, self-deepen, mid-run barge-in, footer chips, gate resume.
3. BYOK + Spark + abliterated / unrestricted niche + no product telemetry claim.
4. Real Jobs + MCP stdio + git_diff / checkpoints / create_pr + opt-in worktrees.
5. First-class `write_file` + `web_search` + skills + AGENTS.md + MemPalace memory path.
6. Electron freemium desktop with explicit license feature gates (+ in-app auth/billing outside rubric).

### Gaps (biggest score left on table)
1. Cloud / mission-control depth vs Cursor–Codex band.
2. Built-in browser / computer use for verify loops (MCP Playwright is opt-in, not first-party #24).
3. Tab / full editor extension ecosystem.
4. MCP HTTP + hooks marketplace depth.
5. True concurrent parallel subagents (fleet is sequential today).
6. Embedding semantic index (still lexical Partial).

---

## 7. Files / evidence pointers

| Topic | Path |
| --- | --- |
| Tools list | `src/lib/sse.ts`, `src/types/index.ts`, `src/lib/agentTools.ts` |
| write_file / web_search | `agentTools.ts`, `daemon/webSearch.js` |
| Plan mode | `PLAN_MODE_TOOLS`, `ChatScreen.tsx`, `App.tsx` |
| Multi-agent (sequential) | `multiAgentRunner.ts`, `multiAgent.ts`, `docs/MULTI-AGENT-COORDINATION.md` |
| Worktrees | `jobWorktree.ts`, Settings `jobWorktreesEnabled` |
| Skills / AGENTS.md | `daemon/skills.js`, `daemon/projectMemory.js`, `docs/SKILLS.md` |
| MemPalace | `src/lib/mempalace.ts`, `daemon/mempalace.js` |
| Jobs | `jobRunner.ts`, `JobsScreen.tsx` |
| MCP | `mcpClient.ts`, `daemon/mcp.js` |
| License / tokens | `license.ts`, `builtinTokens.ts` |
| Electron | `electron/`, `package.json` desktop scripts |
| Promo charts | [harness](./assets/harness-2026-09-07.png) · [restrictive posture](./assets/restrictive-posture-2026-09-07.png) · site `public/benchmark/` |

---

*Generated for Greg · 2026-09-07 · harness matrix only · not SWE-bench · see Unrestricted benchmarking considerations above.*
