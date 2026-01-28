-- name: GetUserByGoogleId :one
SELECT * FROM users
WHERE google_id = $1 LIMIT 1;

-- name: CreateUser :one
INSERT INTO users (
	fullname,
	email,
	google_id
) VALUES (
	$1, $2, $3
)
RETURNING *;

-- name: GetExternalGitAccountsByUserId :many
SELECT * FROM external_git_accounts
WHERE user_id = $1;
