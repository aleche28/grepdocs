# GrepDocs API Design

Version: v1 (proposal — expected to change during development)

Base path: `/api`

## Design decisions

1. **First-class documents.** Tracked doc files are top-level resources (`/api/documents`) so
   cross-repository operations are not buried under repository routes.
2. **Drafts + explicit commit.** Editing a document writes a *draft* (never pushed). A dedicated
   commit endpoint pushes selected drafts back to the repository with a user-provided message.
3. **Private users only.** As of now (but might change in the future), no collaboration among users is planned,
   so `GET /users/{id}` is dropped. Only self endpoints exist (`/api/users/me`).
4. **REST-style resources, JSON bodies, snake_case fields.**
   - Paths: kebab-case, lowercase.
   - Fields: `snake_case`.
5. **Consistent error envelope.**

   ```json
   { "error": { "code": "not_authenticated", "message": "You must be signed in" } }
   ```

   HTTP status is the coarse signal; `code` is the stable machine-readable discriminator.
   Every endpoint can return `401` (not authenticated), `400` (bad request), `403`
   (not the owner), `404` (not found), `409` (conflict, e.g. upstream change), `500` (server error).
   `4xx`/`5xx` bodies never leak internal error strings.
6. **Authentication.** Cookie session (existing Redis-backed session manager). All endpoints under
   `/api` require authentication except `/ping` and the OAuth login/callback routes.
7. **Providers.** `provider` is always `github` or `bitbucket` (one day `gitlab`). Unknown provider
   values → `400`.
8. **Pagination.** List endpoints accept `?page=1&size=50` (defaults `1`/`50`, `size` max `100`).
   Response shape: `{ "items": [...], "page": 1, "size": 50, "total": 123 }`.

---

## Endpoints

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/ping` | N | Health check, returns `pong`. |

### `GET /api/auth/google/login` — start Google login

Redirects the browser to Google's OAuth consent screen.

- Query: `?redirect=/some/path` optional. **Only** validated relative paths are allowed
  (must start with `/`, no `//`, must be on a server-side whitelist). Never allow arbitrary URLs.
- Stores one-time `state` + `redirect` in the session.

### `GET /api/auth/google/callback` — Google OAuth callback

Exchanges `code`, verifies `state` (single-use), loads-or-creates the user, regenerates the session
ID (anti-fixation), bounces to `FRONTEND_URL + redirect`.

| Query | Description |
| --- | --- |
| `code` | Authorization code from Google |
| `state` | Must match the session-stored value |

### `POST /api/auth/logout` — destroy session

Clears the session cookie + Redis entry. Idempotent: succeeds even if there is no session.

### Users

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/users/me` | Y | Current user profile |
| PATCH | `/api/users/me` | Y | Update own profile (e.g. `username`) |
| DELETE | `/api/users/me` | Y | Permanently delete own account + linked data |

`GET /api/users/me` response (canonical user DTO):

```json
{
  "id": 42,
  "fullname": "Ada Lovelace",
  "username": "ada",
  "email": "ada@example.com",
  "created_at": "2026-01-01T00:00:00Z"
}
```

`PATCH /api/users/me` body — subset of editable fields:

```json
{ "username": "ada" }
```

### External accounts (linked git providers)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/accounts` | Y | List linked accounts (sanitized, **no tokens**) |
| GET | `/api/accounts/{provider}/login` | Y | Redirect: start linking a provider account |
| GET | `/api/accounts/{provider}/callback` | Y | Provider OAuth callback (verify state, store tokens, redirect) |
| GET | `/api/accounts/{provider}/repositories` | Y | Discover available repos from a linked provider account |
| DELETE | `/api/accounts/{id}` | Y | Unlink account (must own it) |

`GET /api/accounts` item:

```json
{
  "id": 3,
  "provider": "github",
  "provider_user_id": "123456",
  "linked_at": "2026-03-02T10:11:12Z",
  "last_refreshed_at": "2026-03-02T10:11:12Z",
  "token_expires_at": "2027-03-02T10:11:12Z"
}
```

Filters: `?q=`, `?private=true|false`, `?type=owner|member|all`.
Pagination applies. Each item includes: `provider`, `provider_repo_id`, `name`, `full_name`,
`html_url`, `is_private`, `default_branch`, and whether it is already tracked (`tracked: true`).

### Tracked repositories

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/repositories` | Y | List tracked repos (filters: `provider`, `group`, `has_draft`) |
| POST | `/api/repositories` | Y | Track a repository |
| GET | `/api/repositories/{id}` | Y | Repo detail incl. sync + branch status |
| PATCH | `/api/repositories/{id}` | Y | Change tracked branch, `auto_sync`, etc. |
| DELETE | `/api/repositories/{id}` | Y | Untrack (removes resolved docs + drafts) |
| GET | `/api/repositories/{id}/branches` | Y | List branches |
| POST | `/api/repositories/{id}/sync` | Y | Trigger a sync now |
| GET | `/api/repositories/{id}/tree` | Y | Browse file tree (`?path=docs/&ref=<sha>` for S3.1) |
| GET | `/api/repositories/{id}/tracking` | Y | Show include/exclude pattern rules |
| PUT | `/api/repositories/{id}/tracking` | Y | Set file tracking rules (S3.2/3.3/3.4) |
| POST | `/api/repositories/{id}/commits` | Y | Push selected drafts back to the repo |
| GET | `/api/repositories/{id}/commits` | Y | Commit history for this repo |

`POST /api/repositories` body — repository can be tracked from a linked account **or** by public
`owner`/`name` (GitHub public repos need no account, per requirements):

```json
{
  "provider": "github",
  "account_id": 3,
  "provider_repo_id": 123456,
  "owner": "acme",
  "name": "docs",
  "tracked_branch": "main"
}
```

`POST /api/repositories/{id}/commits` body — files reference documents that currently have drafts:

```json
{
  "message": "docs: update README and API reference",
  "files": ["docs/README.md", "docs/api.md"]
}
```

Responses:

- `201` with the created commit (`{ "sha": "...", "web_url": "..." }`).
- `409` if any file changed upstream since the last sync (conflict — user must pull/sync first).
- `422` if a referenced file has no draft.

### Documents (tracked doc files)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/documents` | Y | List docs across tracked repos (filters: `repo_id`, `group`, `provider`, `has_draft`) |
| GET | `/api/documents/{id}` | Y | Doc metadata + current content (draft if present, else upstream) |
| GET | `/api/documents/{id}/raw` | Y | Raw Markdown source |
| GET | `/api/documents/{id}/rendered` | Y | Rendered HTML (server-side Markdown render) |
| GET | `/api/documents/{id}/diff` | Y | Unified diff: draft vs upstream (empty if no draft) |
| PUT | `/api/documents/{id}` | Y | Save/edit draft content |
| DELETE | `/api/documents/{id}/draft` | Y | Discard draft, revert to upstream content |

Document DTO:

```json
{
  "id": 9,
  "repository_id": 2,
  "repository": "acme/docs",
  "provider": "github",
  "branch": "main",
  "path": "docs/README.md",
  "has_draft": true,
  "synced_at": "2026-03-02T10:11:12Z",
  "upstream_commit": "abcd123...",
  "content": "# GrepDocs\n...",     // draft if present, else upstream
  "draft_message": "typo fix"
}
```

`PUT /api/documents/{id}` body:

```json
{ "content": "# GrepDocs\n...", "message": "typo fix" }
```

### Search

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/search` | Y | Full-text search across all tracked docs |

`GET /api/search?q=oauth&repo=acme/docs&group=backend&provider=github&page=1&size=50`

Filters: `q` (required), `repo` (repo id or full name), `group`, `provider`, optional `page`/`size`.

Result item — snippet + match highlighting (S5.3):

```json
{
  "document_id": 9,
  "repository": "acme/docs",
  "path": "docs/README.md",
  "snippet": "…supports <mark>OAuth</mark> login…",
  "line": 12
}
```

### Groups

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/groups` | Y | List groups (with repo counts) |
| POST | `/api/groups` | Y | Create group |
| GET | `/api/groups/{id}` | Y | Group detail incl. assigned repos |
| PATCH | `/api/groups/{id}` | Y | Rename |
| DELETE | `/api/groups/{id}` | Y | Delete group (repos kept) |
| PUT | `/api/groups/{id}/repositories/{repoId}` | Y | Assign repo to group (idempotent) |
| DELETE | `/api/groups/{id}/repositories/{repoId}` | Y | Unassign repo |

`POST /api/groups` body: `{ "name": "Backend" }`

---

## User-story coverage

| Story | Endpoints |
| --- | --- |
| S1.1 Google auth | `GET /auth/google/login`, `GET /auth/google/callback`, `POST /auth/logout`, `GET /users/me` |
| S1.2/S1.3 Link provider | `GET /accounts/{provider}/login`, `GET /accounts/{provider}/callback` |
| S1.4 Unlink | `DELETE /accounts/{id}` |
| S1.5 View linked accounts | `GET /accounts` |
| S2.1/S2.2 Available repos | `GET /accounts/{provider}/repositories?q=&private=` |
| S2.3/S2.4 Track/untrack | `POST /repositories`, `DELETE /repositories/{id}` |
| S2.5 Branch selection | `PATCH /repositories/{id}` |
| S2.6 Pull latest | `POST /repositories/{id}/sync` |
| S3.1 Browse files | `GET /repositories/{id}/tree` |
| S3.2–S3.4 Select/exclude tracked files | `GET`/`PUT /repositories/{id}/tracking` |
| S4.1/S4.2 Rendered / raw | `GET /documents/{id}/rendered`, `GET /documents/{id}/raw` |
| S4.3 Navigate | `GET /repositories/{id}/tree`, `GET /documents` |
| S4.4 Origin (repo + branch) | fields on document DTO |
| S5.1–S5.3 Search + filter + highlight | `GET /search` |
| S6.1/S6.2 Edit + preview | `PUT /documents/{id}`, `GET /documents/{id}/rendered` |
| S6.3 Commit w/ message | `POST /repositories/{id}/commits` |
| S6.4 Diff | `GET /documents/{id}/diff` |
| S6.5 Conflicts | `409` on commit/diff when upstream changed |
| S7.1–S7.4 Groups | `GET`/`POST`/`PATCH`/`DELETE /groups` + membership routes |
| S8.1/S8.2 Sync + status | `POST /repositories/{id}/sync`, fields on repo DTO |
| S8.3 Sync failure warning | `sync_status`/`last_sync_at` fields on repo DTO |
| S8.4 Auto-sync toggle | `PATCH /repositories/{id}` (`auto_sync`) |

---

## Changes vs current implementation

| Current | New |
| --- | --- |
| `GET /api/auth/whoami` | `GET /api/users/me` (removed `whoami`; one canonical user DTO) |
| `GET /api/users/{id}` | **Removed** (no authorization model; user private) |
| `GET /api/users/me` | Kept, but returns the canonical DTO (no `google_id` leak) |
| `/api/ext-accounts/*` | `/api/accounts/*` (renamed) |
| `GET /api/repositories/github` (proxy returning raw GitHub JSON string) | `GET /api/accounts/{provider}/repositories` + `POST /api/repositories` (tracking becomes the real resource) |
| `GET /api/ping` | Kept |
| `GET /api/auth/google/login`, `GET /api/auth/google/callback`, `POST /api/auth/logout` | Kept; `login` gains validated `?redirect=`; callback fixed to always return after error |
| — | New: tracked repos CRUD, `tree`, `tracking`, `sync`, `documents`, `search`, `commits`, `groups` |

Deliberately **out of scope for v1**: public user profiles, roles/permissions, webhooks for
provider events, OAuth token refresh endpoints (handled internally by the provider layer).

---

## Notes for implementation

- **Auth middleware**: one shared `RequireAuth` chi middleware replacing the per-handler
  `GetSession/IsAuthenticated` copies.
- **Never expose tokens**: account DTOs and repo browse responses must strip
  `access_token`/`refresh_token` (schema already supports `dal` field hygiene — do it at the DTO layer).
- **OAuth `state` is single-use and session-bound** for both Google and provider linking
  (fix the current cookie-based GitHub state).
- **`redirect` on login is relative and whitelisted only** — prevents open redirect.
- **Commit is atomic per repository**: all selected drafts push in one REST call; partial failure
  returns per-file status.
