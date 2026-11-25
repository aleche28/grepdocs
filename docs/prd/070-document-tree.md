# PRD: Browse a repository's documents (#70)

Status: **proposed**. Milestone: Phase 4 — Read-only MVP. Replaces user story S4.3 (navigate
between a repository's documentation files).

## Problem

A user can track and sync a repository (#68, #69) but cannot see what the sync stored:
`/repositories/:repoId` is a placeholder that prints the ID (`src/ui/src/pages/RepositoryPage.tsx`).
The API already lists a repository's documents (`GET /documents?repo_id=`, `docs/api.md` →
Documents), and the repositories page already links each row to this route. Until the tree exists,
the viewer (#71) has no way in other than typing a document ID into the URL.

## Goals

- Show a repository's synced Markdown files as a directory tree, built from `GET /documents`.
- Move between documents with one click, the tree staying on screen while the selected document
  changes (S4.3). The route nesting for this is already in `src/ui/src/router.tsx`.
- Say why there are no documents when there are none: never synced, syncing, the last sync failed,
  or no Markdown files on the branch.
- Show the documents of the latest sync without a reload once a sync ends.

## Non-goals

- **The document viewer** (rendered and raw modes, repository/branch/GitHub link per document):
  #71. This PRD leaves `DocumentPage` as the placeholder it is, and only gives it a slot.
- **Starting a sync, changing the branch, untracking** from this page: they stay on the repositories
  page (#69), which this page links to (D6).
- **Filtering or searching** the tree: search is Phase 7. No client-side filter box either.
- **Opening a default document** (such as the root `README.md`) when no document is selected (D4).
- **Non-Markdown files and the full repository tree** (`GET /repositories/{id}/tree`): Phase 5.
  The tree shows only what the sync stored, which is every `.md` file of the tracked branch.
- **Pagination or virtualization** for very large repositories: `GET /documents` has no pagination
  yet (see Risks).

No API change, migration, or OpenAPI change.

## Decisions

| #   | Topic                 | Decision                                                                                                                                                                                                                            |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Layout                | Two columns on `/repositories/:repoId`: the tree on the left, the `<Outlet />` (the document, #71) on the right. Below a narrow width they stack, the tree first.                                                                    |
| D2  | Repository data       | From the shared `['repositories']` query (`useRepositories`), not `GET /repositories/{id}`: the sync, update and untrack mutations already keep that cache current, and the repositories page has usually loaded it. One request per app load, not one per repository. |
| D3  | Tree markup           | Nested `<ul>` inside a `<nav>`, directories as native `<details>`/`<summary>`, documents as `NavLink`s (which set `aria-current="page"`). No ARIA `tree` widget: it would need its own arrow-key navigation, and links in lists already work with the keyboard and screen readers. |
| D4  | Nothing selected      | `/repositories/:repoId` with no document shows "Choose a document." in the right column. No redirect to a `README.md`: which file is the entry point is the user's call, and the redirect would hide the tree's empty states. |
| D5  | Sorting and expansion | Directories before files, each group sorted with `Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })` (ties broken by plain string order), so `2-setup.md` comes before `10-faq.md`. The API's byte order is not used. Top-level entries are always visible; a directory starts open only when it holds the selected document. |
| D6  | Empty states          | Chosen from the repository's `sync_status` (table below), each with a link to `/repositories` where the sync, the error message and its fix already are. The page does not repeat `SyncError`.                                      |
| D7  | Refresh after a sync  | The page uses `useRepositories({ poll: true })`, so it follows a sync the user started elsewhere, and refetches the documents when the repository's `last_sync_at` changes (it changes only on a successful sync, `docs/sync-engine.md` → transition 5). |
| D8  | Unknown repository    | A `:repoId` that is not a positive integer, or not in the user's repositories, shows "This repository isn't tracked." with a link to `/repositories`. No documents request is sent.                                                  |
| D9  | Delivery              | One PR, UI only.                                                                                                                                                                                                                    |

## UI

### Data

All through TanStack Query and `apiFetch`:

- `['repositories']` ← `GET /repositories` (existing `useRepositories`, with `poll`), for the
  header and the empty states.
- `['documents', { repoId }]` ← `GET /documents?repo_id=<id>`, in a new `useDocuments(repoId)` in
  `src/ui/src/api/documents.ts`. Enabled only once the repository is found (D8).
- `Document` in the same file mirrors the list item of `docs/api.md`: `id`, `sha`, `path`,
  `synced_at`, `repository_id`, `repository`, `provider`, `branch`, `upstream_commit`
  (`string | null`). The detail type with `content` is left to #71.
- `documentsQueryKey(repoId)` is exported, so the untrack mutation (`useUntrackRepository`) can
  remove that repository's documents from the cache with the repository.

### Layout

```
← Repositories

acme/docs   Branch main   Synced Nov 25, 2026, 10:12   GitHub ↗

┌ Documents in acme/docs ──┐  ┌──────────────────────────────────────┐
│ ▾ docs                   │  │                                      │
│   ▸ api                  │  │  (the selected document, #71)        │
│   ▾ guides               │  │                                      │
│     · 2-setup.md         │  │  or "Choose a document."             │
│     · 10-faq.md   ◀ sel. │  │                                      │
│ · CHANGELOG.md           │  │                                      │
│ · README.md              │  │                                      │
└──────────────────────────┘  └──────────────────────────────────────┘
```

### Header

- A "Repositories" link back to `/repositories`.
- `full_name` as the page's `<h1>`, the tracked branch, and the sync status, using the repositories
  page's wording ("Not synced yet", "Waiting to sync…", "Syncing…", "Synced <last_sync_at>",
  "Sync failed."). The status texts and `formatDateTime` are shared rather than copied: move what
  `RepositoryRow` needs for them into a module both pages import.
- A link to `html_url` (new tab), labelled with the provider's display name, as on the row.

### Tree

- Built in a pure function, `buildTree(documents)` → nested directories and files, split on `/`,
  sorted as in D5. Tested on its own (`pages/repository/tree.test.ts`).
- Each file shows its name (with the `.md` extension, as on GitHub) and links to
  `/repositories/:repoId/documents/:id`. Each directory shows its name only.
- The `<nav>` is labelled "Documents in acme/docs".
- Opening a document from a link (a full page load, or a link from another page) opens the
  directories on its path (D5). A directory the user opened or closed keeps that state while the
  page stays mounted; it is not stored.
- A selected document that is not in the list (deleted by a later sync, or an ID from another
  repository) highlights nothing and opens nothing. What the viewer shows for it is #71's call.

### States

| Situation                                         | Left column                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| Repositories loading                              | "Loading…" (the whole page)                                                  |
| Repositories failed                               | `ApiErrorMessage` with *Try again* (the whole page)                          |
| Repository not found (D8)                         | "This repository isn't tracked." + link to `/repositories` (the whole page)  |
| Documents loading                                 | "Loading documents…"                                                         |
| Documents failed                                  | `ApiErrorMessage` with *Try again*                                           |
| No documents, `pending`                           | "acme/docs hasn't been synced yet." + "Sync it from Repositories"            |
| No documents, `queued` or `running`               | "acme/docs is syncing. Its documents appear here when the sync ends."        |
| No documents, `failed`                            | "The last sync of acme/docs failed." + "See what went wrong" → `/repositories` |
| No documents, `ok`                                | "There are no Markdown files on branch main."                                |
| Documents, and the repository `failed` or busy    | The tree, with the header's status saying so: the documents are from the last successful sync. |

An unknown `sync_status` reads as `pending`, as on the repositories page.

### Refresh (D7)

- An effect keeps the `last_sync_at` the documents were loaded with, and invalidates
  `documentsQueryKey(repoId)` when the repository's `last_sync_at` becomes a different non-null
  value. A failed sync leaves `last_sync_at` alone, so it refetches nothing.
- A branch change resets `last_sync_at` to `null` and keeps the old documents until the next sync
  replaces them; the page refetches when that sync ends. Between the two, the tree still shows the
  old branch's files under the new branch's name (see Risks).

## Tests

Vitest + Testing Library + MSW, through `renderRoute`, endpoints from `apiUrl()`:

- `src/ui/src/pages/repository/tree.test.ts`: nesting, directories before files, numeric and
  case-insensitive order, ties, a single file at the root, deep paths.
- `src/ui/src/api/documents.test.tsx`: `useDocuments` sends `repo_id`; untrack removes the
  repository's documents from the cache.
- `src/ui/src/pages/RepositoryPage.test.tsx`: header; the tree and its links; the selected document
  highlighted (`aria-current`) with its directories open; "Choose a document."; every row of the
  States table; an unknown or invalid `:repoId` sends no documents request; navigating between two
  documents keeps the tree mounted (a directory the user closed stays closed); a sync ending with a
  new `last_sync_at` refetches the documents, a failed one does not.
- Fixtures: a `document()` factory and `mockDocumentsApi` in `src/test/documents.tsx`, next to the
  repositories fixtures.

## Docs

- `AGENTS.md`: the repository page in the list of what the UI tests cover.
- This PRD: an "As built" section with any differences, and the status set to **done**.
- `docs/roadmap.md` / `docs/roadmap-stakeholders.md`: run `phase-status-sync` once it lands.

## Acceptance criteria

1. `/repositories/:repoId` shows the repository's synced Markdown files as a tree, directories
   first, in natural order.
2. Clicking a file opens `/repositories/:repoId/documents/:id`, highlights it, and leaves the tree
   as it was.
3. Loading a document's URL directly opens the directories on its path.
4. A repository with no documents says why (never synced, syncing, failed, no Markdown files) and
   links to the repositories page where needed.
5. When a sync of the repository succeeds while the page is open, the tree shows the new documents
   without a reload.
6. An ID that is not one of the user's repositories shows "This repository isn't tracked." and
   sends no documents request.
7. The tree works with the keyboard alone (Tab through links, Enter/Space on directories).
8. `make ui-ci` passes, with the new tests.

## Risks and things to verify manually

- **Large repositories:** `GET /documents` returns every document at once, and the page renders
  them all. Try a repository with a few thousand Markdown files (directories start closed, which
  limits the DOM, but `<details>` still renders its closed content). If it is slow, render a
  directory's children only while it is open.
- **Old branch under the new name:** between a branch change and the next successful sync, each
  document's `branch` is the new tracked branch (it is joined from `repositories`) while the files
  are still the old branch's. The header's "Not synced yet" status is the only hint. A
  per-document branch, or clearing the documents on a branch change, would be an API change.
- **Case-only path differences** (`Docs/` and `docs/`) are two directories on GitHub; the collator
  sorts them next to each other, which is the intended order, but check that they stay separate.

## Follow-up issues

None planned yet. Candidates to propose if the risks above show up in practice: render closed
directories lazily, and clear or mark a repository's documents on a branch change.

Related open issues: #71 (viewer, which fills the right column), #64 (CORS and rate limiting).
