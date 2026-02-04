-- name: GetUserByGoogleId :one
SELECT * FROM users
WHERE google_id = $1 LIMIT 1;

-- name: GetUserById :one
SELECT * FROM users
WHERE id = $1 LIMIT 1;

-- name: GetUserByEmail :one
SELECT * FROM users
WHERE email = $1 LIMIT 1;

-- name: CreateUser :one
INSERT INTO users (
	fullname,
	email,
	google_id
) VALUES (
	$1, $2, $3
)
RETURNING *;

-- name: UpdateUserLastLogin :exec
UPDATE users
SET last_login_at = NOW()
WHERE id = $1;

-- name: DeleteUser :exec
DELETE FROM users
WHERE id = $1;

-- name: GetExternalGitAccountsByUserId :many
SELECT * FROM external_git_accounts
WHERE user_id = $1;

-- name: GetExternalGitAccountById :one
SELECT * FROM external_git_accounts
WHERE id = $1 LIMIT 1;

-- name: CreateExternalGitAccount :one
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
