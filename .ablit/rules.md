# Workspace rules

## Completeness — HARD LOCK

NEVER write placeholder, stub, demo, or "implement X here" scripts or files.
ALWAYS write full-length, fully functional code that typechecks and runs.
Do not stop at a skeleton, TODO, or partial product. Finish the feature in this run, then verify (tsc / tests / scoped bash).
The build is incomplete until the final product works and those tests have been executed.
ALL code files MUST be written into the connected working directory (write_file or path-headed fences). Chat-only source is a failed build.
