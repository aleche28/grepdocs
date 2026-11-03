-- name: GetUserById :one
SELECT * FROM users
WHERE id = $1 LIMIT 1;

-- name: GetUserByEmail :one
SELECT * FROM users
WHERE email = $1 LIMIT 1;

-- name: UpsertUserByGoogleId :one
INSERT INTO users (
	fullname,
	email,
	google_id
) VALUES (
	$1, $2, $3
)
ON CONFLICT (google_id) DO UPDATE SET last_login_at = NOW()
RETURNING *;

-- name: UpdateUserLastLogin :exec
UPDATE users
SET last_login_at = NOW()
WHERE id = $1;

-- name: DeleteUser :exec
DELETE FROM users
WHERE id = $1;

-- name: GetExternalGitAccountsByUserID :many
SELECT * FROM external_git_accounts
WHERE user_id = $1;

-- name: GetExternalGitAccountById :one
SELECT * FROM external_git_accounts
WHERE id = $1 LIMIT 1;

-- name: GetExternalGitAccountByIdForUpdate :one
SELECT * FROM external_git_accounts
WHERE id = $1
FOR UPDATE;

-- name: GetExternalGitAccountsByUserIDAndProvider :many
SELECT * FROM external_git_accounts
WHERE user_id = $1 AND provider = $2;

-- name: GetExternalGitAccountByIdentity :one
SELECT * FROM external_git_accounts
WHERE user_id = $1 AND provider = $2 AND provider_user_id = $3;

-- name: UpsertExternalGitAccount :one
INSERT INTO external_git_accounts (
	user_id,
	provider,
	provider_user_id,
	access_token,
	refresh_token,
	token_expires_at,
	refresh_token_expires_at
) VALUES (
	$1, $2, $3, $4, $5, $6, $7
)
ON CONFLICT (user_id, provider, provider_user_id)
	DO UPDATE SET
		access_token = EXCLUDED.access_token,
		refresh_token = COALESCE(NULLIF(EXCLUDED.refresh_token, ''), external_git_accounts.refresh_token),
		token_expires_at = EXCLUDED.token_expires_at,
		refresh_token_expires_at = CASE
			WHEN EXCLUDED.refresh_token <> '' THEN EXCLUDED.refresh_token_expires_at
			ELSE external_git_accounts.refresh_token_expires_at END,
		last_refreshed_at = NOW()
RETURNING *;

-- name: UpdateExternalGitAccountTokens :one
UPDATE external_git_accounts
SET 
	access_token = $2,
	refresh_token = COALESCE(NULLIF(sqlc.arg(refresh_token)::text, ''), refresh_token),
	token_expires_at = $3,
	refresh_token_expires_at = CASE
		WHEN sqlc.arg(refresh_token)::text <> '' THEN sqlc.narg(refresh_token_expires_at)::timestamptz
		ELSE refresh_token_expires_at END,
	last_refreshed_at = NOW()
WHERE id = $1
RETURNING id;

-- name: ClearExternalGitAccountTokens :one
-- Called when the provider rejects the refresh token: the account can only be
-- re-linked, so later lookups fail fast without contacting the provider.
-- Expiries are kept: they still describe the last tokens issued.
UPDATE external_git_accounts
SET
	access_token = '',
	refresh_token = ''
WHERE id = $1
RETURNING id;

-- name: DeleteExternalGitAccountByIdAndUserId :one
DELETE FROM external_git_accounts
WHERE id = $1
AND user_id = $2
RETURNING *;

-- name: GetRepositoriesByUserID :many
SELECT * FROM repositories
WHERE user_id = $1
ORDER BY owner, name;

-- name: GetRepositoryByIDAndUserID :one
SELECT * FROM repositories
WHERE id = $1 AND user_id = $2
LIMIT 1;

-- name: CreateRepository :one
INSERT INTO repositories (
	user_id,
	account_id,
	provider,
	provider_repo_id,
	owner,
	name,
	full_name,
	html_url,
	is_private,
	default_branch,
	tracked_branch
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;

-- name: UpdateRepository :one
-- Only PATCH-owned fields (tracked_branch, auto_sync) are written. The sync
-- fields are reset only when reset_sync is true (branch change), otherwise they
-- keep their current values so a concurrent sync is not clobbered by stale data.
UPDATE repositories
SET
	tracked_branch = $3,
	auto_sync = $4,
	synced_commit = CASE WHEN sqlc.arg(reset_sync)::boolean THEN NULL ELSE synced_commit END,
	sync_status = CASE WHEN sqlc.arg(reset_sync)::boolean THEN 'pending' ELSE sync_status END,
	last_sync_at = CASE WHEN sqlc.arg(reset_sync)::boolean THEN NULL ELSE last_sync_at END,
	updated_at = NOW()
WHERE id = $1 AND user_id = $2
RETURNING *;

-- name: DeleteRepository :exec
DELETE FROM repositories
WHERE id = $1 AND user_id = $2;
