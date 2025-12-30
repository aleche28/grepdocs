-- name: GetUserByGoogleId :one
SELECT * FROM users
WHERE google_id = $1 LIMIT 1;

-- name: CreateUser :one
INSERT INTO users (
	fullname,
	email,
	google_id,
	created_at
) VALUES (
	$1, $2, $3, $4
)
RETURNING *;
