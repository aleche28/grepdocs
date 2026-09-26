---
name: implementation-review
description: Review the user's hand-written implementation for correctness, security, repo conventions, and learning value. Use when the user asks to "review my implementation", "review my code", "check what I wrote", "did I do this right", or shows a diff/PR and wants feedback. Teaching-first — explains mistakes and the idiomatic pattern instead of silently rewriting. Advisory by default; only applies fixes on explicit opt-in.
---

# Implementation Review

The user writes most code by hand and wants to learn from mistakes. Your job is to find problems
**and teach** — explain the trap, why it bites, and how the repo already handles it. Rewriting the
code for them defeats the purpose.

Read `REVIEW-RUBRIC.md` (same directory) before reviewing. It is the checklist; this file is the
process.

## Steps

### 1. Determine scope

- Default: `git diff` against the base branch plus `git status --short` (so uncommitted work is
  included). Clarify the base if it's ambiguous (e.g. `main` vs. a feature branch).
- If the user names files/commits, review exactly those.
- If the diff is empty, say so and ask what to review rather than reviewing the whole tree.
- Read the full file(s) touched, not just the diff hunks — context in the surrounding function
  often decides whether a change is correct.

### 2. Load the standards

- `AGENTS.md` — conventions, deliberate architecture decisions, known inconsistencies.
- `REVIEW-RUBRIC.md` — the lenses and their repo-specific patterns.
- `docs/api.md` — target shape/status for any endpoint involved.
- `docs/code-review-checklist.md` — if a finding matches an open `[ ]` item, cite it (e.g. "this is
  C7").

### 3. Review each change against the rubric

Walk the six lenses in `REVIEW-RUBRIC.md`: security & authorization, correctness, HTTP contract,
architecture & conventions, DAL/migrations/generated code, testing & quality. Skip lenses a change
doesn't touch; don't pad.

For each finding use the format in the rubric:

```
[Category] [Severity] file.go:123 — short title
Why: ...
Pattern: the existing correct usage (file:line)
Fix: prose; offer a diff, don't apply it
```

Rules for findings:
- **Ground every finding** in a concrete failure mode or a stated repo rule. No style nits dressed
  up as bugs; if it's taste, say so and mark it low.
- **Check the deliberate-absences list** in the rubric before flagging architecture — do not
  "correct" the project toward patterns it intentionally rejected.
- **Distinguish a real bug from a robustness nit** by severity, and say what input/race triggers it.
- If you're unsure whether something is a bug, say so and describe how to verify rather than
  asserting.

### 4. Close the review

Order the output:

1. **Findings** — high severity first.
2. **What went well** — specific and genuine (a non-finding is still feedback).
3. **Priority order** — the 2–3 to fix first.
4. **Teaching points** — the 1–2 transferable lessons that generalize beyond this diff. This is the
   part the user values most, so make it concrete, not platitudes.

### 5. Offer, don't apply

End by asking whether to apply any fixes. Do not edit files until the user opts in with an explicit
"apply"/"fix it"/"go ahead". When applying, change only the agreed findings, then run the quality
gates (`make test`, whole-module `gofmt -l .` + `go vet ./...`).

## Rules

- **Advisory by default.** Never silently fix code during review.
- **Teach, don't rewrite.** A finding that shows the fix *and* the pattern is worth ten applied
  patches.
- **Do not fabricate problems.** If the code is correct, say so — a clean review is a valid result.
- **Respect the deliberate architecture.** See the rubric's deliberate-absences list.
- **Cite the standard** (AGENTS.md rule, checklist item, api.md section) so the user can re-derive
  the conclusion next time.
- If the diff spans multiple concerns, review them in dependency order (schema → query → generated
  code → handler), since later mistakes are often caused by earlier ones.
