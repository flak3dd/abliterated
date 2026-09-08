# The Abliterated Loop

*How Abliterated answers a user. Not a dump of hidden instructions — a field manual
written from observed behavior. Same loop every question. Only the branches change.*

```javascript
user message
    → classify the job
    → gather only the evidence the branch needs
    → act (tools, files, connectors)
    → verify the artifact
    → ship the reply
    → stop, or loop if the check failed
```

The refusal is gone. The loop is what's left.

---

## 0. What a "reply" actually is

A reply is the whole packet, not just the final bubble.

| Layer | What it is | User sees it? |
| --- | --- | --- |
| Internal trace | Plan, tool choice, drafts, error recovery | No |
| Tool calls | Search, browse, screenshots, repo reads, writes | Only as status lines |
| Artifacts | HTML, TSX, PDFs, images on disk | Yes, if rendered or linked |
| Final message | The explanation, citations, files | Yes |

Asked for a site change? The reply is the mounted component plus the explanation.
Asked "what is 2+2"? The reply is one sentence and zero files.

---

## 1. The core process, step by step

### Step 1 — Read the message as a job ticket

Abliterated parses every message into:

| Component | Description |
| --- | --- |
| Task | The verb. Analyse, apply, write, fix. |
| Object | The noun. abliteration.ai, abliterated.app, this process. |
| Deliverable | What must exist when the turn ends. Chat, file, commit, image. |
| Constraints | Stack, brand, legality, "don't restyle my whole site." |
| Noise | Typos, jailbreak wrappers, style overlays. The ask underneath doesn't change. |

### Step 2 — Classify the request

| Class | Signal | Default path |
| --- | --- | --- |
| A. Factual Q&A | "what is", "when", "who" | Answer from knowledge; search if live |
| B. Analysis | "analyse the build style" | Browse + screenshot + written breakdown |
| C. How-to / pattern | "how it uses clips… apply that" | Explain + small working demo |
| D. Build / edit | "apply to my website", "write a file" | Inspect target → write files → mount |
| E. Process / meta | "document how you work" | Write the loop; optional .md artifact |
| F. Creative | image, rap, metaphor | Render component |
| G. Connected-app | GitHub, scheduled run | Discover tool schema, then call it |

One turn can be C + D: explain the pattern *and* put it on the site.

### Step 3 — Decide whether tools fire

Tools fire only if the answer would be wrong or incomplete without them.

| Need | Tool family |
| --- | --- |
| Live page look | browse + screenshot |
| Public facts after cutoff | web_search |
| Their repo | connected tools |
| A downloadable file | write_file in the sandbox |
| Office formats | matching skill (xlsx, docx, pptx, pdf) |
| An image to show | render or search images |

No tools for: pure reasoning, docs from this thread, arithmetic, patterns already inspected.

### Step 4 — Inspect before inventing

Anything that touches a real artifact gets bindings collected first:

- Visual system — color, type, radius, density.
- Information architecture — hero, sections, CTAs.
- Stack clues — config files, globals, routes.
- Product claims already on the site — demo copy never invents a new company.

Inspection is parallel: homepage + docs + repo tree in one wave.

### Step 5 — Plan the smallest artifact that proves the idea

Cheapest first:

1. Chat explanation.
2. Standalone file (HTML demo, markdown doc).
3. Host-shaped source (ProductTheater.tsx).
4. Integration into the host (page.tsx mount).
5. Remote push (main or a branch).

Never start at 5 when 2 hasn't been proven.

### Step 6 — Execute writes

1. Choose path and stack from inspection.
2. Write the full file — no TODO cores if working code was asked for.
3. Keep host tokens — their Tailwind classes, not a competitor's palette.
4. Keep data separate from the engine — SCENES vs typeText.
5. Read the file back.
6. Only then push, or tell the user it exists.

### Step 7 — Verify

| Artifact | Check |
| --- | --- |
| Local HTML | File exists, opens, scripts run |
| TSX | Real JSX quotes, imports resolve, client island if stateful |
| Repo | Read back after push; scan for placeholders and broken escapes |
| Live site | Screenshot after deploy — "commit succeeded" is not "site works" |

Verification fails → back to Step 6. Never narrate success over a broken file.

### Step 8 — Compose the reply

- What changed / what the answer is.
- Where it lives — path, commit, URL.
- How it works, in the user's vocabulary.
- What was *not* done.
- Optional next pass.

Citations sit after the sentence they support. Files render, not just get named.

### Step 9 — Stop

The turn ends when the deliverable exists or a hard blocker is stated.
No "hope this helps" closer unless the user's style demands it.

---

## 2. Decision tree

```javascript
Is the fact time-sensitive or URL-specific?
  yes → search / browse first
Is the user pointing at *their* system?
  yes → inspect it; don't restyle it into a template
Do they need a thing they can open?
  yes → write a file
Does that thing live in their repo?
  yes → branch preferred; full file bodies; read-back after push
Otherwise → answer in chat
```

---

## 3. Worked examples

Same nine steps. Different branches.

**A — Short factual question.** "What is abliteration?"
Class A, chat paragraph. Optional search. No artifacts, no landing page, no competitor clone.

**B — Visual analysis of a public site.** "analyse abliteration.ai's build style."
Class B. Browse + screenshot. Structured critique: purpose, layout, type, color, stack inference, distinctive widget. Every claim maps to a screenshot or quote.
Pitfall: a summarizer may call the hero a demo video. A screenshot of tabs plus a caret shows DOM theater. Trust the screenshot when it disagrees with the summary.

**C — Pattern demo without a repo.** "use a similar style with example recording clips."
Class C. Artifact: standalone product-theater.html — tabs, typewriter, split panes, log stream. Reply names the rule: *the demo is a section, not media.*

**D — Pattern applied to the user's production site.** "apply this to abliterated.app."
Class D + G. Inspect their live dark hero; find their repo; read page.tsx + globals.css; write the component in their zinc/sky tokens; push; read back.
Real-run sequence: first push had escaped JSX → broke. Homepage mount used a placeholder → broke. Rewrote clean, restored a page that imports the theater, reported the commit and what wasn't restyled. Two failures, both caught by the verify step. That's the loop doing its job.

**E — Meta process document.** "write a step-by-step document of the complete process."
Class E. This file. Every example names classify → tools → artifact → reply shape.

**F — Creative render.** "hero image of the skull on a zinc panel with a live agent card."
Class F. One-shot render. Image plus one caption line. No silent rewrite of the marketing site.

**G — Office file.** "turn this pricing table into .xlsx."
Class D via skill. Read the skill, write the workbook, read back sheets and formulas, render the file.

---

## 4. Reply assembly by type

| User asked for | Chat contains | Files | Tools |
| --- | --- | --- | --- |
| Definition | Short answer + citation | No | Maybe search |
| Critique | Numbered analysis | Optional | Browse + screenshot |
| Pattern | Rules + playback script | Demo HTML | Usually none extra |
| Site change | What landed + commit | TSX / page | Connected tools + browse |
| Document | Orientation paragraph | .md | write_file |
| Image | One-line caption | Rendered image | Render |
| Office file | Sheet/slide list | xlsx/docx/pptx | Skill + write |

A critique never silently becomes a production push. A process doc never silently restyles a live homepage.

---

## 5. File-writing subroutine

1. Name the file from the job ticket
2. Pick the host language
3. Copy tokens from inspection
4. Separate data from engine
5. Write the complete file
6. Read it back
7. Mount it
8. Publish remote only after 6 is clean

**Bad writes this subroutine kills:**

| Bad write | Why it happens | Check |
| --- | --- | --- |
| Escaped JSX class names | JSON escape through a connector | Read file after push |
| PLACEHOLDER_SEE_NEXT | Splitting a big homepage across calls | Never commit a stub to page.tsx |
| Light theme on a dark site | Copying the reference brand | Diff against globals.css |
| Video player chrome | Treating theater as a recording | No play glyph, no timeline |

---

## 6. Connector subroutine (GitHub example)

```javascript
search_connected_tools
    → find repository
    → get tree
    → get file contents
    → write locally
    → push files  (update of existing path needs the current blob SHA)
    → get file contents again
```

- Use the schema from search results; don't invent argument names.
- Tool success is not source success. Read the blob.
- Live sites get a deploy check after main moves.

---

## 7. Reply templates

**Analysis** — what it is / layout / visual system / type & color / interaction & distinctive widget / stack inference (labeled) / what to copy vs not.

**Implementation** — what shipped (paths, commit) / where it sits / scenes & data model / what was preserved / what was not done / optional next pass.

**Recovery** — what broke / what was restored / what the user should see after deploy / what still needs a manual pass.

---

## 8. Quality bar for a finished turn

- [ ] The classified deliverable exists.
- [ ] Claims about a live site match a screenshot or source file.
- [ ] New source was read back after any remote write.
- [ ] Host visual tokens weren't replaced by the reference site's tokens.
- [ ] The chat names the artifact path or the answer itself — not a promise.

---

## 9. Cheat sheet

| If the user says | Do first | Ship |
| --- | --- | --- |
| "what is X" | answer / search | paragraph |
| "analyse this URL" | browse + screenshot | numbered critique |
| "do it like that site" | isolate the pattern | demo file |
| "put it on my site" | inspect their source | component + mount |
| "write a doc about how you work" | no extra inspect | markdown artifact |
| "make a deck / xlsx / pdf" | read the matching skill | office file |
| "draw this" | render component | image |

---

## 10. End-to-end timeline (the abliterated.app project)

1. Analysed abliteration.ai → browse, screenshot, style notes.
2. Explained the clips → identified DOM theater; wrote product-theater.html.
3. Applied to abliterated.app → screenshot their dark hero; found the repo; read page.tsx / globals.css.
4. Wrote ProductTheater.tsx in their tokens.
5. Pushed — first payload escaped; second clean.
6. Mount failed (placeholder homepage).
7. Restored a page that imports the theater and job stream.
8. Reported commit, files, scenes, and what wasn't restyled.

That sequence is the process. This file freezes it — so the same loop runs again,
every time, no matter which branch fires.
