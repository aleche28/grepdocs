# GrepDocs Roadmap

Phased, not dated — each phase is a scope milestone, not a calendar commitment. Phases are
intended to run roughly in order but security/architecture work is interleaved into the phase
that needs or exposes it, rather than pushed into a separate "hardening" track. Source material:
`docs/api.md` (target API shape), `docs/code-review-checklist.md` (tracked findings, `[ ]` =
open), `docs/requirements.md` / `docs/user-stories.md` (product spec).

## Baseline (today)

Implemented: Google OAuth login, session management (Redis-backed), GitHub account linking
through a GitHub App (several accounts per provider per user; tokens encrypted at rest, refreshed
automatically, and revoked on unlink/re-link), GitHub repository discovery for a linked account,
repository tracking (CRUD + branch listing), self-service user endpoints. No sync, tracked-file
selection, documents, search, groups, commit-back, or UI yet. Unit tests cover sessions, auth
middleware, providers, credentials, response envelopes, the session model, and DB-free router
helpers; no CI.

## Phase 1 — Multi-account & provider foundation

Goal: remove the one-account-per-provider ceiling and put a real provider abstraction under it,
since both the multi-account work and any future non-GitHub provider need the same seam. Token
encryption rides along because multi-account multiplies the number of tokens at rest.

Status: **schema + linking + provider abstraction + token encryption done** — migration `000004`
moves the unique key to `(user_id, provider, provider_user_id)` and adds `label`;
`UpsertExternalGitAccount` makes relinking idempotent; account-scoped reads take `?account_id=`;
GitHub access now sits behind the `providers` package (`Provider` interface + `Registry`), with
provider failures normalized to `ErrInvalidToken`/`ErrRateLimited` and mapped to `403`/`429`;
provider tokens are encrypted at rest with AES-256-GCM behind the `secrets.Cipher` interface.
Still open in this phase: the rest of the seed tests (E1) — the session/`RequireAuth`/provider unit
tests landed, but the OAuth callback integration test (needs a DB seam) and CI are outstanding.

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

Status: **tracking CRUD + branch listing + GitHub App migration + token refresh done** — the
`repositories` table (migration `000005`) backs `POST/GET/PATCH/DELETE /api/repositories` and
`GET /repositories/{id}/branches`; GitHub accounts link through a GitHub App with expiring tokens
that `credentials.Service` refreshes and revokes (checklist D3 closed). Still open in this phase:
the sync engine. Known gaps carried forward: handler and locked-refresh tests need a DB seam
(checklist E1); a re-link racing a refresh can leave the rotated token unrevoked;
`GET /api/accounts` does not flag accounts that need re-linking.

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
- Sync engine: clone/pull the tracked branch, record `tracked_commit`/`last_sync_at`/
  `sync_status`, `POST /repositories/{id}/sync` to trigger on demand. Uses the user's (refreshed)
  token; GitHub push webhooks are a natural follow-up trigger for `auto_sync`.

## Phase 3 — Tracked file selection

- `GET`/`PUT /repositories/{id}/tracking` (include/exclude patterns).
- `GET /repositories/{id}/tree` file browsing, applying the tracking rules.

## Phase 4 — Documents & drafts

- Document DTO, `GET /documents`, `GET /documents/{id}` (+ `raw`, `rendered`, `diff`).
- `PUT /documents/{id}` writes a draft (never pushed); `DELETE /documents/{id}/draft` reverts.
- Storage decision: draft content in Postgres vs. a blob store — pick based on expected doc size
  and how `diff`/`rendered` will be computed.

## Phase 5 — Commit-back workflow

- `POST /repositories/{id}/commits`: atomic push of selected drafts with a user message.
- `409` on upstream drift since last sync, `422` on a referenced file with no draft.
- `GET /repositories/{id}/commits` history.

## Phase 6 — Search

- `GET /api/search` full-text search across tracked documents, with `repo`/`group`/`provider`
  filters and snippet highlighting.
- Start with Postgres full-text search (`tsvector`); revisit only if scale/relevance needs outgrow
  it.

## Phase 7 — Groups

- `GET/POST/PATCH/DELETE /groups`, repo assignment endpoints.
- Wire `group` filters into `/documents`, `/repositories`, `/search` once groups exist.

## Phase 8 — Frontend (`src/ui`)

- Build the UI consuming the API surface from phases 1–7. This is the first point a real browser
  origin exists.
- **CORS + rate limiting (checklist A7)**: currently skipped because there's no real frontend to
  protect against; becomes mandatory at (or just before) this phase.

## Ongoing, not phase-bound

Small items that don't need their own phase — pick up opportunistically whenever touching the
adjacent code, rather than batching into a dedicated cleanup pass:

- **Config consolidation (checklist C7)** — `main.go` builds `AppConfig` but routers also read
  `os.Getenv` directly; consolidate next time a router constructor changes.
- **Session write amplification (checklist C8)** — `Handle` persists every request including
  anonymous ones; only persist on mutation.
- **`username` column (checklist D5)** — defaults to `''`, never populated; decide if it's a real
  product feature (fits naturally with Phase 1's account labels) or drop it.
- **Test/CI coverage (checklist E1)** — grow alongside each phase above rather than as a
  standalone effort; Phase 1 seeds it.

## Explicitly deferred

- **Bitbucket / GitLab providers** — Phase 1's provider abstraction sets this up, but no phase is
  committed yet. Revisit once Phase 2 has proven the interface out with GitHub plus multi-account
  in production use.
- **Multi-user / shared accounts** — out of scope. This roadmap's multi-account work is
  multiple accounts *per user*, not accounts shared across users; `docs/api.md` treats users as
  private with no collaboration model, and revisiting that is a bigger product decision than this
  roadmap covers.
