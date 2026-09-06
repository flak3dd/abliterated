---
name: Grok CLI build process
description: use this when implementing a build/feature/fix request in Abliterated CLI, Jobs, or terminal agent loops -- follow docs/GROK-CLI-BUILD-PROCESS.md discipline
---
# Steps

1. Lock goal, repo root, constraints, and success criteria before mutating files.
2. Explore with read-only tools (list_dir, glob, grep, read_file, semantic_search) -- do not invent file contents.
3. Write a short ordered plan (3-10 steps). If Plan mode is on, stop until Approve.
4. Implement the smallest diff that meets the goal; one concern per edit batch. Full working code only — never placeholders or stub scripts.
5. Verify with the project build/test commands (e.g. npm run build / tsc) and re-read changed files if checks fail. Do not stop until the product works and tests have been run.
6. Report what changed, how to verify, and any remaining risks -- do not expand into drive-by cleanups.
