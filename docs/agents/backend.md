# Backend architecture

Moved from `AGENTS.md`. Read it before changing the request pipeline, sessions, the DAL, token
encryption, or response envelopes.

## Request pipeline

`main.go` wires everything; there is no DI container. The only service is `credentials.Service`
(see `docs/agents/git-providers.md`), built once in `main.go` and injected into the routers that call providers.

```
http.Server (explicit timeouts, graceful shutdown on SIGINT/SIGTERM)
  └─ sm.Handle          session middleware — loads/creates session, writes cookie, saves on the way out
      └─ chi router      middleware.Logger / RequestID / Recoverer
          └─ /api
              ├─ GET /ping                          (public)
              ├─ /auth          routers.AuthRoutes             (public: Google OAuth login/callback, logout)
              ├─ /users         routers.UserRoutes             (RequireAuth)
              ├─ /providers     routers.ProvidersRoutes        (RequireAuth)
              ├─ /accounts      routers.ExternalAccountsRoutes (RequireAuth)
              ├─ /repositories  routers.RepositoriesRoutes     (RequireAuth)
              └─ /docs          routers.DocsRoutes             (public; not mounted in production)
```

Each `routers.*Routes(...)` constructor builds a handler struct holding `*pgxpool.Pool` and
`*session.SessionManager`, then returns a `chi.Router` (`DocsRoutes` has no dependencies). Handlers
are receiver methods; they open a `dal.New(h.dbPool)` query set per request and always pass
`r.Context()` to DB and outbound calls.

## Sessions (`src/api/session`, `src/api/models/session.go`)

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

## Data access (`src/api/dal`) — generated, never hand-edited

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

## Token encryption (`src/api/secrets`)

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

## HTTP responses (`src/api/httpx`)

Every response goes through `httpx`. Never use `http.Error` or hand-rolled JSON encoding.

- `WriteJSON(w, status, data)`
- `WriteError(w, status, code, message)` — emits `{"error":{"code","message"}}`, where `code` is one
  of the stable `httpx.Code*` constants and is the machine-readable discriminator. The UI mirrors
  them by hand in `ApiErrorCode` (`src/ui/src/api/client.ts`): add a code to both in one change.
- `WriteErrorWithDetails(w, status, code, message, details)` — same envelope plus an optional
  `details` object, omitted when `details` is empty. `WriteError` calls it with `nil`.
- `WriteInternalError(w, err)` — logs the real error server-side and returns a generic `internal`
  envelope. Internal error strings must never reach the client.

Handlers build response DTOs explicitly (mostly inline `map[string]any`; `providerDTO` is a typed
struct). Token fields from
`external_git_accounts` must be stripped at the DTO layer — see `listExternalAccounts`.

## What the Go tests cover

Unit tests cover sessions, auth
middleware, providers, credentials, response envelopes, the session model, and the `syncqueue`
worker pool (on `testing/synctest`, so its timeouts run on a fake clock). `routers` tests cover
only code that needs no database (`writeProviderError`, `installDetails`, ID parsing, `isValidRedirectPath`, the docs routes,
`GET /providers`, the linking redirect helpers, and the linking-flow paths that end before a DB call); other handlers and
`reposync` stay untested because they hold a concrete `*pgxpool.Pool`, so there is no DB seam yet.
