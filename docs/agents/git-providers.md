# Git providers

Moved from `AGENTS.md`. Read it before touching `src/api/providers`, `src/api/credentials`, token
refresh or revocation, or the account-linking flow.

Only GitHub is implemented, behind the `providers.Provider` interface + `Registry` (new providers
go in `src/api/providers/`, not inline in handlers). Provider failures are normalized to
`ErrInvalidToken`/`ErrRateLimited`/`ErrNotFound`/`ErrAppNotInstalled` and mapped by callers to
`403`/`429`/`404`/`403 app_not_installed`. When adding Bitbucket, build a `Refresher`
implementation rather than adding a second inline flow.

Capabilities not every provider has are optional interfaces checked with a type assertion, not
methods on `Provider`: `Refresher` (token refresh), `Installer` (`InstallURL()`, for providers
whose access depends on an app installation), and `Revoker` (token revocation).
`routers.installURL` reads `InstallURL()` (empty when the provider is not an `Installer` or there is
no `GITHUB_APP_SLUG`); `installDetails` turns it into the `details.install_url` of an error, omitting
the key rather than sending it empty, and `GET /providers` sends it as `install_url` or `null`.

Every provider has a `DisplayName()` for the UI. `Registry.List()` returns the providers sorted by
name (it is what `GET /providers` lists), and `NewRegistry` panics on a duplicate name: it runs
once at startup. `AuthCodeURL(state, AuthOptions)` takes `SelectAccount` (GitHub:
`prompt=select_account`) and `LoginHint` (GitHub: `login=`).

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
- A token issued during a linking flow that then stores nothing is revoked with
  `Service.RevokeAccessToken(ctx, provider, token)`: plaintext, never stored, best-effort like
  `Revoke`. It is only for a freshly issued (live) token, so no refresh-then-revoke is needed.
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

The linking flow (`providerLogin` / `providerCallback`) is a full-page navigation, so it never
answers with an error envelope, except `501` for an unregistered provider and `401` from
`RequireAuth` (#133). Rules worth preserving:

- Every callback outcome, and every login failure, is a `307` to `FRONTEND_URL/settings/accounts`
  with `result=` or `error=` (and `account_id`). The codes are constants in
  `routers/account_link.go` and listed in `docs/api.md` → Linking and re-linking; the UI mirrors
  them in `LinkResult` / `LinkErrorCode` (`src/ui/src/api/accounts.ts`), so add a code to both in
  one change. The UI shows an unknown error code as `server_error`. Build the URL with `linkRedirectURL`, and never put
  provider-supplied text in it.
- A re-link (`?account_id=`) stores its target in the session with `SetRelinkAccountID`, as a
  string (the session round-trips through JSON, which turns numbers into `float64`). A plain link
  sets it to `0`, clearing a target left by an abandoned re-link. The callback reads the state and
  the target (both single-use) before any early return, and never takes the target from its URL.
- A re-link stores only the target's identity: any other is `identity_mismatch` and changes nothing.
- Once the code is exchanged, every failure that stores nothing revokes the new token (`discard`
  in `linkCallback`), so no live token is left behind.
- The provider's `error` parameter is read before `code`.

GitHub specifics worth preserving: the shared `httpClient` from `routers/http.go` (10s timeout),
`newGitHubGetRequest` / `newGitHubDeleteRequest` for auth, accept, and content-type headers,
`io.LimitReader` bounding every decode, `Link`-header pagination with a page cap, and returning the
upstream HTTP status so callers can distinguish a revoked token (401/403 → "re-link your account")
from a real failure. With a GitHub App token, `/user/repos` lists only repositories the app is
installed on, so `ListRepositories` checks `/user/installations` when the list is empty and returns
`ErrAppNotInstalled` when there are none (`total_count` is the total, not the page size). The token
refresh and revocation flows are described above, under `credentials`.

