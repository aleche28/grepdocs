# GrepDocs API Design

Version: v1 (proposal — expected to change during development)
Base path: `/api`

This document is the API contract for GrepDocs. Most of it is a **design proposal**: many
resources below (repositories, documents, search, groups) have no route, handler, or database
table yet. Every endpoint and DTO field is marked **Implemented** or **Proposed** so it's clear
what exists today versus what new work should target. Check this file before inventing a route or
response shape — if something is marked Proposed, build it to match this shape rather than
improvising a new one.

---

## Conventions

- **Paths**: kebab-case, lowercase (`/api/accounts`, not `/api/Accounts` or `/api/account_list`).
- **Fields**: `snake_case` in every JSON body, request or response.
- **Auth**: cookie session (Redis-backed session manager). Every route under `/api` requires
  authentication except `GET /api/ping` and the three routes under `/api/auth` (login, callback,
  logout). Authenticated routes reject unauthenticated requests with `401 not_authenticated`.
- **Providers**: `provider` is one of `github`, `bitbucket` (later `gitlab`). A syntactically
  invalid value (not in the enum) should return `400 bad_request`. A valid provider with no
  implementation yet (`bitbucket` today) returns `501 not_implemented` — this distinction is
  **Proposed**; the current code returns `501` for any non-`github` value without checking
  whether it's a real provider name.
- **Pagination**: list endpoints are proposed to accept `?page=1&size=50` (defaults `1`/`50`, max
  `size` `100`) and respond with `{ "items": [...], "page": 1, "size": 50, "total": 123 }`. This is
  **Proposed** — the one list endpoint implemented today (`GET /api/accounts`) returns a bare JSON
  array with no pagination envelope.
- **Errors**: every error body has the shape below. HTTP status is the coarse signal; `code` is
  the stable, machine-readable discriminator, and error bodies never leak internal error strings
  (`httpx.WriteInternalError` logs the real error server-side and returns a generic message).

  ```json
  {
    "error": {
      "code": "not_authenticated",
      "message": "You must be signed in"
    }
  }
  ```

  | Status | `code`             | Meaning                                            |
  | ------ | ------------------ | --------------------------------------------------- |
  | 400    | `bad_request`       | Malformed input (bad body, invalid enum value, ...) |
  | 401    | `not_authenticated` | No valid session                                    |
  | 403    | `forbidden`         | Authenticated, but not the resource owner           |
  | 404    | `not_found`         | Resource does not exist                             |
  | 409    | `conflict`          | Upstream state changed under the request            |
  | 500    | `internal`          | Server error                                        |
  | 501    | `not_implemented`   | Provider or feature not implemented yet             |

  Endpoints that validate a request body against domain rules (e.g. committing drafts) may need a
  `422`/`validation_failed` pair for "well-formed but semantically invalid" cases — **Proposed**,
  not yet in `httpx`'s code list; add it there first if an endpoint needs it.

---

## Health

| Method | Path    | Auth | Status      | Description                    |
| ------ | ------- | ---- | ----------- | ------------------------------ |
| GET    | `/ping` | N    | Implemented | Health check, returns `pong`.  |

## Auth

| Method | Path                     | Auth | Status                          | Description                    |
| ------ | ------------------------ | ---- | -------------------------------- | ------------------------------ |
| GET    | `/auth/google/login`     | N    | Implemented (`redirect` Proposed) | Start Google OAuth login       |
| GET    | `/auth/google/callback`  | N    | Implemented                      | Google OAuth callback          |
| POST   | `/auth/logout`           | N    | Implemented                      | Destroy session                |

**`GET /api/auth/google/login`** redirects the browser to Google's consent screen. It generates a
one-time `state`, stores it in the session, and requests `AccessTypeOffline`.

- **Proposed**: an optional `?redirect=/some/path` query parameter, validated against a
  server-side whitelist of relative paths (must start with `/`, no `//`, on the whitelist) and
  stored alongside `state`, so the callback can bounce back to where the user started instead of
  always to `/`. Never allow arbitrary URLs (open-redirect risk).
- Today the redirect target is hardcoded to `/`, and the existing `isValidRedirectPath` check only
  enforces "starts with `/`, no `//`" — there is no whitelist yet.

**`GET /api/auth/google/callback`** exchanges `code`, verifies `state` (single-use — read once
from the session, which clears it), loads-or-creates the user by Google ID, regenerates the
session ID (anti-fixation), and redirects to `FRONTEND_URL` + the stored redirect path.

| Query   | Description                          |
| ------- | ------------------------------------- |
| `code`  | Authorization code from Google        |
| `state` | Must match the session-stored value   |

**`POST /api/auth/logout`** clears the session cookie and its Redis entry. Idempotent: succeeds
even when there is no session.

## Users

| Method | Path        | Auth | Status      | Description                                   |
| ------ | ----------- | ---- | ----------- | ---------------------------------------------- |
| GET    | `/users/me` | Y    | Implemented | Current user profile                           |
| PATCH  | `/users/me` | Y    | Proposed    | Update own profile (e.g. `username`)           |
| DELETE | `/users/me` | Y    | Proposed    | Permanently delete own account + linked data   |

There is deliberately no `GET /api/users/{id}`: users are private, and no cross-user collaboration
is planned, so only self endpoints exist.

`GET /api/users/me` response (canonical user DTO, matches the current handler exactly):

```json
{
  "id": 42,
  "fullname": "Ada Lovelace",
  "username": "ada",
  "email": "ada@example.com",
  "created_at": "2026-01-01T00:00:00Z"
}
```

`PATCH /api/users/me` body (Proposed) — subset of editable fields:

```json
{ "username": "ada" }
```

## External accounts (linked git providers)

| Method | Path                             | Auth | Status                        | Description                                                    |
| ------ | --------------------------------- | ---- | ------------------------------ | ---------------------------------------------------------------- |
| GET    | `/accounts`                       | Y    | Implemented (no pagination)    | List linked accounts (sanitized, **no tokens**)                  |
| GET    | `/accounts/{provider}/login`      | Y    | Implemented for `github`       | Redirect: start linking a provider account                       |
| GET    | `/accounts/{provider}/callback`   | Y    | Implemented for `github`       | Provider OAuth callback (verify state, store tokens, redirect)   |
| GET    | `/accounts/{provider}/repositories` | Y  | Implemented for `github` (no filtering yet) | Discover repos from a linked account (`?account_id=` disambiguates) |
| DELETE | `/accounts/{id}`                  | Y    | Implemented                    | Unlink account (must own it)                                      |

`bitbucket` (and any other non-`github` value) currently returns `501 not_implemented` on all four
provider-scoped routes.

`GET /api/accounts` item (implemented shape, tokens stripped at the DTO layer):

```json
{
  "id": 3,
  "provider": "github",
  "provider_user_id": "123456",
  "label": "",
  "linked_at": "2026-03-02T10:11:12Z",
  "last_refreshed_at": "2026-03-02T10:11:12Z",
  "token_expires_at": "2027-03-02T10:11:12Z"
}
```

`label` exists in the schema so a user can tell multiple accounts for one provider apart (e.g.
"personal" vs "work"). It is read-only for now (always `""`); no write endpoint exists yet.

A user may link more than one account per provider. `GET /api/accounts/{provider}/repositories`
therefore accepts `?account_id=` to select which linked account to read from. The account must
belong to the caller. With exactly one linked account the parameter is optional; with several,
omitting it returns `400 bad_request` rather than guessing.

`GET /api/accounts/{provider}/repositories` returns the account's repositories normalized to a
provider-neutral shape; GitHub pagination is followed internally. **Not yet implemented**: the
`q`/`private`/`type` filters below and the `tracked` marker.

- Each item includes: `provider`, `provider_repo_id` (**string** — Bitbucket uses UUIDs),
  `name`, `full_name`, `html_url`, `is_private`, `default_branch`.
- Filters (Proposed): `?q=`, `?private=true|false`, `?type=owner|member|all`, plus the standard
  pagination params.
- `tracked: true` will be added to each item once repositories can be tracked (Phase 2).

Failures: `403 forbidden` when the stored token is invalid or revoked (the user must re-link the
account), `429 rate_limited` when the provider's rate limit is hit, `501 not_implemented` for a
provider that has no registered implementation.

Both provider OAuth routes verify a single-use, session-bound `state` value the same way as
Google login — a linking flow using a state cookie instead of the session would be a regression,
not an alternative implementation.

## Repositories (tracked)

**Proposed** — no route, handler, or database table exists yet.

| Method | Path                              | Auth | Description                                                    |
| ------ | ---------------------------------- | ---- | ---------------------------------------------------------------- |
| GET    | `/repositories`                    | Y    | List tracked repos (filters: `provider`, `group`, `has_draft`)    |
| POST   | `/repositories`                    | Y    | Track a repository                                                |
| GET    | `/repositories/{id}`               | Y    | Repo detail incl. sync + branch status                            |
| PATCH  | `/repositories/{id}`               | Y    | Change tracked branch, `auto_sync`, etc.                          |
| DELETE | `/repositories/{id}`               | Y    | Untrack (removes resolved docs + drafts)                          |
| GET    | `/repositories/{id}/branches`      | Y    | List branches                                                     |
| POST   | `/repositories/{id}/sync`          | Y    | Trigger a sync now                                                |
| GET    | `/repositories/{id}/tree`          | Y    | Browse file tree (`?path=docs/&ref=<sha>`, S3.1)                  |
| GET    | `/repositories/{id}/tracking`      | Y    | Show include/exclude pattern rules                                |
| PUT    | `/repositories/{id}/tracking`      | Y    | Set file tracking rules (S3.2/3.3/3.4)                            |
| POST   | `/repositories/{id}/commits`       | Y    | Push selected drafts back to the repo                             |
| GET    | `/repositories/{id}/commits`       | Y    | Commit history for this repo                                      |

`POST /api/repositories` body — a repository can be tracked from a linked account **or** by public
`owner`/`name` (public GitHub repos need no linked account, per requirements):

```json
{
  "provider": "github",
  "account_id": 3,
  "provider_repo_id": "123456",
  "owner": "acme",
  "name": "docs",
  "tracked_branch": "main"
}
```

`POST /api/repositories/{id}/commits` body — each file must reference a document that currently
has a draft:

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
- Commit is atomic per repository: all selected drafts push in one REST call. A partial upstream
  failure should return per-file status rather than a bare error.

## Documents (tracked doc files)

**Proposed** — no route, handler, or database table exists yet. First-class top-level resource
(`/api/documents`) so cross-repository operations aren't buried under repository routes.

| Method | Path                            | Auth | Description                                                        |
| ------ | -------------------------------- | ---- | --------------------------------------------------------------------- |
| GET    | `/documents`                     | Y    | List docs across tracked repos (filters: `repo_id`, `group`, `provider`, `has_draft`) |
| GET    | `/documents/{id}`                | Y    | Doc metadata + current content (draft if present, else upstream)      |
| GET    | `/documents/{id}/raw`            | Y    | Raw Markdown source                                                    |
| GET    | `/documents/{id}/rendered`       | Y    | Rendered HTML (server-side Markdown render)                            |
| GET    | `/documents/{id}/diff`           | Y    | Unified diff: draft vs upstream (empty if no draft)                    |
| PUT    | `/documents/{id}`                | Y    | Save/edit draft content                                                |
| DELETE | `/documents/{id}/draft`          | Y    | Discard draft, revert to upstream content                              |

Editing a document writes a **draft** that is never pushed on its own; the commit endpoint above
pushes selected drafts back to the repository with a user-provided message.

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
  "content": "# GrepDocs\n...",
  "draft_message": "typo fix"
}
```

`content` is the draft if one exists, else the upstream content.

`PUT /api/documents/{id}` body:

```json
{ "content": "# GrepDocs\n...", "message": "typo fix" }
```

## Search

**Proposed** — no route, handler, or index exists yet.

| Method | Path      | Auth | Description                              |
| ------ | --------- | ---- | ------------------------------------------- |
| GET    | `/search` | Y    | Full-text search across all tracked docs    |

`GET /api/search?q=oauth&repo=acme/docs&group=backend&provider=github&page=1&size=50`

Filters: `q` (required), `repo` (repo id or full name), `group`, `provider`, plus the standard
pagination params.

Result item — snippet with match highlighting (S5.3):

```json
{
  "document_id": 9,
  "repository": "acme/docs",
  "path": "docs/README.md",
  "snippet": "…supports <mark>OAuth</mark> login…",
  "line": 12
}
```

## Groups

**Proposed** — no route, handler, or database table exists yet.

| Method | Path                                | Auth | Description                          |
| ------ | ------------------------------------ | ---- | --------------------------------------- |
| GET    | `/groups`                            | Y    | List groups (with repo counts)          |
| POST   | `/groups`                            | Y    | Create group                            |
| GET    | `/groups/{id}`                       | Y    | Group detail incl. assigned repos       |
| PATCH  | `/groups/{id}`                       | Y    | Rename                                  |
| DELETE | `/groups/{id}`                       | Y    | Delete group (repos kept)               |
| PUT    | `/groups/{id}/repositories/{repoId}` | Y    | Assign repo to group (idempotent)       |
| DELETE | `/groups/{id}/repositories/{repoId}` | Y    | Unassign repo                           |

`POST /api/groups` body: `{ "name": "Backend" }`

---

## Appendix A: user-story coverage

See `docs/user-stories.md` for the full stories. Endpoints without a checked box above are
Proposed, so most of this table currently maps to work not yet started.

| Story                                  | Endpoints                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| S1.1 Google auth                        | `GET /auth/google/login`, `GET /auth/google/callback`, `POST /auth/logout`, `GET /users/me`  |
| S1.2/S1.3 Link provider                 | `GET /accounts/{provider}/login`, `GET /accounts/{provider}/callback`                        |
| S1.4 Unlink                             | `DELETE /accounts/{id}`                                                                      |
| S1.5 View linked accounts               | `GET /accounts`                                                                              |
| S2.1/S2.2 Available repos               | `GET /accounts/{provider}/repositories?q=&private=`                                          |
| S2.3/S2.4 Track/untrack                 | `POST /repositories`, `DELETE /repositories/{id}`                                            |
| S2.5 Branch selection                   | `PATCH /repositories/{id}`                                                                   |
| S2.6 Pull latest                        | `POST /repositories/{id}/sync`                                                               |
| S3.1 Browse files                       | `GET /repositories/{id}/tree`                                                                |
| S3.2–S3.4 Select/exclude tracked files  | `GET`/`PUT /repositories/{id}/tracking`                                                      |
| S4.1/S4.2 Rendered / raw                | `GET /documents/{id}/rendered`, `GET /documents/{id}/raw`                                    |
| S4.3 Navigate                           | `GET /repositories/{id}/tree`, `GET /documents`                                              |
| S4.4 Origin (repo + branch)             | fields on document DTO                                                                        |
| S5.1–S5.3 Search + filter + highlight   | `GET /search`                                                                                 |
| S6.1/S6.2 Edit + preview                | `PUT /documents/{id}`, `GET /documents/{id}/rendered`                                        |
| S6.3 Commit w/ message                  | `POST /repositories/{id}/commits`                                                             |
| S6.4 Diff                               | `GET /documents/{id}/diff`                                                                    |
| S6.5 Conflicts                          | `409` on commit when upstream changed since the last sync                                     |
| S7.1–S7.4 Groups                        | `GET`/`POST`/`PATCH`/`DELETE /groups` + membership routes                                     |
| S8.1/S8.2 Sync + status                 | `POST /repositories/{id}/sync`, fields on repo DTO                                             |
| S8.3 Sync failure warning               | `sync_status`/`last_sync_at` fields on repo DTO                                                |
| S8.4 Auto-sync toggle                   | `PATCH /repositories/{id}` (`auto_sync`)                                                      |

## Appendix B: out of scope for v1

Deliberately excluded: public user profiles, roles/permissions, webhooks for provider events, and
OAuth token refresh endpoints (handled internally by the provider layer, not exposed as an API).
