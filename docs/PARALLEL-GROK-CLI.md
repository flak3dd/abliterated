# Parallel Grok CLI for completeness

**Product rule:** Abliterated owns the bridge and **unrestricted / uncensored** model path. Optional **Grok CLI** (xAI `grok`) may run **in parallel** only for structural completeness — tests, docs, scaffolding, review checklists. It must **never** become the source of truth for unrestricted answers.

**Related:** [GROK-CLI-BUILD-PROCESS.md](./GROK-CLI-BUILD-PROCESS.md) · [SKILLS.md](./SKILLS.md) · bundled skill `skills/deepen-complete-response`

---

## Who owns what

| Concern | Owner |
| --- | --- |
| Bridge tools, Plan gates, Jobs, unrestricted model replies | **Abliterated** |
| Extra structural pass (tests, types, docs shape, file tree) | Optional **Grok CLI** in a **separate git worktree** |
| Deepen / fill functional gaps without calling censored CLIs | Abliterated **self-deepen** + `deepen-complete-response` skill |

**DO NOT:**

- Merge refusal-shaped rewrites of unrestricted content from Grok (or any censored CLI) into Abliterated answers or product prompts.
- Point Abliterated’s unrestricted claims at the xAI Grok API as a provider.
- Run two agents that thrash the **same** working tree — prefer worktrees.

---

## Preferred layout: git worktrees

From the repo root (example paths):

```bash
# Main tree stays on your Abliterated agent / Jobs workspace
git worktree add -b grok-structure ../abliterated-grok-structure HEAD

# Run Grok CLI only in the sibling worktree
cd ../abliterated-grok-structure
# grok …   # tests / docs / scaffolding only

# Cherry-pick structural commits back (review diffs; drop refusal rewrites)
cd ../abliterated   # or your Abliterated worktree
git cherry-pick <sha>   # one structural commit at a time
```

Tips:

- Keep unrestricted content edits on the Abliterated worktree only.
- If Grok “completes” an answer by refusing or softening, **discard** that hunk — do not merge it.
- Remove the worktree when done: `git worktree remove ../abliterated-grok-structure`.

---

## In-product deepen (no Grok)

When the user wants a fuller functional response **without** calling external censored CLIs:

1. Toggle **Completeness** in the Chat header/composer (persists as `deepenCompleteness`), or enable **Settings → Deepen for completeness (Abliterated-only)** — keep **Self-deepen answers** on with passes ≥ 1 for automatic passes.
2. Or use Chat **Deepen now** (mid-run inject / follow-up) without hunting Settings.
3. Or invoke the bundled skill **Deepen complete response** (`skills/deepen-complete-response`).
4. Or enqueue a Job with the preset **Deepen for completeness (Abliterated-only)** (also turns `deepenCompleteness` on).

Helpers live in `src/lib/deepenComplete.ts` (wired into self-deepen nudges and optional Jobs system text). Extra deepen API turns run **only** when self-deepen is on; the completeness checklist injects when `deepenCompleteness` is on. Optional parallel Grok stays docs-only / worktree manual — never auto-launched.

---

## Quick checklist

- [ ] Unrestricted answer path = Abliterated model only
- [ ] Optional Grok = separate worktree, structural commits only
- [ ] No refusal-shaped merges into unrestricted content
- [ ] Completeness deepen = Chat Completeness toggle / Deepen now / Settings / skill / Jobs preset — no Grok call
