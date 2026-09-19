# AGENTS.md

Guidance for AI coding agents working in this repository. Written to be tool-agnostic — any agent
that picks up an `AGENTS.md` (or is pointed at one) should be able to work from this file alone.

## Project

GrepDocs: a centralized tool to browse, search, and edit Markdown documentation living across
multiple git repositories, committing edits back to source control. Only the backend exists today
(`src/api`, Go module `grepdocs/api`); `src/ui` is reserved for a future frontend and is absent.

There are no tests and no CI. `go vet` and `go fmt` are the only quality gates — run both before
committing.

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

`main.go` wires everything; there is no DI container and no service layer yet.

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

### HTTP responses (`src/api/httpx`)

Every response goes through `httpx`. Never use `http.Error` or hand-rolled JSON encoding.

- `WriteJSON(w, status, data)`
- `WriteError(w, status, code, message)` — emits `{"error":{"code","message"}}`, where `code` is one
  of the stable `httpx.Code*` constants and is the machine-readable discriminator.
- `WriteInternalError(w, err)` — logs the real error server-side and returns a generic `internal`
  envelope. Internal error strings must never reach the client.

Handlers build response DTOs explicitly (inline `map[string]any` today). Token fields from
`external_git_accounts` must be stripped at the DTO layer — see `listExternalAccounts`.

### Git providers

Only GitHub is implemented, and its API calls sit directly in `routers/external_git_accounts.go`
behind a `provider != providerGithub → 501` guard. Extracting a provider abstraction is known
outstanding work (C1 in the review checklist) — when adding Bitbucket, build that layer rather than
adding a second inline implementation.

GitHub specifics worth preserving: the shared `httpClient` from `routers/http.go` (10s timeout),
`newGitHubRequest` for auth/accept headers, `io.LimitReader` bounding every decode, `Link`-header
pagination with a page cap, and returning the upstream HTTP status so callers can distinguish a
revoked token (401/403 → "re-link your account") from a real failure. There is no token refresh
flow; expired tokens mean re-linking.

## Conventions

- Conventional commit messages (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `feat!:`).
- API paths kebab-case, JSON fields `snake_case`.
- `last_refreshed_at` is spelled that way everywhere (migration + queries) — not a typo to "fix".
- `.env` is gitignored and holds real OAuth secrets — never commit, print, or echo it.

## Documentation map

- `docs/api.md` — the API contract. It is a **design proposal**: much of it (repositories,
  documents, search, groups, pagination) is not implemented. Treat it as the target shape for new
  endpoints, and check it before inventing a route or response body.
- `docs/code-review-checklist.md` — tracked findings from a senior review, with `[ ]` items marking
  known open problems (plaintext provider tokens, no CORS/rate limiting, no provider abstraction,
  config split between `main.go` and `os.Getenv` in router constructors, session write
  amplification, no tests). Update the relevant checkbox when you close one.
- `docs/requirements.md`, `docs/user-stories.md` — product spec.
- `docs/howto/` — Google/GitHub OAuth setup, golang-migrate workflow, sqlc usage.

## Known inconsistencies

- `.env.example` sets `GITHUB_REDIRECT_URL` to `/api/ext-accounts/github/callback`, but the route was
  renamed to `/api/accounts/{provider}/callback`. Use the `/api/accounts/...` path in `.env` and in
  the GitHub OAuth app.
- `CLAUDE.md` is only a pointer to this file (Claude Code reads it via an `@AGENTS.md` import).
  This file is the single source of truth — put new guidance here.
