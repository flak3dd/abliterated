# Skills

Abliterated agents can discover and follow reusable SKILL.md recipes (Cursor / Grok Bot-compatible) when a task matches the skill description.

## Format

Frontmatter fields: name, description. Body is markdown steps.

## Skill roots (scan order; later wins on same slug)

1. Bundled — skills/<slug>/SKILL.md next to the Abliterated install
2. User global — ~/.abliterated/skills/<slug>/SKILL.md
3. Workspace — <workspaceRoot>/.ablit/skills/<slug>/SKILL.md

## How to add a skill

1. Pick a short slug (my-review-flow).
2. Create SKILL.md under one of the roots above.
3. Fill name + description (when to use) and markdown steps.
4. In Settings → Skills, confirm enabled and Refresh.
5. Ask the agent a matching task — it should call list_skills / read_skill.

Do not put secrets in skill files.

## Agent tools

- list_skills — catalog JSON
- read_skill — full markdown body for skill_id
- suggest_skill — propose a new skill (no write); Plan-safe
- write_skill — save to workspace (default) or user scope; not Plan-safe

## Suggesting new skills

After reasoning, if a clear reusable build-quality pattern is not covered, call suggest_skill and wait for confirm before write_skill (unless auto-save was requested). Do not spam.

## Examples

- skills/grok-cli-build — GROK-CLI-BUILD-PROCESS.md discipline
- skills/code-change-checklist — multi-file change checklist
