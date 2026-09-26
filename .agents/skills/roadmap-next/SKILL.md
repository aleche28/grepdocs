---
name: roadmap-next
description: Determine the next task to tackle in the current GrepDocs roadmap phase. Use when the user asks "what's next", "what should I do next", "what's left in this phase", "where do I start", or otherwise asks for the next roadmap task. Grounds the answer in docs/roadmap.md, docs/code-review-checklist.md, docs/api.md, git history, and the actual source tree instead of inventing work.
---

# Roadmap Next

Answer the recurring "what's next?" question with a ranked, repo-grounded recommendation. This is a
**read-only planning** skill — do not edit code, docs, or the roadmap.

## Sources of truth (read these, in this order)

1. `docs/roadmap.md` — the phase plan. The **current phase** is the first phase with unfinished
   work; its `Status:` line and bullets say what is done vs. open. Some phases have no `Status:`
   line yet (Phase 2 does not) — infer status from the bullets and code.
2. `docs/code-review-checklist.md` — open `[ ]` items. The roadmap names which phase depends on or
   exposes each one (e.g. Phase 2 owns D3 token refresh, Phase 8 owns A7 CORS/rate limiting).
3. `docs/api.md` — the target shape for any endpoint involved. Marked **Implemented** vs.
   **Proposed**; build to the proposed shape rather than inventing one.
4. `docs/requirements.md` / `docs/user-stories.md` — product intent, when a task's *why* is unclear.

## Steps

### 1. Establish where we actually are

- Read the current phase from `docs/roadmap.md` (first with open work).
- Run `git log --oneline -15` and `git status --short` to separate **landed** work from
  **uncommitted** work from **promised-but-absent** work. Uncommitted changes count as in-flight,
  not done.
- For each open bullet in the phase, spot-check the source tree (handlers, `database/queries.sql`,
  `dal/`, `providers/`, migrations) to confirm whether it exists. Do not trust the roadmap alone.

### 2. Collect cross-cutting obligations

- List the open `[ ]` checklist items the current phase declares as its responsibility. These are
  not optional extras — the roadmap interleaves them deliberately.
- Note any *new* checklist item the phase's work would naturally close, even if the roadmap doesn't
  name it.

### 3. Rank candidate tasks

For each candidate, weigh:
- **Blocking power** — does other work wait on it? (e.g. a schema/query change blocks handlers.)
- **Dependencies met?** — is it actually startable now, or does it need a seam/table that doesn't
  exist yet?
- **Fit with the phase goal** — favor work that completes the phase over opportunistic pull-forward
  of a later phase.
- **Existing partial progress** — finish in-flight work before opening a new front.

### 4. Output

Produce a concise recommendation with these sections:

- **Current phase** — name and a one-line status (what's done, what's left).
- **Recommended next task** — the single next thing, in imperative form.
- **Why now** — what it unblocks / which open checklist item it closes / why not something else.
- **Files to touch** — concrete paths (migration + `queries.sql` + `dal/` + handler, etc.), noting
  generated-vs-hand-written boundaries.
- **Acceptance criteria** — how the user knows it's done (endpoint behavior, status codes, tests).
- **Also considered / deferred** — 1–3 alternates with a one-line reason each.

Cite `file:line` (or doc + section) for every claim about existing code. If the roadmap and the
code disagree, say so explicitly and recommend which to trust.

## Rules

- **Read-only.** Never write code or edit the roadmap/checklist here — that is
  `phase-status-sync`'s job, and only after the work lands.
- **Never invent tasks** not grounded in the current phase, its checklist items, or `docs/api.md`.
- **Never trust a status line blindly** — verify against `git` and the tree.
- If the current phase looks complete, say so and recommend either its close-out steps
  (update `roadmap.md` + `roadmap-stakeholders.md`) or the first task of the next phase.
- Keep it short: one recommendation, not a menu. Alternates go in the deferred section.
- If the user names a phase or task explicitly, honor that scope instead of re-deriving the current
  phase.
