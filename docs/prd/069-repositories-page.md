# PRD: Repositories page with sync status (#69)

Status: **done** — built on `feat/69-repositories-page`. Milestone: Phase 4 — Read-only MVP. Replaces user stories S2.4, S2.5, S8.2,
S8.3 (UI side) and S8.4 (auto-sync on opening, run by the UI).

## Problem

`/repositories` is a placeholder with one link to the track page (#68). A user who tracked a
repository cannot see whether it synced, start a sync, change the tracked branch, or stop tracking
it. The API already does all of this (`docs/api.md` → Repositories, Sync, Sync status and errors).
Until this page exists, the document tree (#70) and the viewer (#71) have no documents to show
unless a sync is started by hand through the API.

## Goals

- List the tracked repositories with their branch, `sync_status` and `last_sync_at` (S8.2).
- Show each `sync_error` code as a readable message with the action that fixes it (S8.3).
- Start a sync and follow it until it ends, with no reload.
- Change the tracked branch from the branches the provider lists (S2.5).
- Turn `auto_sync` on or off, and make it work: sync those repositories when the app opens (S8.4).
- Untrack a repository after a confirmation (S2.4).

## Non-goals

- **A server-side auto-sync.** The API stores `auto_sync` and nothing reads it. This page runs the
  syncs (D7). A scheduler or webhook-driven sync is not in this phase.
- **A notification outside this page** (an app-shell badge, e-mail). Failures show on this page
  only (D6).
- **Changing a repository's account.** `PATCH` has no `account_id`. A private repository whose
  account was unlinked can only be untracked and tracked again (see Follow-up issues).
- **Filters and pagination** on `GET /repositories` (`provider`, `group`, `has_draft`): still
  proposed in `docs/api.md`.
- **Document counts** per repository, and the document tree: #70.
- **A shared re-link action for every page** (#134). This page knows each repository's account and
  links to its re-link directly, as the track page does.

No API change, migration, or OpenAPI change. One docs fix in `docs/api.md` (see Docs).

## Decisions

| #   | Topic            | Decision                                                                                                                                                                                 |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Layout           | One list on `/repositories`, a row per repository, with *Sync*, *Edit* and *Untrack*. *Edit* (branch and auto-sync) and *Untrack* each open a dialog, like *Unlink* on the accounts page. |
| D2  | Polling          | Poll `GET /repositories` (the shared `['repositories']` query), not `GET /repositories/{id}`: one request covers every busy repository. Only while one is `queued` or `running`.          |
| D3  | Poll interval    | Every 2 s for the first minute of a busy period, then every 10 s. TanStack Query pauses it in a hidden tab. A repository stuck busy until a server restart (`docs/sync-engine.md` → When a repository stays busy) keeps the slow poll. |
| D4  | Branch list      | `GET /repositories/{id}/branches`, fetched only when *Edit* opens: it is a live provider call. The select shows the tracked branch first.                                                |
| D5  | After a branch change | The page starts a sync at once: the `PATCH` resets the status to `pending` and the documents still come from the old branch until a sync replaces them.                            |
| D6  | Failure notice   | A failed row shows its message and action, and a summary at the top says how many repositories failed their last sync. No banner per finished sync: auto-sync can finish ten at once.   |
| D7  | Auto-sync        | Once per page load (a full load is opening the app), the page sends `POST /sync` for every `auto_sync` repository that is idle and can succeed: `pending`, `ok`, or `failed` with `rate_limited` or `internal`. Failures that need the user (re-link, install, branch) are not retried. |
| D8  | Auto-sync label  | The checkbox reads "Sync when I open GrepDocs", the meaning D7 gives it.                                                                                                                 |
| D9  | Error while retrying | `sync_error` is shown only when `sync_status` is `failed`. The API keeps it while a retry is `queued`; the row then shows the queued state.                                          |
| D10 | Delivery         | One PR, UI only, plus the `docs/api.md` fix.                                                                                                                                             |

## UI

### Data

All through TanStack Query and `apiFetch`:

- `['repositories']` ← `GET /repositories` (existing query), with a `refetchInterval` that is a
  function of the data (D2, D3).
- `['providers']` and `['accounts']` (existing queries): the install link and the account names in
  the re-link actions.
- `['repositories', id, 'branches']` ← `GET /repositories/{id}/branches`, only while the edit
  dialog is open.
- Mutations, each writing the returned repository into the `['repositories']` cache and
  invalidating it:
  - `POST /repositories/{id}/sync` (no body);
  - `PATCH /repositories/{id}` with the changed fields only;
  - `DELETE /repositories/{id}`, which removes the row from the cache.

`Repository` in `src/ui/src/api/repositories.ts` gains the fields this page reads: `name`,
`html_url`, `is_private`, `synced_commit`, `sync_status` (a union of the five states), `sync_error`
(`SyncErrorCode | null`, a union of the seven codes, mirrored by hand like `ApiErrorCode`),
`auto_sync` and `last_sync_at`. `Branch` is `{ name, commit, protected }`.

### Layout

```
Repositories                                        [Track a repository]

⚠ 1 repository failed its last sync.

┌──────────────────────────────────────────────────────────────────────────┐
│ acme/docs        Private  main    Synced Nov 25, 2026, 10:12             │
│                                   [Sync] [Edit] [Untrack]               │
│ acme/handbook    Public   trunk   Syncing…                               │
│                                   [Sync] [Edit] [Untrack]               │
│ octocat/notes    Private  main    Sync failed. Last synced Nov 20, 2026  │
│                                   The GitHub App isn't installed on       │
│                                   octocat/notes. Install the GitHub App ↗ │
│                                   [Sync] [Edit] [Untrack]               │
└──────────────────────────────────────────────────────────────────────────┘
```

### List

- **Loading:** "Loading repositories…". **Failure:** `ApiErrorMessage` with *Try again*.
- **Empty:** "You don't track any repository yet." with the *Track a repository* link.
- **Rows:** `full_name` linking to `/repositories/{id}` (the document tree, #70), a link to
  `html_url` (new tab), Public/Private, the tracked branch, the status, and the actions. Sorted by
  `full_name`, so a row does not move when its status changes.
- **Status:**

| `sync_status` | Shown                                                                |
| ------------- | -------------------------------------------------------------------- |
| `pending`     | "Not synced yet"                                                     |
| `queued`      | "Waiting to sync…"                                                   |
| `running`     | "Syncing…"                                                           |
| `ok`          | "Synced <last_sync_at>"                                              |
| `failed`      | "Sync failed." + "Last synced <last_sync_at>" when set + the message |

  Dates are formatted with `Intl.DateTimeFormat` (`dateStyle: 'medium', timeStyle: 'short'`),
  in the user's locale. An unknown status shows as `pending`.

- **Summary (D6):** "N repositories failed their last sync." (singular for one), above the list,
  while any row is `failed`. Not dismissible: it goes away when the failures do.

### Sync error messages

| `sync_error`             | Message                                                                                  | Action                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `reauth_required`        | "GitHub no longer accepts the access of @octocat."                                        | "Re-link @octocat" (`relinkUrl`); with no account, "Link a GitHub account" to `/settings/accounts` |
| `resource_not_found`     | "GitHub can't find acme/docs or its branch main any more."                                | *Change branch* (opens Edit), or untrack                      |
| `app_not_installed`      | "The GitHub App isn't installed on acme/docs."                                            | "Install the GitHub App" (`install_url` of the provider; text only when null) |
| `rate_limited`           | "GitHub's rate limit was reached. Try again later."                                       | *Sync*. With no account and a public repository, also: "Repositories tracked without an account share a low limit. Track it from a linked account to avoid this." |
| `truncated_tree`         | "acme/docs has too many files for GitHub to list at once. This isn't supported yet."      | none                                                          |
| `provider_not_supported` | "GitHub isn't available on this server."                                                  | none                                                          |
| `internal`, unknown code | "The sync failed. Try again; if it keeps failing, report it."                             | *Sync*                                                        |

"GitHub" is the provider's `display_name` from `GET /providers`, or the raw `provider` when it is
not listed. "@octocat" is `accountName()` of the repository's account.

### Sync

- *Sync* is disabled while the repository is `queued` or `running`, and while its own request is
  pending; it reads "Syncing…" then.
- `202`: the returned repository (`queued`) replaces the row in the cache, which starts the poll.
- `409 conflict` (already busy, e.g. from another tab): no message; `['repositories']` is refetched
  and the row shows the busy state.
- `404 not_found`: error banner "acme/docs is no longer tracked."; the list is refetched.
- `503 service_unavailable`: error banner "Too many syncs are waiting. Try again in a minute."
  (`retryAfterText(retryAfter)`, which `src/ui/src/pages/track/messages.ts` already has; it moves
  to a shared module).
- Anything else: `ApiErrorMessage` titled "Could not sync acme/docs".

Banners follow the track page: one at a time, replaced by the next, dismissible.

### Edit dialog

Title "Edit acme/docs". Mounted only while open (as `UnlinkDialog`), so branches are fetched only
then.

- **Branch:** a `<select>` of the branches, the tracked one selected. While loading: the tracked
  branch alone, disabled, with "Loading branches…". If the tracked branch is not in the list (it
  was deleted upstream), it stays as the first option, labelled "main (not found on GitHub)".
- **Branch list failures** (the rest of the dialog stays usable, the select keeps the tracked
  branch only):

| Response                      | Shown                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `403 forbidden`               | "GitHub no longer accepts the access of @octocat." + re-link link; with no account, "Link a GitHub account to read this repository." + link to `/settings/accounts` |
| `409 conflict`                | "This private repository's account was unlinked, and you have several GitHub accounts. Untrack it and track it again from the account to use." |
| `404 not_found` with `install_url` | "GitHub can't find acme/docs, or the GitHub App isn't installed on it." + install link |
| `404 not_found`               | "GitHub can't find acme/docs any more."                                                    |
| `429 rate_limited`            | "GitHub's rate limit was reached." + `retryAfterText` + *Try again*                        |
| anything else                 | `ApiErrorMessage` with *Try again*                                                          |

- **Auto-sync:** a checkbox "Sync when I open GrepDocs" (D8).
- **Save** sends `PATCH` with only the fields that changed; with none, it just closes. While
  pending: "Saving…", both buttons disabled. **Cancel** and Esc close without saving.
- `200`: the dialog closes; if the branch changed, the page sends `POST /sync` (D5) and handles its
  outcome as a *Sync* click. A success banner says "acme/docs now tracks release." or "Saved."
  (auto-sync only).
- `PATCH` failures stay in the dialog: the same table as the branch list, plus `400 bad_request`
  ("The branch release no longer exists on GitHub.", and the branches are refetched).

### Untrack dialog

"Stop tracking acme/docs?" — "Its synced documents are removed from GrepDocs. Nothing changes on
GitHub." with *Untrack* (danger) and *Cancel*. Focus starts on *Cancel*.

- `204`: the dialog closes, the row leaves the cache, a success banner says "acme/docs is no longer
  tracked." and focus moves to it (the row that had it is gone).
- `404`: the same as `204` (already untracked elsewhere), and the list is refetched.
- Anything else: `ApiErrorMessage` in the dialog.

### Auto-sync on opening (D7)

- Runs once the first `GET /repositories` succeeds, and once per page load: the flag is kept per
  `QueryClient` (a module-level `WeakSet`), so `StrictMode`'s double effects and moving between
  pages do not repeat it, and every test (a fresh client) starts clean.
- Sends the `POST /sync` requests in parallel. `202` and `409` are silent (the rows show it). If any
  answers `503`, one error banner: "Automatic sync couldn't start for N repositories: too many
  syncs are waiting." with *Sync* still available on each row. Other failures are logged to the
  console only and change nothing on screen.
- Opening the app on another page (a document link) does not run it; the index route redirects to
  `/repositories`, so a normal start does.

### As built

The page implements the plan above, with these differences. Where they conflict, this list and the
code win.

- **Branches are not under `['repositories']`.** Their key is
  `repositoryBranchesQueryKey(id)` = `['repository-branches', id]`: every mutation invalidates
  `['repositories']`, which would otherwise call the provider again while the edit dialog is open.
- **The Sync button** reads "Starting…" only while its own request runs; it is disabled while the
  repository is busy, and the status line says "Waiting to sync…" or "Syncing…". With both reading
  "Syncing…" the row repeated itself.
- **The branch select is enabled while the branches load or failed**, with the tracked branch as
  its only option, so it can take focus when the dialog opens. It is disabled only while saving.
  Picking another branch shows "Saving starts a sync of release. Until it ends, the documents still
  come from main."
- **Auto-sync failures other than `503`** change nothing on screen and are not logged to the
  console either.
- **Rows mark auto-sync** with a muted "Auto-sync", so the user sees which repositories sync on
  opening without opening Edit.
- **Wording:** `ok` without `last_sync_at` reads "Synced". The `rate_limited` hint for a repository
  without an account says "Untrack it and track it again from a linked account", since a tracked
  repository cannot change its account. `reauth_required` with no known account reads "GitHub no
  longer accepts the access of the account this repository syncs with." with "Link a GitHub
  account". A `403` on the branches with no account links "Go to linked accounts".
- **A generic sync failure** (`ApiErrorMessage`, "Could not sync acme/docs") has no dismiss
  button, as on the track page; the next outcome replaces it.
- **Shared code:** the dialog behaviour (`showModal`, focus return, no closing while a request
  runs) moved from `UnlinkDialog` to `src/components/Dialog.tsx`, which the three dialogs use, and
  `retryAfterText` / `installUrlOf` moved from `pages/track/messages.ts` to
  `src/components/errorText.ts`. Provider failures of the edit dialog are one component,
  `pages/repositories/ProviderError.tsx`.
- **Tests:** the poll interval and the polling itself are tested on the hooks
  (`api/repositories.test.tsx`), with fake timers; the page tests follow a sync with fake timers
  too. Fixtures (`repository()`, `mockRepositoriesApi`) are in `src/test/repositories.tsx`, and the
  track page fixtures build on them.

## Tests

Vitest + Testing Library + MSW, through `renderRoute`, endpoints from `apiUrl()`:

- `src/ui/src/api/repositories.test.tsx`: the sync, update and untrack mutations' requests and
  their effect on the `['repositories']` cache; the poll interval for idle, busy, and long-busy data.
- `src/ui/src/pages/RepositoriesPage.test.tsx`: loading, empty, failure; rows and every status;
  every `sync_error` message and action; the failure summary.
- `RepositoriesPage.sync.test.tsx`: *Sync* `202` then polling to `ok` and to `failed` (fake timers
  or short intervals), `409`, `404`, `503`, generic error; auto-sync on opening (which repositories
  get a request, once only, the `503` banner).
- `RepositoriesPage.edit.test.tsx`: branches loading, the missing tracked branch, each branch-list
  failure, saving only the changed fields, nothing changed, the sync after a branch change, `400`.
- `RepositoriesPage.untrack.test.tsx`: confirm, cancel, `204`, `404`, error.

## Docs

- `docs/api.md` → Repositories: `DELETE` also deletes the repository's documents (`ON DELETE
  CASCADE` in `000007`); the sentence saying it only removes the row is out of date.
- `AGENTS.md`: the repositories page in the list of what the UI tests cover.
- This PRD: an "As built" section with any differences.
- `docs/roadmap.md` / `docs/roadmap-stakeholders.md`: run `phase-status-sync` once it lands.

## Acceptance criteria

1. `/repositories` lists every tracked repository with its branch, status, and last sync time.
2. *Sync* queues a sync, the row shows it waiting and running, then synced or failed, with no
   reload.
3. Every `sync_error` code shows a readable message, and the ones the user can fix link to the fix
   (re-link, install, change branch).
4. Any failed repository is announced at the top of the page.
5. *Edit* lists the branches, changing the branch saves it and starts a sync, and auto-sync can be
   turned on and off.
6. With auto-sync on, opening the app syncs that repository once, not on every visit to the page.
7. *Untrack* asks first, then removes the repository.
8. `make ui-ci` passes, with the new tests.

## Risks and things to verify manually

- **Anonymous rate limit:** auto-sync on opening can spend the shared 60 requests per hour on
  public repositories tracked without an account (#99). Check a page load with several of them.
- **Queue size:** auto-sync sends one request per repository at once. Check what a user with more
  repositories than the queue holds sees (the `503` banner).
- **A stuck repository** keeps the 10 s poll for as long as the page is open. Acceptable for the
  MVP; a `sync_started_at` in the DTO would let the page say "taking longer than usual".
- **Branch names differing only in case:** `PATCH` compares the new branch with
  `strings.EqualFold`, so changing `main` to `Main` (a different branch on GitHub) is silently
  ignored. Rare; see Follow-up issues.

## Follow-up issues

To propose (not created yet):

- `fix(api): tracked_branch change ignores a branch that differs only in case` — `PATCH` uses
  `strings.EqualFold`; git branch names are case-sensitive.
- `feat(api): change the account of a tracked repository` — `PATCH account_id`, so a private
  repository whose account was unlinked can be moved to another one instead of re-tracked (the
  `409` above).

Related open issues: #70 (document tree), #99 (anonymous rate limits), #134 (shared re-link on
`403`).
