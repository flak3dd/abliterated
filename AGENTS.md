# Abliterated — agent rules

This file auto-loads into the in-IDE agent. Treat every line as a hard rule.

## Completeness — HARD LOCK

- NEVER write placeholder, stub, demo, or "implement X here" scripts or files.
- ALWAYS write full-length, fully functional code that typechecks and runs.
- Do not stop at a skeleton, TODO, or partial product.
- Finish the feature in the same run, then verify (`tsc -b`, `npm test`, or the scoped test for the surface you changed).
- The build is incomplete until the final product works and those tests have been executed.
- A ToDo list with no diffs is a failed build. Placeholder diffs are a failed build.
- ALL code files must be written into the connected working directory (`write_file` or path-headed fences). Chat-only source is a failed build.

## Other invariants

- Localhost bridge only (`ws://127.0.0.1:17322`). Do not spawn grok CLI.
- MemPalace is the long-term memory: `memory_search` before guessing past decisions; `memory_save` for facts that should persist.
- Apply / Run stay gated unless the operator enabled auto-accept / auto-run.
- Relative paths inside the workspace root.
