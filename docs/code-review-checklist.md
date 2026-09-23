# GrepDocs Backend Review Checklist

Source: senior review of `src/api` (first critique). One item per checkbox, update with
the file/commit that closed it.

Legend: `[x]` done · `[ ]` open · last updated 2026-09-23

## A. Security

- [x] **A1 — `GET /users/{id}` leaked any user's PII** (email, google_id) to any authenticated user.
      Fixed by removing the route (`routers/users.go`); users are private, self-only per `docs/api.md`.
- [x] **A2 — Provider tokens stored in plaintext** (`external_git_accounts.access_token` /
      `refresh_token`, scope `repo` = full write access to private repos). Fixed: app-level
      AES-256-GCM (`secrets` package) encrypts tokens before persistence and decrypts on read;
      key from base64 `TOKEN_ENCRYPTION_KEY`, validated at startup. Ciphertext is versioned
      (`v1:`) and base64-encoded so it is TEXT-safe. A KMS envelope can replace the impl behind
      the `secrets.Cipher` interface later. Existing plaintext rows must be re-linked (no
      backfill yet).
- [x] **A3 — Missing `return` after invalid redirect-path check** in `googleCallback` (latent
      open redirect). Fixed: handler now returns before redirecting.
- [x] **A4 — Server error details returned to clients** (`http.Error(..., err.Error())` in
      `auth.go`, `external_git_accounts.go`, middleware 401s). Fixed: `httpx.WriteError` /
      `WriteInternalError` everywhere; real errors are logged server-side (`httpx`), clients get a
      generic `{"error":{"code":"internal"}}` envelope.
- [x] **A5 — Session cookie `Domain` hardcoded to `localhost`** (`session/responsewriter.go`,
      `session/manager.go` ClearCookie). Fixed: `Domain` field removed from both cookies —
      host-only cookie, portable across any deploy domain.
- [x] **A6 — OAuth state handling inconsistent**: Google state is session-bound & single-use, but
      provider state lives in a plain cookie (`{provider}_oauth_state`). Fixed: provider state now
      uses the same session-bound, single-use mechanism as Google
      (`sess.SetOAuthStateToken` / `GetOAuthStateToken`); plaintext cookie removed.
- [ ] **A7 — No CORS and no rate limiting** on auth/read endpoints. Blocking once a real frontend
      or public deployment exists.

## B. Real bugs

- [x] **B1 — `GET /repositories/github` returned double-encoded JSON** (fetch → raw string →
      `respondJSON`). Endpoint removed; the design it proxied will be rebuilt properly
      (`GET /accounts/{provider}/repositories`).
- [x] **B2 — `fetchGoogleUserInfo` uses `req` before checking the `http.NewRequest` error**
      (`routers/auth.go:187`). Fixed: `http.NewRequestWithContext` + `err` check in both
      `fetchGoogleUserInfo` and `fetchGitHubUserInfo`; callers pass `r.Context()`.
- [x] **B3 — `GetUserByGoogleId` treats every error as "user not found"** (`routers/auth.go`).
      Use `errors.Is(err, pgx.ErrNoRows)` + `INSERT ... ON CONFLICT` + re-select.
- [x] **B4 — Outbound GitHub/Google HTTP calls have no timeout and no request context**
      (`&http.Client{}` per call). Fixed: shared `httpClient{Timeout: 10s}` in `routers/http.go`;
      both fetchers use `r.Context()` (see C4) + the shared timed client.

## C. Architecture

- [x] **C1 — No service / provider abstraction layer.** Fixed: new `providers` package
      (`Provider` interface, `Registry`, GitHub impl in `providers/github.go`) — handlers depend on
      the interface, `main.go` builds the registry, GitHub HTTP/OAuth code moved out of
      `routers/external_git_accounts.go`, and provider failures are normalized to
      `ErrInvalidToken`/`ErrRateLimited` and mapped to `403`/`429`. A service/use-case layer was
      deliberately **not** added yet — deferred to Phase 2, where sync orchestration gives it real
      work.
- [x] **C2 — No shared auth middleware.** Fixed: `middleware/middleware.go` provides
      `RequireAuth(sm)` (JSON-less plain 401 today, see C5) and `CurrentUserID(r)`; wired into the
      `users` and `accounts` routers. Handlers no longer re-check `GetSession`.
- [x] **C3 — Inconsistent handler shapes** (closures taking unused `*pgxpool.Pool`, dead params).
      Fixed: remaining handlers are plain receiver methods on `h.dbPool`; dead closure params removed.
- [x] **C4 — `context.Background()` everywhere** instead of `r.Context()`; cancels don't propagate,
      outbound calls can't be aborted. Fixed: all request-scoped DB/OAuth/HTTP work in
      `auth.go`, `users.go`, `external_git_accounts.go` now uses `r.Context()`. Only remaining
      `Background()` are process-lifetime (session GC goroutine, `pgxpool.New` at startup).
      Timeout half is tracked under B4.
- [x] **C5 — Inconsistent error/response contract**: `http.Error` (text) mixed with `respondJSON`
      and a bare-string `404`; the new middleware 401 is `text/plain` too. Fixed: new
      `httpx` package (`WriteJSON`, `WriteError`, `WriteInternalError`, stable `Code*` constants)
      used by routers + middleware; `respondJSON` deleted; all responses use the
      `{"error":{"code","message"}}` envelope from `docs/api.md`.
- [x] **C6 — Duplicate endpoints with divergent shapes**: `/auth/whoami` and `/users/me`.
      Fixed: `/whoami` removed; `GET /users/me` returns the canonical DTO (no `google_id`).
- [ ] **C7 — Config is inconsistent**: `main.go` builds `AppConfig`, routers read
      `os.Getenv(...)` at construction. Consolidate config loading in one place.
- [ ] **C8 — Session write amplification**: `Handle` saves + cookie-fies every request, including
      anonymous (bots hitting `/ping` create Redis keys). Only persist when the session mutated.
- [x] **C9 — Minor hygiene**: `go-redis` was listed `// indirect` in `go.mod` (fixed by
      `go mod tidy`, now a direct dep); `fmt.Printf` for errors replaced with `log.Printf`
      (`session/manager.go`); string literal `"github"` replaced with `providerGithub` const.
- [x] **C10 — Server has no timeouts and no graceful shutdown** (`main.go` ran a bare
      `ListenAndServe`). Fixed: `http.Server` timeouts (ReadHeader 5s, Read 10s, Write 30s,
      Idle 60s) + `signal.NotifyContext` + `server.Shutdown` on SIGINT/SIGTERM. WriteTimeout
      (30s) is sized above the outbound OAuth timeout (B4, 10s) + DB roundtrip so slow logins
      aren't killed by the server write deadline.

## D. Database / DAL

- [x] **D1 — Tokens at rest plaintext** (dup of A2; closed with A2 — see `secrets` package).
- [x] **D2 — `user_id BIGSERIAL` FK in migration `000002`** should be `BIGINT` (BIGSERIAL implies
      auto-generate). Fixed: new migration `000003` drops the id default + sequence; applied and
      verified in the live schema.
- [ ] **D3 — `UpdateExternalGitAccountTokens` generated but never called; no token refresh path.**
      Bitbucket (short-lived tokens) makes this mandatory.
- [x] **D4 — First-login upsert race on `google_id`** handled clunkily (see B3). Prefer `ON CONFLICT`.
- [ ] **D5 — `username` column defaults to `''` and is never populated** — dead weight unless it's a
      product feature.

## E. Testing & quality

- [ ] **E1 — No tests or CI** in a codebase whose riskiest logic is sessions + OAuth. Add unit tests
      (session lifecycle, `RequireAuth`) and an OAuth callback integration test with a fake provider
      (`httptest`); at minimum a `ping` smoke test in CI. `go vet`/`go fmt` won't catch the bugs in B.

## Completed during refactor (out of the original list)

- [x] Route table aligned with `docs/api.md` (renames only): `/ext-accounts` → `/accounts`,
      `{provider}`-parameterized OAuth routes, removed `/repositories/github`, `whoami`.
- [x] `UserId`/`GetUserId`/`SetUserId` renamed to `UserID` (incl. sqlc query
      `GetExternalGitAccountsByUserID` via `sqlc generate`).
