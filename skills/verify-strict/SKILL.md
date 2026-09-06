---
name: Verify-strict quality loop
description: >-
  use this when implementing or fixing code that must ship without errors —
  forced verify/tests, durable task graph, no false-done
---
# Steps

1. Lock the goal, in-scope paths, and **one measurable acceptance line** (build/test command or concrete check). Put it in durable task state as success criteria.
2. Decompose multi-step work into a task graph with dependencies; keep a short turn checklist separate from the durable goal.
3. Explore read-only first. Do not invent file contents.
4. Implement the smallest full working diff — no placeholders or stubs. Match local types and error handling.
5. **Verify before done**: run the acceptance command(s); fix and re-run until green. Cap / incomplete is not success.
6. Mark work done only after verification evidence (tests/build/typecheck). Do not self-declare complete without a check.
7. Report files touched, commands run + results, and residual risks. No drive-by cleanups.
