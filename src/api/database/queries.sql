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

-- name: GetExternalGitAccountsByUserIDAndProvider :many
SELECT * FROM external_git_accounts
WHERE user_id = $1 AND provider = $2;

-- name: UpsertExternalGitAccount :one
INSERT INTO external_git_accounts (
	user_id,
	provider,
	provider_user_id,
	access_token,
	refresh_token,
	token_expires_at
) VALUES (
	$1, $2, $3, $4, $5, $6
)
ON CONFLICT (user_id, provider, provider_user_id)
	DO UPDATE SET
		access_token = EXCLUDED.access_token,
		refresh_token = COALESCE(NULLIF(EXCLUDED.refresh_token, ''), external_git_accounts.refresh_token),
		token_expires_at = EXCLUDED.token_expires_at,
		last_refreshed_at = NOW()
RETURNING *;

-- name: UpdateExternalGitAccountTokens :exec
UPDATE external_git_accounts
SET 
	access_token = $2,
	refresh_token = COALESCE($3, refresh_token),
	token_expires_at = $4,
	last_refreshed_at = NOW()
WHERE id = $1;

-- name: DeleteExternalGitAccount :exec
DELETE FROM external_git_accounts
WHERE id = $1;

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
UPDATE repositories
SET
	tracked_branch = $2,
	synced_commit = $3,
	sync_status = $4,
	auto_sync = $5,
	last_sync_at = $6,
	updated_at = NOW()
WHERE id = $1
RETURNING *;
