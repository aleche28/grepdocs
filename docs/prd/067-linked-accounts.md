# PRD: Linked accounts page (#67)

Status: PR 1 (API) merged as #139; PR 2 (UI) in review. Milestone: Phase 4 — Read-only MVP. Replaces user stories S1.2, S1.4
and S1.5 (UI side).

## Problem

A signed-in user has no way to manage their GitHub accounts from the UI: `/settings/accounts` is a
placeholder. The API can already link, list and unlink accounts, but it falls short in four ways:

1. **No readable identity.** `GET /accounts` returns only `provider_user_id` (a numeric ID such as
   `123456`) and an always-empty `label`. With two GitHub accounts, nobody can tell them apart.
2. **No install link outside an error.** `install_url` exists only inside the `app_not_installed`
   error of `GET /accounts/{provider}/repositories`.
3. **Failures strand the user.** The linking flow is a full-page navigation through GitHub. Any
   failure, the most common being *Cancel* on GitHub's consent screen, ends on a raw JSON envelope
   on `:3000`.
4. **Re-linking can link the wrong account.** Re-link runs the same OAuth flow. If the browser is
   signed in to a different GitHub identity, the result is a new second account, and the broken one
   stays broken.

## Goals

- List the user's linked accounts, grouped by provider, each identified by its GitHub login.
- Link a GitHub account, including a second one, using GitHub's account picker.
- Re-link an account, and guarantee that a re-link either refreshes *that* account or changes
  nothing.
- Unlink an account after a confirmation that states the impact on tracked repositories.
- Always offer a link to install the GitHub App or manage its repository access.
- Bring the user back to the accounts page with a clear message after every link attempt,
  successful or not.
- Introduce the UI test setup (Vitest + Testing Library + MSW) that #68–#71 will reuse.

## Non-goals

These are follow-up issues (see [Follow-up issues](#follow-up-issues)):

- Editing an account's label (#132; `label` stays read-only and is not displayed).
- A link callback that arrives after the session expired (#133; today a `401` JSON from `RequireAuth`).
- Shared handling that sends a `403 forbidden` ("re-link your account") on other pages to this page (#134).

Also out of scope: Bitbucket, avatars, showing token expiries, probing GitHub per account to detect
an installation or a revoked token, backfilling the login of existing accounts, and the Google half
of #119.

## Decisions

| #   | Topic                    | Decision                                                                                                                                     |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Account identity         | New nullable `provider_login` column, written on every link and re-link (GitHub logins can be renamed), returned by `GET /accounts`.          |
| D2  | Existing accounts        | No backfill. Accounts linked before the migration show "GitHub account 123456" until their next re-link.                                      |
| D3  | Install link             | New `GET /providers` endpoint lists the linkable providers, each with an `install_url`. The page always shows it; the real "not installed" state is caught on the track page (#68). |
| D4  | Callback failures        | The GitHub half of #119 lands here: every failure of the linking flow redirects to `/settings/accounts?error=<code>`. #119 keeps the Google half and should reuse the same codes. |
| D5  | Re-link target           | `GET /accounts/github/login?account_id=N`. Ownership is checked at the start. The target ID is stored in the session next to the OAuth state, never read from the callback URL. |
| D6  | Identity mismatch        | When the identity that comes back is not the target's, nothing is stored, the new token is revoked (best-effort), and the user sees `identity_mismatch`. |
| D7  | Account picker           | Every link and re-link sends `prompt=select_account`. Re-link also sends `login=<provider_login>` when it is known.                            |
| D8  | Success redirect         | `/settings/accounts?result=linked\|relinked&account_id=N` replaces `?linked=github`.                                                         |
| D9  | Unknown/foreign target   | An unknown or foreign `account_id` at the start redirects with `?error=account_not_found` rather than answering JSON.                        |
| D10 | Re-link visibility       | Every account has a secondary *Re-link* action. With `needs_relink: true`, the row shows a warning and *Re-link* becomes the primary action. |
| D11 | Unlink                   | Confirmation dialog that names the account and the number of tracked repositories using it. Repositories are kept (API behaviour); S1.4 is reworded to match. |
| D12 | Layout                   | One section per provider from `GET /providers`.                                                                                              |
| D13 | After a new link         | Success banner with next steps: check the app's repository access, then track a repository.                                                  |
| D14 | Tests                    | Go unit tests for the new pure logic. UI test setup plus tests for the accounts page.                                                       |
| D15 | Delivery                 | Two PRs: API first, then UI.                                                                                                                 |

## API changes (PR 1)

### Migration `000008_add_provider_login`

- Up: `ALTER TABLE external_git_accounts ADD COLUMN provider_login VARCHAR(255) NULL;`
- Down: drop the column.
- Scaffold it with the `migration-generator` skill. The author runs `make migrate-up` and
  `make sqlc-generate`; agents write the files and do not run them.

### Queries

- `UpsertExternalGitAccount` takes `provider_login` and sets it in both the insert and the
  `DO UPDATE` branch (always overwritten, so a rename on GitHub is picked up on re-link).

### `GET /accounts`

Each item gains `provider_login` (`string | null`). Nothing else changes.

```json
{ "id": 3, "provider": "github", "provider_user_id": "123456", "provider_login": "octocat", "...": "..." }
```

### `GET /providers` (new, `RequireAuth`)

The providers that can be linked, in a stable order. It reads only server configuration and never
calls a provider.

```json
[{ "name": "github", "display_name": "GitHub", "install_url": "https://github.com/apps/<slug>/installations/new" }]
```

- `install_url` is `null` when the provider is not an `Installer` or the URL is empty (no
  `GITHUB_APP_SLUG`). Reuse the logic of `routers.installDetails`.
- `display_name` comes from the provider. Add it to `providers.Provider` (or an optional
  interface), and add a `List()` method to `providers.Registry`.
- New router `routers.ProvidersRoutes`, mounted at `/providers` in `main.go`.

### `GET /accounts/{provider}/login`

New optional query parameter `account_id` (positive integer): re-link that account.

1. With `account_id`, resolve it with `credentials.ResolveAccount(ctx, uid, provider, id)`. If it
   is not found (unknown, another user's, or another provider's), redirect to
   `?error=account_not_found`. A non-numeric value also gets `account_not_found`, because this is a
   navigation and a `400` would strand the user.
2. Store the OAuth state **and** the re-link target in the session. Add single-use helpers on the
   session model, like `GetOAuthStateToken`: `SetRelinkAccountID(id)` / `GetRelinkAccountID()`. A
   plain link must clear any target left over from an abandoned re-link.
3. Build the authorize URL with options. Change `AuthCodeURL(state string)` to
   `AuthCodeURL(state string, opts AuthOptions)`, where
   `AuthOptions{SelectAccount bool; LoginHint string}`. GitHub maps them to `prompt=select_account`
   and `login=`. `SelectAccount` is always true (D7). `LoginHint` is the target's `provider_login`
   when set.
4. An unregistered provider keeps its `501` JSON: the UI only links providers listed by
   `GET /providers`.

### `GET /accounts/{provider}/callback`

Every outcome is now a `307` to `FRONTEND_URL/settings/accounts` with query parameters built by
`url.Values`. The real error is still logged server-side. No upstream message, error description or
other provider-supplied text goes in the URL.

Order of checks:

1. Read the state, then the re-link target from the session (both single-use, so read both before
   any early return).
2. Missing or mismatched state → `invalid_state`.
3. GitHub's `error` parameter, read **before** `code`: `access_denied` → `access_denied`, any other
   value → `link_failed`.
4. Missing `code`, failed exchange, or `FetchUser` returning `ErrInvalidToken` → `link_failed`.
5. Re-link only: re-read the target with `ResolveAccount`.
   - Gone (unlinked in the meantime) → revoke the new token, then `account_not_found`.
   - `provider_user_id` differs from the identity that came back → revoke the new token, store
     nothing, then `identity_mismatch&account_id=N`.
6. Upsert as today (with `provider_login`), and revoke the replaced token as today.
7. Success → `result=relinked&account_id=N` when the identity was already linked (`existing.ID > 0`,
   whether or not this was a re-link), otherwise `result=linked&account_id=N`.
8. Any internal error → `server_error`.

Revoking the token discarded in step 5 needs a plaintext-token entry point in `credentials`, for
example `Service.RevokeAccessToken(ctx, provider, accessToken)`. It is best-effort, runs on
`context.WithoutCancel` plus `revokeTimeout`, logs its error, and never changes the redirect. The
token is fresh, so revoking it directly is correct (revoking a live access token also kills its
refresh token). Handlers still never touch the provider's `Revoker` themselves.

### Redirect codes (stable contract, mirrored in the UI)

| Parameter                                | When                                                  |
| ---------------------------------------- | ----------------------------------------------------- |
| `result=linked&account_id=N`             | A new identity was linked.                            |
| `result=relinked&account_id=N`           | An identity already linked had its tokens replaced.   |
| `error=access_denied`                    | The user cancelled on GitHub.                         |
| `error=invalid_state`                    | State missing or wrong (expired flow, second tab).    |
| `error=link_failed`                      | GitHub returned an error, no code, or a bad code/token. |
| `error=identity_mismatch&account_id=N`   | Re-link came back with a different GitHub identity.   |
| `error=account_not_found`                | The re-link target does not exist or is not yours.    |
| `error=server_error`                     | Anything else.                                        |

### Docs in PR 1

- `openapi.yaml`: `GET /providers`; `provider_login` on the account schema; `account_id` on login;
  callback and login responses become `307` with the parameters above (remove the `400`/`403`
  envelopes). Keep `operationId` equal to the handler names.
- `docs/api.md` → External accounts: the same changes, plus the identity-mismatch rule.
- `docs/user-stories.md` S1.4: unlinking keeps tracked repositories, which stop syncing until an
  account with access is linked.
- `AGENTS.md`: add `docs/prd/` to the documentation map.
- `src/ui/src/router.tsx`: update the comment on `settings/accounts` (it still says `?linked=`).

### Go tests (no database needed)

- GitHub `AuthCodeURL`: `prompt=select_account` is always present, and `login=` only with a hint.
- Callback outcome → redirect URL builder: every row of the table above, and escaping.
- GitHub `error` parameter mapping (`access_denied` vs. anything else).
- Identity check helper: same ID, different ID, target gone.
- `GET /providers` DTO: an `Installer` with a URL, with an empty URL (`null`), and a non-installer.
- Session helpers: `GetRelinkAccountID` is single-use, and a plain link clears it.
- `Registry.List` order.

### As built in PR 1 (#139)

PR 1 implements the plan above, with these differences. Where they conflict, this list and the code
win over the plan.

- **`Registry.List` is sorted by name**, which meets "a stable order". `NewRegistry` panics on a
  duplicate name, since it runs once at startup. `DisplayName()` is a method on `providers.Provider`,
  not an optional interface.
- **The re-link target is stored in the session as a decimal string.** The session round-trips
  through JSON, which would turn a number into a `float64`. `SetRelinkAccountID(0)` clears it.
- **`RevokeAccessToken` returns its error** instead of logging it, like `Revoke`, and the callback
  logs it.
- **Revocation covers every failure after the exchange**, not only step 5: a rejected token, a
  failed user fetch, a mismatch, a target that's gone, and a failed store all revoke the new token.
- **Step 5 runs inside the store.** The callback locks the target with
  `GetExternalGitAccountByIdForUpdate` and checks it in the same transaction as the upsert, so an
  unlink cannot land between the check and the write and turn a re-link into a new account.
  Ownership and provider are checked on the locked row. `ResolveAccount` is used only at login.
- **The end of the callback runs detached from the request.** After the exchange it uses
  `context.WithoutCancel` with a 30s timeout, so a client disconnect cannot cancel a committed
  write and then revoke the token that was just stored.
- **Login failures other than `501` redirect too.** A failed state token or a failed target lookup
  redirects with `error=server_error`, for the same reason as D9.
- **The callback reads the state and the target before the provider lookup**, so the `501` path
  consumes them too.
- **`frontendURL()` is shared by both OAuth flows** and trims trailing slashes from `FRONTEND_URL`.
  Without the trim, a trailing slash produced `//settings/accounts`, which no UI route matches.
- **Accepted: the login hint can be stale.** It is the login stored at the last link, so after a
  rename on GitHub it names the old login until the re-link completes. It is only a hint, and the
  identity check still decides what is stored.
- **Accepted: an ambiguous commit.** If the upsert commits but an error still reaches the handler,
  the stored token is revoked, and the account needs one more re-link.
- **Not covered by automated tests:** the re-link check and the store and success paths, since there
  is no database seam yet. They are on the manual-check list in #139. Everything that ends before
  the database is unit-tested, and so is the pure re-link check.

## UI (PR 2)

### Page `/settings/accounts` (`AccountsPage`)

Data, all through TanStack Query and `apiFetch`:

- `['providers']` ← `GET /providers` and `['accounts']` ← `GET /accounts`, loaded together.
- `['repositories']` ← `GET /repositories`, loaded only when the unlink dialog opens (the key is
  shared with #69).

Layout: a heading "Linked accounts", then one section per provider, in `GET /providers` order.

```
Linked accounts

┌ GitHub ───────────────────────────────────────┐
│ @octocat   Linked 2 Mar 2026                  │
│            [Re-link] [Unlink]                 │
│ @work-bot  ⚠ Access expired. Re-link to keep  │
│            syncing.                           │
│            [Re-link ▸] [Unlink]               │
│                                               │
│ [+ Link a GitHub account]                     │
│ Manage repository access on GitHub ↗          │
└───────────────────────────────────────────────┘
```

- **Account row**: `@<provider_login>`, or "GitHub account <provider_user_id>" when the login is
  null, plus "Linked <date>" (`Intl.DateTimeFormat`, date only). No token expiries, no label.
- **`needs_relink: true`**: warning text "Access expired. Re-link to keep syncing.", and *Re-link*
  styled as the primary action.
- **Link**: a plain link to `apiUrl('/accounts/github/login')`. It is a full-page navigation, the
  same deliberate exception to `apiFetch` as Google sign-in. Label: "Link a GitHub account" with no
  accounts, "Link another GitHub account" otherwise.
- **Re-link**: a link to `apiUrl('/accounts/github/login?account_id=N')`.
- **Install link**: "Install the GitHub App or manage its repository access", opening `install_url`
  in a new tab (`rel="noopener noreferrer"`). Hidden when `install_url` is null.
- **Empty state** (provider with no account): "No GitHub account linked yet. Link one to track your
  repositories." plus the link button and the install link.
- **Accounts for a provider missing from `GET /providers`** (e.g. a provider removed from config):
  render them in a section titled with the raw provider name, with *Unlink* only.
- **Loading**: "Loading…". **Error** on either query: `ApiErrorMessage` with retry.

### Banners from the redirect

On mount, read `result`, `error` and `account_id` from the URL, show the banner, then remove those
parameters with `navigate(..., { replace: true })` so a refresh or a back navigation does not show
it again. Banners can be dismissed. Success uses `role="status"`, errors `role="alert"`.

| Parameters                   | Message                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `result=linked`              | "Linked @octocat. Next: make sure the GitHub App can see your repositories (link to `install_url`), then [track a repository](/repositories/track)." |
| `result=relinked`            | "Re-linked @octocat."                                                                                                 |
| `error=access_denied`        | "Linking was cancelled on GitHub."                                                                                    |
| `error=invalid_state`        | "The linking session expired. Try again."                                                                            |
| `error=link_failed`          | "GitHub did not complete the sign-in. Try again."                                                                     |
| `error=identity_mismatch`    | "You signed in to GitHub with a different account than @octocat, so nothing was changed. Switch accounts in the picker and re-link again." |
| `error=account_not_found`    | "That account is no longer linked."                                                                                   |
| `error=server_error`, unknown | "Something went wrong while linking. Try again."                                                                     |

The account named in a banner is looked up from `account_id` in the accounts query. When it is not
found, the message drops the name. The linked row is highlighted briefly. Codes are defined once as
a TypeScript union next to the API types.

### Unlink

- *Unlink* opens a native `<dialog>` (focus moves into it, Esc cancels, focus returns to the
  button): "Unlink @octocat?" followed by the impact line, then *Unlink* (destructive) / *Cancel*.
- Impact line, from `['repositories']` filtered by `account_id`:
  - 0: "No tracked repositories use this account."
  - n: "n tracked repositories use this account. They stay in GrepDocs but cannot sync until you
    link an account that can access them."
  - Loading: "Checking tracked repositories…" (*Unlink* stays enabled).
  - Error: the line is omitted. A failed count never blocks unlinking.
- Mutation `DELETE /accounts/{id}`. On success, close the dialog, invalidate `['accounts']` and
  `['repositories']`, and show the status "Unlinked @octocat." On `404`, refetch accounts and close
  (it is already gone). Other errors show `ApiErrorMessage` inside the dialog.

### UI test setup

- Dev dependencies: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`,
  `@testing-library/jest-dom`, `msw`.
- `npm test` script; `make ui-test`, added to `make ui-ci` and to the `ui` job in `ci.yml`.
- A test helper that renders a route with a fresh `QueryClient` (no retries) and a memory router.
- MSW handlers mock `/api/*`, so the tests go through `apiFetch` exactly as the app does.

### UI tests

- Lists accounts grouped by provider; shows the login, or the numeric-ID fallback.
- `needs_relink` shows the warning and makes *Re-link* primary.
- Link and re-link hrefs (`account_id` only on re-link); install link hidden when `install_url` is
  null.
- Empty state.
- Each banner row of the table above; parameters stripped after reading; unknown error → generic.
- Unlink: impact count (0, n, loading, failed request), success refetch, `404` path, error shown in
  the dialog.
- Query errors render `ApiErrorMessage` with retry.

### As built in PR 2

PR 2 implements the plan above, with these differences. Where they conflict, this list and the code
win over the plan.

- **The redirect names no provider**, so the banners take the provider's display name from the
  account named by `account_id`, or from the only provider `GET /providers` lists, and say "your git
  provider" otherwise. With GitHub as the only provider, the messages read as in the table.
- **Messages without a name** say "Account linked.", "Account re-linked." and "…a different account
  than the one you re-linked…".
- **Unknown codes**: an unknown `error` shows the generic message, an unknown `result` shows
  nothing (claiming a success that may not be one would be worse), and an `error` wins over a
  `result`. An `account_id` that is not a positive integer is ignored.
- **The banner waits** until both lists have loaded or failed, so its message does not change when
  the account it names arrives.
- **Links are built from the provider's `name`** (`/accounts/{name}/login`), and the labels from its
  `display_name`, rather than hard-coding GitHub.
- **The impact line has a singular form**: "1 tracked repository uses this account. It stays…".
- **The dialog** starts with focus on *Cancel*, disables *Cancel* and Esc while the request runs
  (closing would not stop it, and the outcome would go unseen), and follows the native `close`
  event, since a browser may close a modal dialog on its own after a prevented cancel (Chrome does
  on a second Esc). A `404` closes it without a message, as planned.
- **`GET /repositories` is refetched after an unlink while the dialog is still open**, since its
  query is active then. `Repository` has only the fields the page reads; #69 adds the rest.
- **Test setup**: MSW 3 (`onUnhandledFrame`, imports from `msw/http`), a test that makes a request
  no handler matches fails and the request is blocked, relative URLs are resolved for Node's
  `fetch`, jsdom's missing modal dialog is stubbed, and pages render in `StrictMode`. jsdom 31 raised
  `engines.node` to `>=22.22.2`.
- **Not covered by automated tests**: the page in a real browser (layout, the top layer and focus
  trap of the native dialog, Chrome's close on a second Esc) and the acceptance criteria end to end
  against the API and GitHub. They are on the manual-check list in the PR.

### Docs in PR 2

- `AGENTS.md`: UI tests exist (remove "The UI has no tests yet"), the `make ui-test` command, and
  the redirect codes mirrored in the UI, alongside `ApiErrorCode`.
- `docs/roadmap.md` / `docs/roadmap-stakeholders.md`: run `phase-status-sync` after merge.

## Acceptance criteria

1. A user with no account sees the empty state, links GitHub, picks an identity in GitHub's picker,
   and lands back on the page with "Linked @login" and the next-step banner.
2. Linking a second identity adds a second row. Linking an already-linked identity says
   "Re-linked".
3. Re-linking `@a` while choosing `@b` in the picker changes nothing in the database, revokes the
   token issued for `@b`, and shows `identity_mismatch`.
4. Cancelling on GitHub, a stale state, or an API error never shows JSON. Each ends on the page
   with its banner.
5. An account with `needs_relink: true` shows the warning. Re-linking it clears the flag.
6. Unlink shows the right count of affected tracked repositories. After confirming, the row is
   gone, and those repositories remain with `account_id: null`.
7. The install link opens GitHub's install page, and is hidden without `GITHUB_APP_SLUG`.
8. A refresh after any redirect does not repeat the banner.
9. `make ci` passes, including the new Go and UI tests, and `make openapi-lint`.

## Risks and things to verify manually

- **Concurrent GitHub App user tokens**: discarding (revoking) the token issued during a mismatched
  re-link must not affect a token GrepDocs already stores for that same identity as another
  account. Verify that GitHub keeps multiple user tokens per app and user independent.
- **`prompt=select_account` and `login` together**: confirm that GitHub shows the picker with the
  hinted account preselected, for a GitHub App user authorization (the docs describe it for OAuth
  apps).
- **Contract change**: `?linked=github` disappears. Nothing consumes it yet, but `docs/api.md`, the
  OpenAPI spec and the router comment must all change in PR 1.

## Follow-up issues

1. **#132 `feat(accounts): let users label linked accounts`**. `PATCH /accounts/{id}` with
   `{"label"}`: trimmed, at most 50 characters, empty clears it, `404` for another user's account.
   A rename action on the accounts page; rows read "Work · @octocat".
2. **#133 `fix(auth): send a link callback with an expired session to the login page`**.
   `/accounts/{provider}/callback` sits behind `RequireAuth`, so a session that expired while the
   user was on GitHub gets a `401` JSON. Redirect to `/login?redirect=/settings/accounts` instead.
3. **#134 `feat(ui): offer re-linking on a 403 forbidden from any page`**. A shared way for #68–#71
   to turn a "re-link your account" `403` into a link to `/settings/accounts`, since `needs_relink`
   cannot see a token revoked while still valid.
