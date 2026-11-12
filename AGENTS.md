# AGENTS.md

Guidance for AI coding agents working in this repository. Written to be tool-agnostic — any agent
that picks up an `AGENTS.md` (or is pointed at one) should be able to work from this file alone.

## Project

GrepDocs: a centralized tool to browse, search, and edit Markdown documentation living across
multiple git repositories, committing edits back to source control. The backend is `src/api` (Go
module `grepdocs/api`); the web UI is `src/ui` (React + TypeScript, built with Vite), being built in
Phase 4 of `docs/roadmap.md`.

GitHub Actions runs the quality gates on every PR and push to `main` (see CI and code quality);
`make ci` runs the same checks locally — run it before pushing. Unit tests cover sessions, auth
middleware, providers, credentials, response envelopes, the session model, and the `syncqueue`
worker pool (on `testing/synctest`, so its timeouts run on a fake clock). `routers` tests cover
only code that needs no database (`writeProviderError`, `installDetails`, ID parsing, the docs routes); handlers and
`reposync` stay untested because they hold a concrete `*pgxpool.Pool`, so there is no DB seam yet.
The UI has no tests yet.

## Commands

All Go commands run from `src/api` (godotenv loads `.env` from the working directory), and npm
commands from `src/ui`. The Makefile at the repo root wraps them and handles the `cd` for you:

| Task                   | Command                              |
| ---------------------- | ------------------------------------ |
| Start infra            | `make infra-up`                      |
| Stop infra             | `make infra-down`                    |
| Create `.env`          | `make env`                           |
| Run the API (`:3000`)  | `make run`                           |
| Build                  | `make build`                         |
| Run tests              | `make test`                          |
| Tests + race detector  | `make test-race`                     |
| Format / vet           | `make fmt` / `make vet`              |
| Lint / vuln scan       | `make lint` / `make vuln`            |
| Lint the OpenAPI spec  | `make openapi-lint`                  |
| Tidy `go.mod`          | `make tidy`                          |
| Every check CI runs    | `make ci`                            |
| Apply migrations       | `make migrate-up`                    |
| Roll back              | `make migrate-down [COUNT=n]`        |
| Scaffold a migration   | `make migrate-new NAME=create_foo`   |
| Regenerate the DAL     | `make sqlc-generate`                 |
| Install UI deps        | `make ui-install` (`npm ci`)         |
| Run the UI (`:5173`)   | `make ui-dev`                        |
| Build the UI           | `make ui-build`                      |
| UI typecheck / lint    | `make ui-typecheck` / `make ui-lint` |
| UI format / check      | `make ui-fmt` / `make ui-fmt-check`  |
| UI dependency audit    | `make ui-audit`                      |
| Every UI check CI runs | `make ui-ci`                         |

Makefile caveats:

- `make fmt` rewrites files; `make fmt-check` and `make tidy-check` only print a diff and fail.
- The `ui-*` targets need `node_modules`, and so does `make ci` (it runs `ui-ci`): run
  `make ui-install` once, and again after `package-lock.json` changes. Only CI installs on its own.
- `make migrate-*` parses `DATABASE_URL` out of `src/api/.env` with `sed` and requires the
  `postgres://` URL form (golang-migrate cannot read pgx keyword/value strings). Override on the
  command line with `make migrate-up DATABASE_URL=...`.

Prerequisites beyond Go and Docker: `golang-migrate`, `sqlc`, and `golangci-lint` on `PATH` (see
README), and Node.js at the version in `src/ui/.nvmrc` for the UI. govulncheck needs no install: it is a `tool` directive in `go.mod`, run with `go tool`.
Health check: <http://localhost:3000/api/ping> returns `pong`.

Interactive API docs (Swagger UI) are at <http://localhost:3000/api/docs>, mounted only when `ENV`
is not `production`. Sign in first at <http://localhost:3000/api/auth/google/login>: requests from
the page carry the browser's session cookie, so no cookie copying is needed.

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
              ├─ GET /ping                          (public)
              ├─ /auth          routers.AuthRoutes             (public: Google OAuth login/callback, logout)
              ├─ /users         routers.UserRoutes             (RequireAuth)
              ├─ /accounts      routers.ExternalAccountsRoutes (RequireAuth)
              ├─ /repositories  routers.RepositoriesRoutes     (RequireAuth)
              └─ /docs          routers.DocsRoutes             (public; not mounted in production)
```

Each `routers.*Routes(...)` constructor builds a handler struct holding `*pgxpool.Pool` and
`*session.SessionManager`, then returns a `chi.Router` (`DocsRoutes` has no dependencies). Handlers
are receiver methods; they open a `dal.New(h.dbPool)` query set per request and always pass
`r.Context()` to DB and outbound calls.

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
  of the stable `httpx.Code*` constants and is the machine-readable discriminator. The UI mirrors
  them by hand in `ApiErrorCode` (`src/ui/src/api/client.ts`): add a code to both in one change.
- `WriteErrorWithDetails(w, status, code, message, details)` — same envelope plus an optional
  `details` object, omitted when `details` is empty. `WriteError` calls it with `nil`.
- `WriteInternalError(w, err)` — logs the real error server-side and returns a generic `internal`
  envelope. Internal error strings must never reach the client.

Handlers build response DTOs explicitly (inline `map[string]any` today). Token fields from
`external_git_accounts` must be stripped at the DTO layer — see `listExternalAccounts`.

### Web UI (`src/ui`)

React + TypeScript, built with Vite, React Router for routes, TanStack Query for data from the API.

- Locally, the browser only talks to the Vite dev server on `:5173`, which proxies `/api` to the API
  on `:3000` (`vite.config.ts`), so API calls are same-origin and need no CORS. The API redirects to
  `FRONTEND_URL` (default `http://localhost:5173`) after login and after linking an account, so the
  dev server uses `strictPort`. The OAuth callbacks stay on `:3000`: browsers do not separate
  cookies by port, so the cookie set there reaches `:5173`.
- Every API call goes through `apiFetch` / `apiFetchText` (`src/api/client.ts`), never `fetch`
  directly, the same way every API response goes through `httpx`. Paths omit the `/api` prefix.
  Non-2xx responses become an `ApiError` with the envelope's `code`, `message`, `details`, and
  `retryAfter`; `network_error` (status 0) and `unexpected_response` (no envelope, such as the
  proxy's `502` with the API down) are client-only codes.
- Data from the API lives in TanStack Query, through the shared `queryClient`
  (`src/api/queryClient.ts`), not in component state. Queries retry on network errors and 5xx,
  never on 4xx.
- Routes are in `src/router.tsx`, one component per route in `src/pages/`. Pages that need a
  signed-in user sit under the `AppLayout` route. `/settings/accounts` is fixed by the API, which
  redirects there after linking an account.
- Formatting is Prettier (no semicolons, single quotes), linting ESLint. Run `make ui-fmt`.

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
  transaction, so later calls fail fast without contacting the provider. `credentials` logs the
  rejection (account id and provider error code, never a token), since callers turn
  `ErrReauthRequired` into a `403` without logging.
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
- A live access token is revoked directly. One that `needsRefresh` (expired or within the margin)
  is not: revoking it would leave its refresh token alive. `Revoke` instead spends the refresh
  token on a new pair (refresh tokens are single-use, so the old one dies) and revokes the new
  access token, which also kills the new refresh token. The new pair is never stored. Nothing is
  sent when the provider is not a `Refresher` or `canRefresh` is false (no refresh token, expired,
  or cleared after a rejected refresh), and a refresh rejected with `ErrInvalidToken` means the
  token was already dead, so it returns `nil`. `revokeTimeout` covers both calls.
- Unlink deletes with `DeleteExternalGitAccountByIdAndUserId` (`DELETE … RETURNING *`): ownership
  is in the `WHERE`, so another user's account is a `404`, and the delete waits for a refresh
  holding the row lock, so it returns the post-refresh tokens. Do not go back to read-then-delete.
- Re-link reads the old row with `GetExternalGitAccountByIdentity` before the upsert. It is a plain
  read: a refresh in between can rotate the token, and the new one is not revoked. Accepted as rare.
- GitHub revokes with `DELETE /applications/{client_id}/token` (Basic auth with the client
  credentials); `204`, `404` (unknown token, e.g. from the old OAuth App) and `422` are success.
  Revoking a live access token also revokes its refresh token; revoking an expired one does not
  (both verified manually), hence the refresh-then-revoke above. GitHub has no endpoint that revokes
  a refresh token directly. Never use `/applications/{client_id}/grant` instead: it revokes the
  GitHub identity's authorization for every GrepDocs user who linked it.

GitHub specifics worth preserving: the shared `httpClient` from `routers/http.go` (10s timeout),
`newGitHubGetRequest` / `newGitHubDeleteRequest` for auth, accept, and content-type headers,
`io.LimitReader` bounding every decode, `Link`-header pagination with a page cap, and returning the
upstream HTTP status so callers can distinguish a revoked token (401/403 → "re-link your account")
from a real failure. With a GitHub App token, `/user/repos` lists only repositories the app is
installed on, so `ListRepositories` checks `/user/installations` when the list is empty and returns
`ErrAppNotInstalled` when there are none (`total_count` is the total, not the page size). The token
refresh and revocation flows are described above, under `credentials`.

## CI and code quality

Two workflows in `.github/workflows/`, both calling `make` from the repo root (the Makefile does the
`cd src/api`, so do not set a default `working-directory`):

- `ci.yml` — job `check` (`tidy-check`, `vet`, `build`, `test-race`), job `lint`
  (`golangci-lint-action`, which also reports formatting, so `fmt-check` is not run separately,
  then `make openapi-lint`), and job `ui` (`ui-install`, `ui-fmt-check`, `ui-lint`, `ui-build`,
  which also type-checks).
- `security.yml` — `make vuln` (govulncheck) and `make ui-audit` (`npm audit`) on PRs, pushes to
  `main`, a weekly cron, and manually.

Rules worth preserving:

- Linting is configured in `src/api/.golangci.yml`. Fix findings rather than suppress them; when a
  finding is a false positive, use `//nolint:<linter> // <reason>` on the line (or the line above).
  `nolintlint` rejects directives without a linter or reason, and flags unused ones. Prefer a
  per-line directive over a global exclusion, so new occurrences are still caught.
- Formatting is gofumpt + gci (imports: standard, third-party, then `grepdocs/api`). Run `make fmt`.
  `gofumpt.module-path` must stay set: without a dot in its first element, `grepdocs/api` looks
  like a standard-library path to gofumpt, and it then fights gci over import groups. Editors hit
  the same trap (gofumpt on stdin cannot see `go.mod`), so `.vscode/settings.json` and `.nvim.lua`
  format Go with `golangci-lint fmt` and this config instead; `.nvim.lua` needs `'exrc'` and `:trust`.
- The Go version is the `toolchain` line in `src/api/go.mod`. CI reads it via `go-version-file`
  (setup-go sets `GOTOOLCHAIN=local`), so bumping that line is how CI's Go changes.
- The UI's Node version is `src/ui/.nvmrc`, which CI reads via `node-version-file`, so bumping it
  is how CI's Node changes. `engines` in `package.json` is the minimum the dependencies need, not
  the version to use.
- `make ui-audit` is `npm audit --omit=dev`: runtime dependencies only, like govulncheck's
  reachable-only report. Dev tooling (ESLint, Vite) never ships to the browser, and a finding there
  would fail the build with no runtime impact.
- After any `go get`, check the `go` line in the diff: a dependency (or a `go tool` dependency,
  which shares the module graph) requiring a newer Go raises it silently.
- Versions: govulncheck is pinned by the `tool` directive in `go.mod`, UI packages by
  `package-lock.json`, and actions by commit SHA with a `# vX.Y.Z` comment; Dependabot
  (`.github/dependabot.yml`) bumps all three weekly. The
  golangci-lint version is the `version:` input in `ci.yml`: Dependabot does not touch it, so bump
  it by hand together with your local install.
- The OpenAPI linter is vacuum, run with `go run …@$(VACUUM_VERSION)` from the Makefile (no install
  needed). It is not a `tool` directive on purpose: it requires a newer `go` line than the API's
  and would add its dependencies to the API's module graph. CI downloads the release binary
  instead (compiling it took ~5 min per run), checks it against `VACUUM_SHA256` in `ci.yml`, and
  calls `make openapi-lint VACUUM=vacuum`. Dependabot does not touch it: bump `VACUUM_VERSION` in
  the Makefile and `VACUUM_SHA256` (the `linux_x86_64` line of the release's `checksums.txt`)
  together; a mismatch fails the install step. Warnings fail the build (`--fail-severity warn`): fix the spec rather
  than disabling a rule. The ruleset is `src/api/openapi/vacuum.yaml` (recommended rules); it turns
  off only rules that conflict with a project convention, each with its reason. Locally, the first
  run downloads and compiles vacuum (slow); Go caches the binary, so later runs are fast.
- Workflows get `permissions: contents: read` and `persist-credentials: false`; widen per job only
  when a step needs it.

## Conventions

- Conventional commit messages (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `feat!:`).
- API paths kebab-case, JSON fields `snake_case`.
- `last_refreshed_at` is spelled that way everywhere (migration + queries) — not a typo to "fix".
- `.env` is gitignored and holds real OAuth secrets — never commit, print, or echo it.

## Skills

Reusable workflows live in `.agents/skills/<name>/SKILL.md`. Agents that understand skills load
them on matching requests; if yours doesn't, read the relevant file directly before acting.
`.claude/skills` is a symlink to `../.agents/skills` so Claude Code discovers them — add new skills
under `.agents/skills`, never inside `.claude/skills`.

- `migration-generator` — scaffold new golang-migrate up/down files from a table/column description.
- `roadmap-next` — determine the next task in the current roadmap phase (reads `docs/roadmap.md`,
  open `tech-debt` issues, and `docs/api.md`; read-only, evidence-based).
- `implementation-review` — teaching-first review of hand-written code (rubric in
  `REVIEW-RUBRIC.md`). Advisory by default; only applies fixes on explicit opt-in.
- `phase-status-sync` — close out finished work across `docs/roadmap.md` and
  `docs/roadmap-stakeholders.md`, and name the GitHub issues it closes. Docs only.
- `deep-dive` — Socratic, read-only mentor for understanding how a part of the code works, down to
  dependency/stdlib source, with history, trade-offs, and related patterns. Never edits code.

## Documentation map

- `src/api/openapi/openapi.yaml` — OpenAPI 3.1 spec of the **implemented** endpoints, hand-written
  (spec-first), embedded with `go:embed` and served with Swagger UI at `/api/docs`. Nothing checks
  it against the handlers yet (#107 will generate the server from it with oapi-codegen), so update
  it in the same change as any route, status code, or request/response field. Keep every
  `operationId` equal to its handler's name.
- `docs/api.md` — the API contract. It is a **design proposal**: much of it (repositories,
  documents, search, groups, pagination) is not implemented. Treat it as the target shape for new
  endpoints, and check it before inventing a route or response body.
- `docs/sync-engine.md` — `sync_status` state machine: state diagrams, every transition with its
  query and guard, the invariants that keep concurrent syncs safe, and when a repository stays busy.
  Update it whenever a sync query or its caller changes.
- `docs/requirements.md`, `docs/user-stories.md` — product spec.
- `docs/howto/` — Google OAuth setup, GitHub App setup, golang-migrate workflow, sqlc usage.
- `docs/roadmap.md` — phased build-out plan (not dated), interleaving new features with the open
  `tech-debt` issues each phase depends on or exposes. Update it as phases complete or scope shifts.
  Each phase is a GitHub milestone of the same name whose issues are its tasks; user stories are
  not tracked as issues.
- `docs/roadmap-stakeholders.md` — non-technical companion to `docs/roadmap.md`: same plan grouped
  into Now/Next/Later, feature language only. Keep the two in sync when phases change.

## Tracking work

Open work lives in GitHub issues, not in docs. Review findings and known problems carry the
`tech-debt` label (`gh issue list --label tech-debt --state open`). When you find a new problem
you are not fixing, propose an issue (title in the `type(scope): …` style, and body) to the user
rather than adding a TODO list to a doc. Reference issues as `#NN` from docs and commits.

## Known inconsistencies

- `CLAUDE.md` is only a pointer to this file (Claude Code reads it via an `@AGENTS.md` import).
  This file is the single source of truth — put new guidance here.
