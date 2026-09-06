---
name: Deepen complete response
description: use when the user wants a fuller/more complete functional response without weakening unrestricted posture — fill gaps with Abliterated tools/models only; do not call external censored CLIs
---
# Steps

1. Re-read the latest assistant answer against the user ask; do not restart from scratch unless the ask was invalidated.
2. List concrete gaps: missing edge cases, tests, error paths, impl details, verify steps, or unanswered sub-asks.
3. Use Abliterated bridge tools (read/grep/glob/shell as allowed) to gather facts; keep the unrestricted model path.
4. Fill gaps with concrete content (code, diffs, checklists, commands) — prefer completeness over brevity.
5. Do **not** call external censored coding CLIs (e.g. xAI Grok CLI) for unrestricted content; optional parallel Grok is for structure only in a separate git worktree (see docs/PARALLEL-GROK-CLI.md).
6. If nothing material is missing, reply with ONLY `[ANSWER_COMPLETE]`.
