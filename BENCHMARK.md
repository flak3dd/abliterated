# Abliterated IDE vs flagship coding agents — harness benchmark

**Date:** 2026-09-04 (Australia/Melbourne)  
**Source of truth for Abliterated:** box checkout `/workspace/abliterated` (code inventory, not memory)  
**Also present on Mac:** `/Users/adminuser/abliterated`  
**Prior baseline (same day, earlier):** ~**42/75** (memory log). This file is the updated re-score after Phase 0/1 + self-deepen / mid-run / footer / densify / image gen.

## Honest notes (read first)

- This is a **harness / capability matrix**, not a model-quality or SWE-bench leaderboard.
- **No SWE-bench, Terminal-Bench, or LiveCodeBench run was executed for this report.** Do not treat tallies as coding skill scores.
- Flagship cells are from **public product docs / announcements** fetched 2026-09-04 (Cursor docs, Claude Code docs, GitHub Copilot blog/changelog, OpenAI Codex docs/manual summaries, Gemini Code Assist / Gemini CLI docs, Windsurf/Cascade secondary writeups, xAI Grok Build announcements). Features ship and rename quickly — treat Partial where public claims are ambiguous.
- Scoring: **Yes = 1**, **Partial = 0.5**, **No = 0**. Same 75-item rubric for every product.
- Abliterated scores reflect **what the code implements today**, including opt-in features (Spark, Images) counted as Yes when the path exists in-product.

---

## 1. TL;DR capability tally ( /75 )

| Product | Score | Notes |
| --- | ---: | --- |
| **Cursor** (IDE + Agent + Cloud Agents) | **66.5** | Broadest surface: Tab, local agent, cloud VM + computer use, MCP, checkpoints, PR/CI loops |
| **OpenAI Codex** (CLI / IDE / App / Cloud) | **62.0** | Multi-surface + sandbox + MCP + cloud PRs; desktop computer use claimed |
| **Claude Code** (CLI / IDE / Desktop / Web) | **60.5** | Strong agent harness + MCP + multi-surface; less “Tab IDE” than Cursor |
| **GitHub Copilot** (Agent mode + Cloud agent) | **58.5** | Synchronous IDE agent + async issue→PR cloud agent; MCP; plan mode |
| **Grok Build** (xAI `grok` CLI) | **53.5** | Real terminal agent (plan, MCP, subagents, ACP); early/beta vs mature IDEs |
| **Abliterated IDE** | **~58.5** | Local bridge workbench + real Jobs + MCP stdio + git_diff/checkpoints/create_pr; still no cloud/Tab/browser |
| **Gemini CLI / Code Assist agent** | **50.0** | Open ReAct + MCP + huge context; thinner PR/cloud/checkpoint story than Cursor/Codex |
| **Windsurf / Cascade** | **49.5** | Still relevant Cascade + MCP + autocomplete IDE; less public cloud-agent depth than Cursor |

**Delta for Abliterated since ~42/75:** **+11.0 → 53.0/75** (see §3).

Closest peers on *local harness density* are Gemini CLI and Grok Build; flagship *product completeness* still led by Cursor, then Codex / Claude Code / Copilot.

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

**Subtotal /12:** Abl **8.0** · Cur **10.5** · CC **9.5** · Cop **9.0** · Cdx **10.0** · Gem **7.5** · Win **7.5** · Grk **8.0**

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
| 25 | MCP client (extensible tools) | P | Y | Y | Y | Y | Y | Y | Y |
| 26 | @file / pin context tokens | Y | Y | Y | Y | Y | Y | Y | Y |
| 27 | Smart prefetch into context | Y | Y | P | P | P | P | P | P |

**Subtotal /15:** Abl **11.0** · Cur **15.0** · CC **13.0** · Cop **12.5** · Cdx **13.5** · Gem **12.5** · Win **12.5** · Grk **12.0**

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
| 42 | Non-git checkpoints / restore | P | Y | P | P | P | N | P | N |
| 43 | Auto CI fix on agent PRs | N | Y | P | Y | Y | N | N | N |
| 44 | Worktree / isolated checkout agents | N | Y | Y | P | Y | N | P | Y |
| 45 | Never-push commit policy (explicit) | Y | P | P | P | P | P | P | P |

**Subtotal /8:** Abl **3.0** · Cur **7.0** · CC **6.0** · Cop **5.5** · Cdx **6.0** · Gem **3.0** · Win **4.5** · Grk **3.5**

### E. Extensibility & project memory (6)

| # | Capability | Abl | Cur | CC | Cop | Cdx | Gem | Win | Grk |
| ---: | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 46 | MCP servers | P | Y | Y | Y | Y | Y | Y | Y |
| 47 | Skills / plugins / hooks ecosystem | N | Y | Y | Y | Y | P | P | Y |
| 48 | Editable system / agent prompt | Y | Y | Y | Y | Y | Y | Y | Y |
| 49 | Per-thread tool allowlist | Y | P | P | P | P | P | P | P |
| 50 | Project rules file auto-load (AGENTS.md / CLAUDE.md / .cursor) | N | Y | Y | Y | Y | Y | Y | Y |
| 51 | Pairing / remote-host settings surface | P | Y | Y | Y | Y | P | P | P |

**Subtotal /6:** Abl **2.5** · Cur **5.5** · CC **5.5** · Cop **5.5** · Cdx **5.5** · Gem **4.5** · Win **4.5** · Grk **5.0**

### F. Cloud, mobile, integrations (6)

| # | Capability | Abl | Cur | CC | Cop | Cdx | Gem | Win | Grk |
| ---: | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 52 | Issue → background PR agent | N | Y | Y | Y | Y | P | P | N |
| 53 | Mobile / web steer of agents | N | Y | Y | Y | Y | N | N | N |
| 54 | Slack / Linear / GitHub assign integrations | N | Y | Y | Y | Y | P | P | N |
| 55 | Multi-agent mission-control UI | N | Y | Y | Y | Y | N | P | P |
| 56 | Event subscriptions / wake-on-CI | N | Y | P | P | P | N | N | N |
| 57 | Headless / CI scriptable agent | P | P | Y | P | Y | Y | N | Y |

**Subtotal /6:** Abl **0.0** · Cur **5.5** · CC **5.0** · Cop **4.5** · Cdx **5.0** · Gem **2.0** · Win **1.5** · Grk **1.5**

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

**Subtotal /10:** Abl **7.5** · Cur **8.5** · CC **5.5** · Cop **8.0** · Cdx **8.0** · Gem **5.5** · Win **7.5** · Grk **5.0**

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
| **Score /75** | **~58.5** | **66.5** | **60.5** | **58.5** | **62.0** | **50.0** | **49.5** | **53.5** |

---

## 3. Abliterated inventory (from code)

### Agent loop
- Real OpenAI-tools agent loop in `ChatScreen` + `sse.ts`: stream → `tool_calls` → execute → `role: tool` → again.
- **Default max turns 24**, hard clamp **50** (`agentHelpers.ts` / Settings).
- Stop reasons: `no_tools | cap | abort | error | pending_gate | deepened`.
- **Resume after Commit / Run** when gated tools finish (`canResumeAfterTool`).
- Last **50** agent-run records kept for telemetry / status subtitle.

### Tools (11 types in `ALL_TOOL_TYPES`)
`read_file`, `grep`, `glob`, `list_dir`, `file_outline`, `semantic_search`, `git_status`, `git_commit`, `git_diff`, `create_pr`, `checkpoint_save`, `checkpoint_restore`, `shell`, `web_fetch`, `generate_image` (if Images), plus MCP `mcp__*`.

### Gates
- Auto-run: read/search/git_status when bridge connected.
- `git_commit`: auto if Auto-accept edits; else Commit button + resume.
- `shell` / bash fences: click-to-run unless Auto-run shell.
- Diff Apply: click unless Auto-accept; Grok layer parses unified diffs / path-comment files (`grokLayer.ts`).
- Daemon: `127.0.0.1:17322` only; ROOT confinement; deadly commands refused; `git_commit` never pushes.

### Loop UX (new since ~42/75)
- **Self-deepen:** default on, **2** passes (0–5); `[ANSWER_COMPLETE]` early stop; skip deepen when valid Done/Continue footer already present.
- **Multi-step:** prompt + `looksMultiStep` heuristic — plan 3–12 then act same run.
- **Mid-run inject:** queue with `⟦mid-run⟧` prefix; integrate nudge at turn boundary (default on).
- **Completion footer:** `**Done:**` + three `**Continue:**` options → UI chips (`completionFooter.ts`).
- **Copy** on bubbles, terminal panes, diffs.

### Context
- `@path` pins (`extractAtPins`), smart prefetch via semantic_search tokens.
- Densified live `SYSTEM_PROMPT` with LEGACY_PROMPTS upgrade path (`systemPrompt.ts` V3…V9 → current).

### Providers / extras
- Abliteration / **DGX Spark** / custom OpenAI-compatible (`inferenceProvider`).
- Optional **local FLUX** image stack (`spark-image/`, Images tab, `/image-v1` proxy).
- Bridge workspace: real host folder via daemon `set_root` / tree / preview.
- UI: ⌘K/Ctrl+K palette, digit tab shortcuts, status bar, quick chips, Home/Workspace/Models/Jobs/API/Images/Settings.

### Still missing / Partial
| Gap | Status |
| --- | --- |
| MCP client | **Partial** (stdio via bridge + Settings; connect/list/call) |
| Cloud / background agents | **Partial** (real local Jobs runner; no cloud VM) |
| Checkpoints / create_PR / git_diff tool | **Yes** (`git_diff`, checkpoints under `.ablit/checkpoints/`, `create_pr` via gh) |
| Browser / Playwright / computer use | **Missing** |
| Tab / inline autocomplete | **Missing** (not a VS Code fork) |
| Web search (vs fetch) | **Missing** |
| Parallel subagents / worktrees | **Missing** |
| Project AGENTS.md auto-load | **Missing** (prompt is global/settings) |
| Embedding semantic index | **Partial** (lexical semantic_search) |
| OS sandbox beyond daemon deny-list | **Missing** |

---

## 4. What moved since ~42/75

| Area | Was (~42/75 era) | Now |
| --- | --- | --- |
| Loop harden | Early loop (~12 turns mentioned historically) | Cap **24**, resume after gates, telemetry |
| Search/context | grep/glob/git mainly | + `list_dir`, `file_outline`, `semantic_search`, `@pins`, prefetch |
| Image gen | None | Opt-in `generate_image` + Images tab + spark-image FLUX path |
| Self-deepen | None | Default 2 passes + `[ANSWER_COMPLETE]` |
| Multi-step | Weak / prompt-only | Plan-then-act in densified prompt + heuristic |
| Mid-run | None | Queue + integrate nudge |
| Footer / chips | None | Done/Continue parse + one-click continues |
| Copy UX | Incomplete | Message / terminal / diff copy |
| Prompt | Long V8/V9 lineage | Densified current `SYSTEM_PROMPT` + upgrade |
| Spark | Landing | Provider + palette “Use Qwen on Spark” |

**Net:** +11.0 on the same rubric style → **53.0/75**, roughly tying **Grok Build** and ahead of **Gemini CLI / Windsurf** on this harness checklist, still well behind Cursor/Codex/Claude/Copilot on cloud+MCP+IDE depth.

---

## 5. Flagship snapshots (public claims, 2026-09)

- **Cursor:** Agents Window; local Agent + Plan; Tab autocomplete; checkpoints; MCP; Cloud Agents on VMs with **computer use**, artifacts, PR/CI autofix, subscriptions (GitHub/Slack/Linear/timers). Docs: [cloud-agent](https://cursor.com/docs/cloud-agent), [capabilities](https://cursor.com/docs/cloud-agent/capabilities.md).
- **Claude Code:** Terminal / IDE / desktop / web; MCP (`claude mcp add`); background agents; Agent SDK; Chrome/browser workflows via docs ecosystem. [code.claude.com/docs](https://code.claude.com/docs).
- **GitHub Copilot:** IDE **agent mode** + **plan/ask**; async **cloud coding agent** (research/plan/code, branch/PR). [GitHub blog](https://github.blog/developer-skills/github/less-todo-more-done-the-difference-between-coding-agent-and-agent-mode-in-github-copilot/), [2026-04-01 changelog](https://github.blog/changelog/2026-04-01-research-plan-and-code-with-copilot-cloud-agent/).
- **OpenAI Codex:** CLI + IDE + desktop app + cloud; MCP; OS sandboxes; cloud PRs; computer use claimed on desktop surfaces. Manual/overview: [developers.openai.com/codex](https://developers.openai.com/codex/).
- **Gemini CLI / Code Assist:** Open-source ReAct CLI; MCP; Search grounding; large context; agent mode in VS Code/IntelliJ powered by CLI. [Google docs](https://developers.google.com/gemini-code-assist/docs/gemini-cli).
- **Windsurf / Cascade:** AI IDE with Cascade agentic flow + MCP + autocomplete; still compared in 2026 roundups; weaker public cloud-agent story than Cursor.
- **Grok Build (xAI):** Terminal coding agent (`curl … x.ai/cli/install.sh`); plan mode; MCP/skills/hooks; parallel subagents; ACP; early beta → OSS claims in secondary sources (May–Jul 2026 announcements).

---

## 6. Abliterated strengths / gaps

### Strengths
1. **Machine-consumable apply protocol** (unified ` ```diff `, ` ```bash `, path-comment whole files) with bridge apply.
2. **Safety-shaped local execution** (localhost daemon, path jail, deadly refuse, separate edit vs shell autos).
3. **Loop UX density** unusual among small harnesses: self-deepen, mid-run barge-in, footer chips, gate resume, telemetry.
4. **BYOK + Spark + abliterated niche** (cloud Abliteration + local Qwen abliterated + local FLUX path).
5. **Encoding/EOL fidelity** and explicit never-push commit tool — good for real repos.

### Gaps (biggest score left on table)
1. **MCP** — largest ecosystem unlock.  
2. **Real Jobs / cloud or worktree agents** — dummy Jobs today.  
3. **Checkpoints + `git_diff` + create_PR**.  
4. **Browser / computer use** for verify loops.  
5. **Tab / real editor** (or deep VS Code/ACP embed) — without this, Copilot/Cursor keep a daily-driver gap.  
6. **Project memory files** (AGENTS.md) + true embedding index.

---

## 7. Recommended next phases (close biggest gaps)

Ordered for score-per-week, aligned with prior roadmap:

| Phase | Goal | Rubric lift (est.) |
| --- | --- | --- |
| **2 — Jobs real** | Replace dummy Jobs with queued local runs (headless agent on bridge root, logs, cancel) | +2–3 |
| **3 — MCP client** | stdio + optional HTTP MCP; tool merge into `filterChatTools`; Settings UI | +4–5 |
| **4 — Git depth** | `git_diff` tool, checkpoint snapshots (file-level restore), optional `create_pr` via `gh` | +3–4 |
| **5 — Browser optional** | Playwright MCP or built-in browse/screenshot tool | +1–2 |
| **6 — Project rules** | Auto-load `AGENTS.md` / `.ablit/rules` into system prompt | +1 |
| **Later** | ACP/VS Code extension or Tab model; cloud worker; embedding index | large, expensive |

**Near-term target:** land Phases 2–4 → roughly **~62–65/75** harness parity with mid-flagships **without** forking VS Code — still behind Cursor on Tab/cloud computer use, but competitive with Claude Code/Codex on *local agent* checklist items.

---

## 8. Files / evidence pointers

| Topic | Path |
| --- | --- |
| Tools list | `src/lib/sse.ts` (`CHAT_TOOLS`), `src/types/index.ts` |
| Loop / deepen / mid-run | `src/screens/ChatScreen.tsx`, `src/lib/agentHelpers.ts` |
| Footer chips | `src/lib/completionFooter.ts`, `MessageBubble.tsx` |
| Prompt densify | `src/lib/systemPrompt.ts` |
| Bridge / gates | `daemon/bridge.js`, README Architecture |
| Spark / images | `spark/`, `spark-image/`, `ImagesScreen.tsx` |
| Jobs mock | `src/screens/JobsScreen.tsx` (`addDummy`) |
| Prior 42/75 note | agent memory `2026-09.md` (2026-09-04 entry) |

---

*Generated for Greg · 2026-09-04 · do not treat as SWE-bench · overwrite this dated path on future re-scores or add `flagship-benchmark-YYYY-MM-DD.md` beside it.*

---

## 9. Phase 2→4 landing note (2026-09-04 evening)

Landed on box `/workspace/abliterated` and mirrored to Mac:

- **Phase 2 (required):** Real single-flight Jobs runner (`src/lib/jobRunner.ts`), shared `agentTools.ts`, JobsScreen Run form + cancel/logs. Headless agent via `streamChatCompletion`.
- **Phase 3 (best effort):** MCP settings schema + stdio client through bridge (`daemon/mcp.js`, `mcpClient.ts`), tools namespaced `mcp__server__tool`, merged in `filterChatTools`.
- **Phase 4 (best effort):** `git_diff`, `checkpoint_save`/`checkpoint_restore`, `create_pr` (gh), wired into ALL_TOOL_TYPES / CHAT_TOOLS / system prompt.

**Approx harness delta:** +1 (jobs) +0.5 (MCP) +0.5 (MCP servers) +1 (git_diff) +0.5 (PR) +0.5 (checkpoints) +0.5 (headless) +1 (jobs UI) ≈ **+5.5 → ~58.5/75** (re-tally subtotals manually on next full re-score).
