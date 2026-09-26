---
name: phase-status-sync
description: Update the roadmap and review-checklist status after a task or phase lands. Use when the user says a task/phase is done, asks to "close out" or "mark this done", or when roadmap/checklist status looks stale. Syncs docs/roadmap.md, docs/code-review-checklist.md, and docs/roadmap-stakeholders.md with what actually shipped.
---

# Phase Status Sync

Keep the three status docs honest after work lands. These are the repo's memory of what exists, and
they drift silently unless updated at the moment of completion.

This skill **writes docs only** — never code. If the implementation isn't finished, say so and
don't tick anything.

## Files and their conventions

### `docs/code-review-checklist.md`

- One item per checkbox; `[x]` done, `[ ]` open.
- When closing an item, append **how** it was closed (the file/commit/approach), matching the style
  of existing closed items (e.g. "Fixed: ... in `secrets` package").
- Update the `last updated YYYY-MM-DD` line at the top.
- If a finding was only partially addressed, leave `[ ]` but extend the item's text to record the
  remaining work explicitly (as D3/E1 do).
- Only touch items the completed work actually closed. Don't tick adjacent items "while here".

### `docs/roadmap.md`

- Each phase has a **`Status:`** line describing what's done vs. outstanding. Some early phases may
  lack one (Phase 2 currently does) — add or extend it following the Phase 1 phrasing style
  ("Status: **schema + linking + ... done** — ... Still open in this phase: ...").
- Move finished bullets out of the open list (or annotate them `**Done** — ...` inline, as Phase 1
  does for provider abstraction / token encryption).
- Keep checklist cross-references accurate (e.g. "checklist C1", "checklist D3").
- Do not renumber or reorder phases.

### `docs/roadmap-stakeholders.md`

- Non-technical companion, grouped **Now / Next / Later**. It must stay in sync with
  `docs/roadmap.md` — same plan in feature language, no jargon, no file paths.
- When a roadmap phase completes, move its user-facing capability up a bucket if appropriate and
  phrase it as something the user "can do", not something "was built".
- Do not add technical detail; translate. If a phase's work has no user-visible effect yet (e.g.
  token refresh), it may not belong here at all.

## Steps

### 1. Confirm what actually landed

- `git log --oneline -15` and `git status --short` to see committed + uncommitted work.
- Read the changed source (and `database/queries.sql` / migrations if relevant) to confirm the
  feature is real and complete — don't rely on the user's summary alone.
- Run the quality gates if the change is code: `make test`, and whole-module
  `cd src/api && gofmt -l . && go vet ./...`. A status update on failing code is premature.

### 2. Map work → checkbox items → phase bullets

Cross-reference what landed against:
- open `[ ]` items in `docs/code-review-checklist.md` (by category A–E),
- open bullets in the current phase in `docs/roadmap.md`,
- the phase's `Status:` line.

### 3. Edit the three docs

Apply the conventions above. Keep edits surgical: annotate/extend, don't rewrite whole sections.

### 4. Report

List exactly what changed, item by item:
- checklist: which `[ ]` → `[x]`, and which remain open,
- roadmap: which phase status/bullets changed,
- stakeholders: which Now/Next/Later entries moved.

Flag anything the user claimed as done but the code doesn't support.

## Rules

- **Verify before ticking.** Evidence (code + passing gates), not assertion.
- **Docs only, and only the relevant sections.** No drive-by rewrites of unrelated phases.
- **Keep roadmap.md and roadmap-stakeholders.md in sync** in the same pass — never update one
  without the other.
- **Never tick partially-done items** — record the remaining scope instead.
- **Never commit** unless the user explicitly asks. This skill edits docs; committing is a separate
  request.
- If the whole current phase is complete, say so and suggest moving to the next phase (hand back to
  `roadmap-next` for planning).
