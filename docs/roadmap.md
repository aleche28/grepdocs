# GrepDocs Roadmap

Phased, not dated — each phase is a scope milestone, not a calendar commitment. Phases are
intended to run roughly in order but security/architecture work is interleaved into the phase
that needs or exposes it, rather than pushed into a separate "hardening" track. Source material:
`docs/api.md` (target API shape), `docs/code-review-checklist.md` (tracked findings, `[ ]` =
open), `docs/requirements.md` / `docs/user-stories.md` (product spec).

## Baseline (today)

Implemented: Google OAuth login, session management (Redis-backed), GitHub account linking
(OAuth, **one account per provider per user**), GitHub repository discovery for a linked account,
self-service user endpoints. No tracked repositories, documents, search, groups, commit-back, or
UI yet. No tests/CI.

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
Still open in this phase: the seed tests (E1).

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
  since GitHub tokens don't refresh.
- **Token encryption (checklist A2/D1)**: `access_token`/`refresh_token` are plaintext today. Add
  at-rest encryption (app-level AEAD or KMS envelope) before the number of stored tokens grows
  with multi-account. **Done** — app-level AES-256-GCM in the `secrets` package, keyed by a
  base64 `TOKEN_ENCRYPTION_KEY` validated at startup; ciphertext is versioned (`v1:`) and
  base64-encoded for safe storage in the existing `TEXT` columns. KMS envelope remains a future
  swap behind `secrets.Cipher`.
- **Tests (checklist E1, started here not deferred)**: first unit tests for session lifecycle and
  an OAuth callback integration test (fake provider via `httptest`) — the riskiest logic in the
  app, and this phase touches it directly.

## Phase 2 — Repository tracking

- `POST/GET/PATCH/DELETE /api/repositories`, `GET /repositories/{id}/branches`.
- Track a repo from a linked account **or** by public `owner`/`name` (no account needed for public
  GitHub repos, per `docs/api.md`).
- Sync engine: clone/pull the tracked branch, record `tracked_commit`/`last_sync_at`/
  `sync_status`, `POST /repositories/{id}/sync` to trigger on demand.
- **Token refresh (checklist D3)**: `UpdateExternalGitAccountTokens` is generated but never
  called. Wire it up now — unattended sync jobs are the first thing that will hit an expired
  token.

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
