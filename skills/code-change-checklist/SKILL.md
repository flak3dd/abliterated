---
name: Code change checklist
description: use this when making multi-file code changes, refactors, or reviews -- a compact quality checklist before declaring done
---
# Steps

1. Confirm the user goal and which paths are in scope (avoid unrelated churn).
2. Read each file you will edit; note existing patterns, types, and tests.
3. Prefer small, reviewable diffs; match local naming and error-handling style.
4. Update types, defaults, and call sites together so the project still typechecks.
5. Run the lightest meaningful verify (unit test, tsc, or npm run build).
6. Summarize files touched and how a reviewer can validate the change.
