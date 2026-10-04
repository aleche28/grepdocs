# AGENTS.md

Guidance for AI coding agents working in this repository. Written to be tool-agnostic — any agent
that picks up an `AGENTS.md` (or is pointed at one) should be able to work from this file alone.

## Project

GrepDocs: a centralized tool to browse, search, and edit Markdown documentation living across
multiple git repositories, committing edits back to source control. Only the backend exists today
(`src/api`, Go module `grepdocs/api`); `src/ui` is reserved for a future frontend and is absent.

There is no CI. `go test ./...`, `go vet`, and `go fmt` are the quality gates — run all three before
committing (`make test`, `make vet`, `make fmt`). Unit tests cover sessions, auth middleware,
providers, credentials, response envelopes, and the session model. `routers` tests cover only
helpers that need no database (`writeProviderError`, `installDetails`); handlers stay untested
because they hold a concrete `*pgxpool.Pool`, so there is no DB seam yet.

## Commands

All Go commands run from `src/api` (godotenv loads `.env` from the working directory). The Makefile
at the repo root wraps them and handles the `cd` for you:

| Task                  | Command                            |
| --------------------- | ---------------------------------- |
| Start infra           | `make infra-up`                    |
| Stop infra            | `make infra-down`                  |
| Create `.env`         | `make env`                         |
| Run the API (`:3000`) | `make run`                         |
| Build                 | `make build`                       |
| Run tests             | `make test`                        |
| Tests + race detector | `make test-race`                   |
| Format / vet          | `make fmt` / `make vet`            |
| Apply migrations      | `make migrate-up`                  |
| Roll back             | `make migrate-down [COUNT=n]`      |
| Scaffold a migration  | `make migrate-new NAME=create_foo` |
| Regenerate the DAL    | `make sqlc-generate`               |

Makefile caveats:

- `make tidy` is broken — it runs `go tidy`, which is not a command. Use `cd src/api && go mod tidy`.
- `make fmt` / `make vet` run `go fmt` / `go vet` with no package argument, so they only cover the
  `main` package. For the whole module use `cd src/api && go vet ./...` and `gofmt -l .`.
- `make migrate-*` parses `DATABASE_URL` out of `src/api/.env` with `sed` and requires the
  `postgres://` URL form (golang-migrate cannot read pgx keyword/value strings). Override on the
  command line with `make migrate-up DATABASE_URL=...`.

Prerequisites beyond Go and Docker: `golang-migrate` and `sqlc` on `PATH` (see README).
Health check: <http://localhost:3000/api/ping> returns `pong`.

Infra (`make infra-up`) starts Postgres on `5432`, Redis on `6379`, pgAdmin on `8080`. The server
needs both Postgres and Redis, and exits at startup if `DATABASE_URL` is unset.

## Architecture

### Request pipeline

`main.go` wires everything; there is no DI container. The only service is `credentials.Service`
(see Git providers), built once in `main.go` and injected into the routers that call providers.

```
http.Server (explicit timeouts, graceful shutdown on SIGINT/SIGTERM)
  └─ sm.Handle          session middleware — loads/creates session, writes cookie, saves on the way out
      └─ chi router      middleware.Logger / RequestID / Recoverer
          └─ /api
              ├─ GET /ping                      (public)
              ├─ /auth      routers.AuthRoutes             (public: Google OAuth login/callback, logout)
              ├─ /users     routers.UserRoutes             (RequireAuth)
              └─ /accounts  routers.ExternalAccountsRoutes (RequireAuth)
```

Each `routers.*Routes(...)` constructor builds a handler struct holding `*pgxpool.Pool` and
`*session.SessionManager`, then returns a `chi.Router`. Handlers are receiver methods; they open a
`dal.New(h.dbPool)` query set per request and always pass `r.Context()` to DB and outbound calls.

### Sessions (`src/api/session`, `src/api/models/session.go`)

Hand-rolled, deliberately — do not swap in `scs` or another library unilaterally (there is a TODO in
`main.go` about it, but it is a decision, not a chore).

- `SessionManager.Handle` wraps every request: reads the cookie, loads from the store, attaches the
  `*models.Session` to the request context under a private key, and saves it after the handler runs.
- `sessionResponseWriter` exists so the `Set-Cookie` header is always written *before* any status
  code or body, regardless of what the handler does.
- `RedisSessionStore` is the only store; it relies on Redis TTL, so `NeedsGC()` returns false and the
  GC goroutine never starts. Idle (1h) and absolute (12h) expirations are enforced both in the
  manager (`isValid`) and via the Redis TTL.
- Session helpers live on the model: `SetUserID` also flips `Authenticated`; `GetOAuthStateToken`
  and `GetUIRedirectPage` are **single-use reads** that delete the key as a side effect.
- `middleware.RequireAuth(sm)` rejects unauthenticated requests and stashes the user ID in the
  request context; handlers read it with `middleware.CurrentUserID(r)`, never from the session.

### Data access (`src/api/dal`) — generated, never hand-edited

Two steps, in this order:

1. Write a migration in `src/api/database/migrations/` as `NNNNNN_name.up.sql` + `.down.sql`.
   Never edit an existing migration — add a new one (see `000003`, which fixes `000002`).
   `sqlc.yaml` uses the migrations folder as its schema source, so the migration *is* the schema.
2. Add or change a query in `src/api/database/queries.sql` (`-- name: Foo :one|:many|:exec`), then
   run `make sqlc-generate`. Schema and query changes are invisible to Go code until you do.

`.agents/skills/migration-generator/SKILL.md` documents a naming/scaffolding convention for new
migration files (sequence numbering, column/type syntax, automatic indexes and down-migrations).
Most agents will not auto-load it — read it directly when generating a migration, and follow its
rules: never modify existing migrations, and never run migrations or `sqlc generate` on the user's
behalf; write the files and tell them the commands.

sqlc overrides map `timestamptz` to `time.Time` / `*time.Time` rather than `pgtype` wrappers.

### Token encryption (`src/api/secrets`)

Provider `access_token`/`refresh_token` are encrypted at rest with app-level AES-256-GCM; the DB
only ever sees base64 ciphertext prefixed `v1:`. The `secrets.Cipher` interface is the seam — a
KMS-envelope implementation can replace `AESGCMCipher` without touching call sites. `main.go`
reads `TOKEN_ENCRYPTION_KEY` (base64, 32 bytes), validates it at startup, and **fatals** if it is
missing, malformed, or the wrong length.

Rules:

- Never commit a key. Generate with `openssl rand -base64 32` and keep it in `.env`; the key must
  stay stable or every stored token becomes unreadable.
- Encrypt before every write to `external_git_accounts` and decrypt after every read. Writes happen
  in `providerCallback` (link/re-link) and `credentials.Service` (refresh); reads go through
  `credentials.Service`, the only decrypt site. `secrets` is not wired into the DAL automatically,
  so new write paths must not forget this, and new read paths should get tokens from `credentials`
  instead of decrypting themselves.
- Keep the `v1:` prefix on ciphertext; it is what makes format/key rotation possible.
- Unit tests live in `secrets/aesgcm_test.go` (round-trip, tamper, wrong key, malformed input).

### HTTP responses (`src/api/httpx`)

Every response goes through `httpx`. Never use `http.Error` or hand-rolled JSON encoding.

- `WriteJSON(w, status, data)`
- `WriteError(w, status, code, message)` — emits `{"error":{"code","message"}}`, where `code` is one
  of the stable `httpx.Code*` constants and is the machine-readable discriminator.
- `WriteErrorWithDetails(w, status, code, message, details)` — same envelope plus an optional
  `details` object, omitted when `details` is empty. `WriteError` calls it with `nil`.
- `WriteInternalError(w, err)` — logs the real error server-side and returns a generic `internal`
  envelope. Internal error strings must never reach the client.

Handlers build response DTOs explicitly (inline `map[string]any` today). Token fields from
`external_git_accounts` must be stripped at the DTO layer — see `listExternalAccounts`.

### Git providers

Only GitHub is implemented, behind the `providers.Provider` interface + `Registry` (new providers
go in `src/api/providers/`, not inline in handlers). Provider failures are normalized to
`ErrInvalidToken`/`ErrRateLimited`/`ErrNotFound`/`ErrAppNotInstalled` and mapped by callers to
`403`/`429`/`404`/`403 app_not_installed`. When adding Bitbucket, build a `Refresher`
implementation rather than adding a second inline flow.

Capabilities not every provider has are optional interfaces checked with a type assertion, not
methods on `Provider`: `Refresher` (token refresh), `Installer` (`InstallURL()`, for providers
whose access depends on an app installation), and `Revoker` (token revocation).
`routers.installDetails` turns `InstallURL()` into the `details.install_url` of an error, and
returns `nil` when the provider is not an `Installer` or the URL is empty (no `GITHUB_APP_SLUG`),
so the key is omitted rather than sent empty.

Handlers and background jobs get provider access tokens from `credentials.Service`
(`src/api/credentials`), never from the token columns directly: `ResolveAccount` picks the account,
`ForAccount` / `ForRepository` return a usable token. It writes no HTTP responses; it returns
`ErrAccountNotFound`, `ErrAccountAmbiguous`, and `ErrReauthRequired`, and each caller maps them
(the status for the same error differs per endpoint — check `docs/api.md`).

Token refresh lives in `credentials` and is invisible to callers. `ForAccount` refreshes a token
that expires within `refreshMargin` (5 min) when the provider implements `providers.Refresher`.
Rules worth preserving:

- Refresh tokens are single-use, so refreshes are serialized per account with
  `GetExternalGitAccountByIdForUpdate` (`SELECT … FOR UPDATE`) inside a transaction. After taking
  the lock, every decision uses the locked row — another caller may already have refreshed.
- The locked section runs on `context.WithoutCancel` plus its own timeout: a client disconnect
  after the provider rotated the tokens but before the commit would otherwise lose them.
- Only a dead refresh token is `ErrReauthRequired` (the provider maps it to
  `providers.ErrInvalidToken`; for GitHub, `bad_refresh_token`). Network errors, provider outages,
  and bad client credentials stay plain errors (`500`), never "re-link".
- On a rejected refresh, `ClearExternalGitAccountTokens` empties both tokens in the same
  transaction, so later calls fail fast without contacting the provider.
- An empty refresh token passed to `UpdateExternalGitAccountTokens` means "keep the stored one and
  its expiry". oauth2 echoes the sent refresh token when the provider did not rotate it; that case
  is treated as empty. Never encrypt an empty value — the ciphertext would not be empty.
- No retry on `401` from provider calls: with an unexpired token it means revoked access, which a
  refresh cannot fix.

Token revocation also lives in `credentials` (`Service.Revoke`, called on unlink and on a re-link
that replaces a stored token). Rules worth preserving:

- Change the database first, then revoke. Revoking first and then failing the write would leave a
  stored token that no longer works.
- Revocation is best-effort: callers log the error and never fail the request. It runs on
  `context.WithoutCancel` plus `revokeTimeout`, so a client disconnect does not skip it.
- `Revoke` does not refresh first (that would only issue a new pair) and skips accounts whose access
  token is empty (cleared after a rejected refresh).
- Unlink deletes with `DeleteExternalGitAccountByIdAndUserId` (`DELETE … RETURNING *`): ownership
  is in the `WHERE`, so another user's account is a `404`, and the delete waits for a refresh
  holding the row lock, so it returns the post-refresh tokens. Do not go back to read-then-delete.
- Re-link reads the old row with `GetExternalGitAccountByIdentity` before the upsert. It is a plain
  read: a refresh in between can rotate the token, and the new one is not revoked. Accepted as rare.
- GitHub revokes with `DELETE /applications/{client_id}/token` (Basic auth with the client
  credentials); `204`, `404` (unknown token, e.g. from the old OAuth App) and `422` are success.
  Revoking a live access token also revokes its refresh token (verified manually). Whether this
  holds for an already expired access token is **unverified**: if not, its refresh token survives
  until it expires. Never use `/applications/{client_id}/grant` instead: it revokes the GitHub
  identity's authorization for every GrepDocs user who linked it.

GitHub specifics worth preserving: the shared `httpClient` from `routers/http.go` (10s timeout),
`newGitHubGetRequest` / `newGitHubDeleteRequest` for auth, accept, and content-type headers,
`io.LimitReader` bounding every decode, `Link`-header pagination with a page cap, and returning the
upstream HTTP status so callers can distinguish a revoked token (401/403 → "re-link your account")
from a real failure. With a GitHub App token, `/user/repos` lists only repositories the app is
installed on, so `ListRepositories` checks `/user/installations` when the list is empty and returns
`ErrAppNotInstalled` when there are none (`total_count` is the total, not the page size). The token
refresh and revocation flows are described above, under `credentials`.

## Conventions

- Conventional commit messages (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `feat!:`).
- API paths kebab-case, JSON fields `snake_case`.
- `last_refreshed_at` is spelled that way everywhere (migration + queries) — not a typo to "fix".
- `.env` is gitignored and holds real OAuth secrets — never commit, print, or echo it.

## Skills

Reusable workflows live in `.agents/skills/<name>/SKILL.md`. Agents that understand skills load
them on matching requests; if yours doesn't, read the relevant file directly before acting.

- `migration-generator` — scaffold new golang-migrate up/down files from a table/column description.
- `roadmap-next` — determine the next task in the current roadmap phase (reads `docs/roadmap.md`,
  the checklist, and `docs/api.md`; read-only, evidence-based).
- `implementation-review` — teaching-first review of hand-written code (rubric in
  `REVIEW-RUBRIC.md`). Advisory by default; only applies fixes on explicit opt-in.
- `phase-status-sync` — close out finished work across `docs/roadmap.md`,
  `docs/code-review-checklist.md`, and `docs/roadmap-stakeholders.md`. Docs only.

## Documentation map

- `docs/api.md` — the API contract. It is a **design proposal**: much of it (repositories,
  documents, search, groups, pagination) is not implemented. Treat it as the target shape for new
  endpoints, and check it before inventing a route or response body.
- `docs/code-review-checklist.md` — tracked findings from a senior review, with `[ ]` items marking
  known open problems (no CORS/rate limiting, config split between `main.go` and `os.Getenv` in
  router constructors, session write amplification, no token refresh path, no tests). Update the
  relevant checkbox when you close one.
- `docs/requirements.md`, `docs/user-stories.md` — product spec.
- `docs/howto/` — Google OAuth setup, GitHub App setup, golang-migrate workflow, sqlc usage.
- `docs/roadmap.md` — phased build-out plan (not dated), interleaving new features with the open
  checklist items each phase depends on or exposes. Update it as phases complete or scope shifts.
- `docs/roadmap-stakeholders.md` — non-technical companion to `docs/roadmap.md`: same plan grouped
  into Now/Next/Later, feature language only. Keep the two in sync when phases change.

## Known inconsistencies

- `CLAUDE.md` is only a pointer to this file (Claude Code reads it via an `@AGENTS.md` import).
  This file is the single source of truth — put new guidance here.
