# GrepDocs Roadmap

Phased, not dated — each phase is a scope milestone, not a calendar commitment. Phases are
intended to run roughly in order but security/architecture work is interleaved into the phase
that needs or exposes it, rather than pushed into a separate "hardening" track. Source material:
`docs/api.md` (target API shape), `docs/code-review-checklist.md` (tracked findings, `[ ]` =
open), `docs/requirements.md` / `docs/user-stories.md` (product spec).

Each phase is a GitHub milestone with the same name, and its tasks are issues in that milestone
(tracked on the "GrepDocs Roadmap" project). Work that belongs to no phase has no milestone.

Order: the API and the sync engine come first, then a thin read-only UI (Phase 4) so the product
is usable as early as possible. Every phase after that ships its API and its UI together. The
read-only UI does not wait for tracked-file selection because sync already copies every Markdown
file of the tracked branch; file selection narrows that set later.

## Baseline (today)

Implemented: Google OAuth login, session management (Redis-backed), GitHub account linking
through a GitHub App (several accounts per provider per user; tokens encrypted at rest, refreshed
automatically, and revoked on unlink/re-link), GitHub repository discovery for a linked account,
repository tracking (CRUD + branch listing), self-service user endpoints. The sync engine is in
progress (Phase 3). No document API, tracked-file selection, search, groups, commit-back, or UI
yet. Unit tests cover sessions, auth middleware, providers, credentials, response envelopes, the
session model, and DB-free router helpers; no CI.

## Phase 1 — Foundation (multi-account & providers)

Goal: remove the one-account-per-provider ceiling and put a real provider abstraction under it,
since both the multi-account work and any future non-GitHub provider need the same seam. Token
encryption rides along because multi-account multiplies the number of tokens at rest.

Status: **done** — migration `000004`
moves the unique key to `(user_id, provider, provider_user_id)` and adds `label`;
`UpsertExternalGitAccount` makes relinking idempotent; account-scoped reads take `?account_id=`;
GitHub access now sits behind the `providers` package (`Provider` interface + `Registry`), with
provider failures normalized to `ErrInvalidToken`/`ErrRateLimited` and mapped to `403`/`429`;
provider tokens are encrypted at rest with AES-256-GCM behind the `secrets.Cipher` interface.
The session/`RequireAuth`/provider unit tests landed; the rest of the seed tests (E1: the OAuth
callback integration test, which needs a DB seam, and CI) moved to "Ongoing, not phase-bound".

- **Schema**: `external_git_accounts` currently enforces `UNIQUE(user_id, provider)`
  (`database/migrations/000002_create_external_git_accounts_table.up.sql:12`). New migration
  changes this to `UNIQUE(user_id, provider, provider_user_id)`. Add a user-editable label/alias
  column (e.g. `label`) so a person can tell "personal" and "work" GitHub accounts apart once a
  UI exists.
- **Linking flow**: `GetExternalGitAccountByUserIDAndProvider` (`database/queries.sql:37`) and the
  callback's upsert-by-`(user_id, provider)` logic assume a single account per provider. Rework to
  key on `(user_id, provider, provider_user_id)` so re-running `/accounts/{provider}/login` adds a
  new account instead of overwriting the existing one when the OAuth identity differs.
- **API surface**: `GET /accounts` returns the full list (already list-shaped per `docs/api.md`);
  `GET /accounts/{provider}/repositories` and `POST /repositories` already take/accept an
  `account_id` — confirm every account-scoped read is disambiguated by account, not provider.
  `DELETE /accounts/{id}` enforces ownership and cascades cleanup.
- **Provider abstraction (checklist C1)**: extract a `providers` interface (exchange code, list
  repositories, refresh token) out of the inline GitHub calls in
  `routers/external_git_accounts.go`. Multi-account and a future Bitbucket/GitLab provider both
  need this seam — build it once here rather than duplicating inline GitHub-shaped code per
  provider later. **Done** — `providers` package with a `Registry`; GitHub lives behind it. Token
  refresh is modeled as an optional `Refresher` capability rather than a method on every provider,
  since GitHub OAuth App tokens don't refresh (this changes with the Phase 2 GitHub App migration).
  GitHub implements it since that migration (Phase 2).
- **Token encryption (checklist A2/D1)**: `access_token`/`refresh_token` are plaintext today. Add
  at-rest encryption (app-level AEAD or KMS envelope) before the number of stored tokens grows
  with multi-account. **Done** — app-level AES-256-GCM in the `secrets` package, keyed by a
  base64 `TOKEN_ENCRYPTION_KEY` validated at startup; ciphertext is versioned (`v1:`) and
  base64-encoded for safe storage in the existing `TEXT` columns. KMS envelope remains a future
  swap behind `secrets.Cipher`.
- **Tests (checklist E1, started here not deferred)**: first unit tests for session lifecycle and
  `RequireAuth` are in (`session/manager_test.go`, `middleware/middleware_test.go`), alongside
  provider HTTP/pagination tests against `httptest` (`providers/github_test.go`) and response
  envelope tests (`httpx`). The OAuth callback integration test with a fake provider is still open —
  it needs a DB seam (handlers hold a concrete `*pgxpool.Pool`) or a test Postgres — as is CI.

## Phase 2 — Repository tracking

Status: **done** — the
`repositories` table (migration `000005`) backs `POST/GET/PATCH/DELETE /api/repositories` and
`GET /repositories/{id}/branches`; GitHub accounts link through a GitHub App with expiring tokens
that `credentials.Service` refreshes and revokes (checklist D3 closed). The sync engine, planned
here at first, is now Phase 3. Known gaps carried forward: handler and locked-refresh tests need a
DB seam (checklist E1, ongoing); a re-link racing a refresh can leave the rotated token unrevoked
(accepted as rare); `GET /api/accounts` does not flag accounts that need re-linking (Phase 4).

- `POST/GET/PATCH/DELETE /api/repositories`, `GET /repositories/{id}/branches`. **Done.**
- Track a repo from a linked account **or** by public `owner`/`name` (no account needed for public
  GitHub repos, per `docs/api.md`). **Done.**
- **GitHub App migration + token refresh (checklist D3) — before the sync engine.** **Done** — see
  the per-item notes below. Replace the GitHub OAuth App with a GitHub App using expiring user
  tokens (8h access, 6-month single-use refresh token), so stored tokens stop being non-expiring,
  full-`repo`-scope credentials. The sync engine design depends on this (who owns the token, that
  it expires mid-job, that refresh rotates it), so it lands first:
  - Register a GitHub App (token expiration on; *Contents: read & write*, *Metadata: read*;
    authorization requested during installation so link + install is one flow; webhooks off for
    now). Add `docs/howto/setup-github-app.md` and a `GITHUB_APP_SLUG` for the install link.
    **Done** — the OAuth App scopes and `AccessTypeOffline` were dropped from the provider.
  - Store the provider's real `token_expires_at` (NULL when none) instead of the synthetic
    1-year expiry in `providerCallback`. Any max-age/re-consent policy, if wanted, is explicit and
    separate from the provider expiry. **Done.**
  - Move token resolution out of the HTTP handlers (`repoAccessToken` and the inline check in
    `external_git_accounts.go`) into a transport-agnostic function returning typed errors, so the
    sync engine can reuse it. **Done** — `credentials.Service` (`ResolveAccount`, `ForAccount`,
    `ForRepository`).
  - GitHub implements `providers.Refresher`. Refresh on (near-)expiry and persist via
    `UpdateExternalGitAccountTokens` (currently generated but never called; check its
    `COALESCE` refresh-token param isn't a non-nullable `string`). Serialize refreshes per
    account (`SELECT … FOR UPDATE`) — refresh tokens are single-use, so concurrent refreshes
    lock the account out. A failed refresh means "needs re-link". **Done** — only a rejected
    refresh token means re-link (and clears the stored tokens); other failures are `500`s.
  - Surface "app not installed" distinctly from "not found" (empty repo list, private-repo `404`)
    so the UI can link to the install page. **Done differently** — `ListRepositories` keeps
    `/user/repos` (a GitHub App user token already lists only installed repositories) and checks
    `/user/installations` only when the list is empty: no installation is `403 app_not_installed`
    with `details.install_url`; a token-backed private-repo `404` carries the same link.
  - Revoke tokens at GitHub (`DELETE /applications/{client_id}/token`) on unlink and when a
    re-link replaces a stored token. **Done** — best-effort, after the database change; revoking
    a live access token also revokes its refresh token, and an expired one is first refreshed so
    its refresh token cannot survive.
  - Existing OAuth-App-linked accounts must re-link (different client id). **Done** — documented in
    `docs/howto/setup-github-app.md`.

## Phase 3 — Sync engine

Goal: copy the Markdown files of each tracked branch into the database, on demand, with a status
the user can see. Everything after this phase reads documents from the database, not from the
provider.

Status: **in progress** on `feat/sync-engine` — the `documents` table (migration `000007`),
GitHub branch/tree/blob methods, the `reposync` job (stores every `*.md` file, records
`synced_commit`/`last_sync_at`/`sync_status`, and a stable `sync_error` code on failure; see
`docs/api.md` → Sync status and errors) and a draft worker pool (`syncqueue`).

- Bounded worker pool for sync jobs, started in `main.go` and drained on graceful shutdown.
- `POST /repositories/{id}/sync`: mark the repository `queued` and enqueue a job; the client polls
  `GET /repositories/{id}`.
- `sync_error` on the repository DTO.
- Recovery after a restart: the queue lives in memory, so queued jobs are lost on shutdown and
  repositories can stay `queued`/`running`. Re-enqueue or reset them at startup.
- Tests that need no database: worker pool, error-code mapping.
- Not in this phase: automatic sync (`auto_sync` on app open, GitHub push webhooks) — see
  "Explicitly deferred".

## Phase 4 — Read-only MVP

Goal: the first usable product. A user signs in, links GitHub, tracks repositories, syncs them, and
browses and reads their documentation in a browser. This is the first point a real browser origin
exists.

- **Document API (read only)**: `GET /documents` (metadata, filter by `repo_id`) and
  `GET /documents/{id}` + `/raw`, with the repository and branch the document comes from. No
  draft fields yet.
- `GET /api/accounts` flags accounts that need re-linking, so the UI can offer a "Re-link" action.
- **CORS + rate limiting (checklist A7)**: currently skipped because there's no real frontend to
  protect against; mandatory before the UI is used.
- **UI (`src/ui`, Angular)**: Google login with an auth guard and logout; app shell; linked
  accounts (link, unlink, re-link, install-the-app link); track a repository (pick account and
  branch, filter repositories client-side, or a public repository by `owner/name`); repositories
  page with sync status, trigger and polling, branch and `auto_sync` changes, untrack; a
  repository's document tree built from `GET /documents`; a document viewer with rendered
  (client-side, sanitized) and raw modes.
- A documented way to run the API and the UI together locally (dev-server proxy, so the session
  cookie stays same-origin).
- Not in this phase: deployment, a server-side `GET /documents/{id}/rendered`, filters and
  pagination on `GET /accounts/{provider}/repositories`.

## Phase 5 — Tracked file selection

- `GET`/`PUT /repositories/{id}/tracking` (include/exclude patterns). The default stays "every
  Markdown file".
- Sync applies the rules and removes documents that no longer match; changing the rules resets
  the sync state, like changing the branch does.
- `GET /repositories/{id}/tree` file browsing, applying the tracking rules.
- UI: choose tracked files from the file tree.

## Phase 6 — Editing & commit-back

- `PUT /documents/{id}` writes a draft (never pushed); `DELETE /documents/{id}/draft` reverts;
  `GET /documents/{id}/diff` compares the draft with upstream.
- Storage decision: draft content in Postgres vs. a blob store — pick based on expected doc size
  and how `diff` will be computed.
- `POST /repositories/{id}/commits`: atomic push of selected drafts with a user message. `409` on
  upstream drift since last sync, `422` on a referenced file with no draft.
- `GET /repositories/{id}/commits` history.
- UI: Markdown editor with live preview; review changes and commit, explaining a `409`.

## Phase 7 — Search

- `GET /api/search` full-text search across tracked documents, with `repo`/`provider` filters
  (`group` once Phase 8 lands) and snippet highlighting.
- Start with Postgres full-text search (`tsvector`) kept up to date by sync; revisit only if
  scale/relevance needs outgrow it.
- UI: search box and results page.

## Phase 8 — Groups

- `GET/POST/PATCH/DELETE /groups`, repo assignment endpoints.
- Wire `group` filters into `/documents`, `/repositories`, `/search`.
- UI: manage groups and filter by group.

## Ongoing, not phase-bound

Small items that don't need their own phase — pick up opportunistically whenever touching the
adjacent code, rather than batching into a dedicated cleanup pass:

- **Config consolidation (checklist C7)** — `main.go` builds `AppConfig` but routers also read
  `os.Getenv` directly; consolidate next time a router constructor changes.
- **Session write amplification (checklist C8)** — `Handle` persists every request including
  anonymous ones; only persist on mutation.
- **`username` column (checklist D5)** — defaults to `''`, never populated; decide if it's a real
  product feature (fits naturally with Phase 1's account labels) or drop it.
- **Test coverage (checklist E1)** — grow alongside each phase rather than as a standalone
  effort. Still missing: a DB seam (or test Postgres) for handler tests and the OAuth callback
  integration test.
- **CI** — `fmt`, `vet`, build and test workflows, then quality and security checks.

## Explicitly deferred

These live in the "Later" milestone.

- **Bitbucket / GitLab providers** — Phase 1's provider abstraction sets this up, but no phase is
  committed yet. Revisit once the interface has been proven with GitHub plus multi-account in
  production use.
- **Automatic sync** — honor `auto_sync` by syncing when the user opens the app and/or on GitHub
  push webhooks.
- **Several sign-in identities per user** (e.g. email + GitHub merged into one account) — an
  external proposal, not yet planned.
- **Multi-user / shared accounts** — out of scope. This roadmap's multi-account work is
  multiple accounts *per user*, not accounts shared across users; `docs/api.md` treats users as
  private with no collaboration model, and revisiting that is a bigger product decision than this
  roadmap covers.
