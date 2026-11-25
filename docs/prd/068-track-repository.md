# PRD: Track a repository (#68)

Status: **proposed**. Milestone: Phase 4 — Read-only MVP. Replaces user stories S2.1, S2.2 and S2.3
(UI side).

## Problem

A signed-in user cannot start tracking a repository from the UI: `/repositories/track` is a
placeholder. The API already does the work: `GET /accounts/{provider}/repositories` lists what a
linked account can see, and `POST /repositories` tracks a repository from an account, or a public
one by `owner`/`name`. Until this page exists, every later screen (#69 repositories, #70 document
tree, #71 viewer) can only be tried with repositories tracked by hand through the API.

## Goals

- Pick one of the user's linked accounts and list the repositories it can see (S2.1).
- Filter that list as you type (S2.2).
- Track a repository from the list in one click, on its default branch (S2.3).
- Track a public repository by `owner/name`, with no linked account.
- Show which listed repositories are already tracked.
- Turn every failure the user can act on into that action: install the GitHub App, re-link the
  account, wait out a rate limit.

## Non-goals

- **Choosing the branch.** A repository is tracked on its default branch. Changing it is a `PATCH`
  on the repositories page (#69), which also lists the branches. There is no endpoint that lists
  the branches of a repository before it is tracked.
- **Triggering a sync.** Tracking does not queue one. The sync button and status are #69.
- **Server-side filtering and pagination** (`?q=`, `?private=`, `?type=` on
  `GET /accounts/{provider}/repositories`): still proposed in `docs/api.md`, out of this phase.
- **The API's `tracked` marker** on discovered repositories: still proposed. The page computes it
  (D4).
- **A shared re-link action for every page** (#134). This page knows the account it uses, so it
  links to its re-link directly (D6); #134 can absorb that when it lands.
- **Anonymous rate limits** for public repositories (#99).

No API change, migration, or OpenAPI change.

## Decisions

| #   | Topic                 | Decision                                                                                                                                                         |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Branch                | Track on the default branch: `POST /repositories` without `tracked_branch`. The success message names the branch, and changing it is #69.                          |
| D2  | After tracking        | Stay on the page: a success banner with a link to the repositories page, and the row turns into "Tracked". Lets the user track several in a row; `/repositories` is a placeholder until #69. |
| D3  | Selected account      | Kept in the URL as `?account_id=N`, so a reload or the back button keeps it. With exactly one linked account, it is selected without a parameter.                 |
| D4  | Already tracked       | Computed on the client: a listed repository is tracked when `GET /repositories` has one with the same `provider` and `provider_repo_id` (the API's uniqueness key). |
| D5  | Filter                | Client-side, case-insensitive substring match on `full_name`, no request per keystroke. Not kept in the URL.                                                      |
| D6  | `403 forbidden`       | On this page it always means the selected account's token no longer works (both endpoints answer it only for that), so it becomes a re-link link for that account. |
| D7  | Public repositories   | A separate form with one `owner/name` field, sent without `account_id`. A private repository must come from an account's list.                                    |
| D8  | Providers             | Accounts and the public form use the providers from `GET /providers`. With GitHub as the only one, no provider choice is shown.                                    |
| D9  | Delivery              | One PR, UI only.                                                                                                                                                  |

## UI

### Data

All through TanStack Query and `apiFetch`:

- `['providers']` ← `GET /providers` and `['accounts']` ← `GET /accounts` (existing queries).
- `['repositories']` ← `GET /repositories` (existing query, shared with #67 and #69), for D4.
- `['accounts', accountId, 'repositories']` ← `GET /accounts/{provider}/repositories?account_id=N`,
  only once an account is selected. The key starts with `['accounts']`, so the invalidation that
  unlink already does also drops it.
- Mutation `POST /repositories` with `{ provider, owner, name, account_id? }`. On success it adds
  the new repository to the `['repositories']` cache and invalidates that query.

Types in `src/ui/src/api/repositories.ts`: `AccountRepository` (the discovery item: `provider`,
`provider_repo_id` as a string, `name`, `full_name`, `html_url`, `is_private`, `default_branch`),
and `Repository` gains the fields this page reads (`provider_repo_id`, `default_branch`,
`tracked_branch`).

### Layout

```
Track a repository

From a linked account
  Account  [@octocat ▾]

  [Filter repositories…        ]
  ┌───────────────────────────────────────────────┐
  │ acme/docs        Public   main      [Track]   │
  │ acme/handbook    Private  main      Tracked   │
  │ octocat/notes    Private  trunk     [Track]   │
  └───────────────────────────────────────────────┘
  Don't see a repository? Manage the GitHub App's repository access ↗

A public repository
  [owner/name               ] [Track]
```

### Account section

- **No linked account:** "Link a GitHub account to track its repositories, or track a public
  repository below." with a link to `/settings/accounts`. The public form stays usable.
- **One account:** selected automatically.
- **Several accounts:** a `<select>` of `@<provider_login>` (or "GitHub account
  <provider_user_id>" when the login is null, as on the accounts page), with no account selected
  until the user picks one. Picking sets `?account_id=` with `replace`.
- **`?account_id=` naming no linked account** (unlinked meanwhile, or typed by hand): treated as no
  selection.
- **Selected account has `needs_relink: true`:** "This account's access expired." with a re-link
  link (`relinkUrl`), and its repositories are not requested.

### Repository list

- **Loading:** "Loading repositories…".
- **Rows:** `full_name` (linking to `html_url`, new tab), Public/Private, default branch, and
  *Track*, or the text "Tracked" for a repository already tracked (D4). While `GET /repositories`
  is loading or failed, every row shows *Track*; a `409` covers the rest.
- **Filter:** shown with a list of one or more repositories. No match: "No repositories match
  “…”."
- **Empty list `[]`** (the app is installed but no repository is selected): "The GitHub App can't
  see any repository of this account yet." plus the install link.
- **Install link** under the list: "Manage the GitHub App's repository access", opening the
  provider's `install_url` in a new tab (`rel="noopener noreferrer"`). Hidden when it is null.
- **Failures** of the list:

| Response                | Shown                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `403 app_not_installed` | "Install the GitHub App to choose which repositories GrepDocs can see." + link to `details.install_url` (text only when absent) |
| `403 forbidden`         | "GitHub no longer accepts this account's access." + re-link link (D6)                              |
| `429 rate_limited`      | "GitHub's rate limit was reached. Try again in N minutes." (`retryAfter`; without it, "later") + *Try again* |
| anything else           | `ApiErrorMessage` with *Try again*                                                                  |

### Public repository form

- One text field, label "Public repository", placeholder `owner/name`, trimmed. Valid when it is
  `<owner>/<name>` with GitHub's characters (owner: letters, digits, `-`; name: letters, digits,
  `.`, `_`, `-`). Otherwise "Enter the repository as owner/name." and no request.
- *Track* sends `{ provider: "github", owner, name }`. The field clears on success.

### Tracking outcome

One message at a time, at the top of the page, replaced by the next one. The *Track* button being
used shows "Tracking…", and every *Track* button is disabled until the request ends.

| Response                         | Shown                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `201`                            | Success banner: "Tracking acme/docs on main. [View your repositories](/repositories)". The row shows "Tracked". |
| `409 conflict`                   | Error banner: "acme/docs is already tracked." `['repositories']` is refetched, so the row shows "Tracked". |
| `404 not_found` with `install_url` | Error banner: "GitHub can't find acme/docs, or the GitHub App isn't installed on it." + install link.     |
| `404 not_found` (public form)    | Error banner: "No public repository acme/docs on GitHub. For a private one, link an account that can see it and pick it from the list." |
| `403 forbidden`                  | Error banner: "GitHub no longer accepts this account's access." + re-link link (D6).                        |
| `429 rate_limited`               | Error banner with the wait, as for the list.                                                              |
| anything else                    | `ApiErrorMessage` titled "Could not track acme/docs".                                                     |

Banners are dismissible (`Banner`: `status` for success, `alert` for failures). After a success,
focus moves to the banner, since the button that had it is gone.

### Entry points

- The repositories page placeholder gets a "Track a repository" link to `/repositories/track`
  (#69 builds the rest of the page around it).
- The accounts page already links here after a new link (#67, D13).

## Tests

Vitest + Testing Library + MSW, through `renderRoute`, endpoints from `apiUrl()`:

- `src/ui/src/api/repositories.test.tsx`: the track mutation's body with and without an account,
  and the `['repositories']` cache after a success.
- `src/ui/src/pages/TrackRepositoryPage.test.tsx`:
  - no account, one account (auto-selected), several (nothing requested until one is picked,
    `?account_id=` honoured and set), an unknown `?account_id=`;
  - `needs_relink` account: re-link link, no repositories request;
  - list rows, "Tracked" rows, the filter and its no-match message, the empty list;
  - each list failure in the table above;
  - tracking from the list: `201`, `409`, `404` with the install link, `403`, and a generic error;
  - the public form: invalid input sends nothing, `201`, `404`.

## Docs

- `AGENTS.md`: the track page in the list of what the UI tests cover.
- This PRD: an "As built" section with any differences.
- `docs/roadmap.md` / `docs/roadmap-stakeholders.md`: run `phase-status-sync` once it lands.

## Acceptance criteria

1. With one linked account, opening `/repositories/track` lists its repositories, and the ones
   already tracked show "Tracked".
2. With several accounts, picking one lists its repositories, and a reload keeps the selection.
3. Typing in the filter narrows the list without a request.
4. *Track* creates the repository on its default branch; the page says so, links to the
   repositories page, and the row shows "Tracked".
5. Tracking a public repository by `owner/name` works with no linked account. An invalid entry is
   refused before any request.
6. An account whose app is not installed, a revoked token, and a rate limit each end on their
   action (install link, re-link link, wait), never only on a raw message.
7. Tracking an already tracked repository says so instead of failing generically.
8. `make ui-ci` passes, with the new tests.

## Risks and things to verify manually

- **Large accounts:** the API follows GitHub's pagination up to its page cap and returns everything
  at once. Check that a few hundred rows render and filter smoothly; if not, render the first N
  matches.
- **Anonymous rate limit:** the public form calls GitHub without a token (60 requests per hour per
  server IP, shared by every user, #99). Check the `429` message with a real limit.
- **Renamed repository:** `POST` reads `full_name` from GitHub, which follows renames, so a public
  repository typed by its old name is tracked under its new one. The success message uses the
  response's `full_name`, not the typed text; error messages use the typed text.

## Follow-up issues

None new. Related open issues: #69 (change the branch, sync), #99 (anonymous rate limits), #134
(shared re-link on `403`).
