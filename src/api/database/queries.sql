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
	sync_error = CASE WHEN sqlc.arg(reset_sync)::boolean THEN NULL ELSE sync_error END,
	sync_started_at = CASE WHEN sqlc.arg(reset_sync)::boolean THEN NULL ELSE sync_started_at END,
	updated_at = NOW()
WHERE id = $1 AND user_id = $2
RETURNING *;

-- name: DeleteRepository :exec
DELETE FROM repositories
WHERE id = $1 AND user_id = $2;

-- name: ClaimRepositorySync :one
-- basically, the caller locks the repo for syncing
-- if it's already running, this does not return anything, so the caller
-- is not locking it, because someone else is already syncing it (either queued or running)
-- otherwise, this returns the locked row and the caller can perform the syncing.
-- the row is considered lock until the caller (or a recovery mechanism is case it gets stuck)
-- will update the row with sync status 'ok' or 'failed'
-- NOTE: there is no 'queued_at' timestamp, cause the sync shouldn't get queued element stuck:
-- if the program crashes, it should retrieve all the queued rows and start processing them
UPDATE repositories
SET sync_status = 'queued', updated_at = NOW()
WHERE id = $1 AND user_id = $2 AND sync_status NOT IN ('queued', 'running')
RETURNING *;

-- name: MarkRepositorySyncAsRunning :execrows
UPDATE repositories
SET
	sync_status = 'running',
	sync_error = NULL,
	sync_started_at = NOW(),
	updated_at = NOW()
WHERE id = $1 AND user_id = $2 AND sync_status = 'queued';

-- name: MarkRepositorySyncAsFailed :exec
UPDATE repositories
SET
	sync_status = 'failed',
	sync_error = $1,
	sync_started_at = NULL,
	updated_at = NOW()
WHERE id = $2 AND user_id = $3 AND sync_status IN ('queued', 'running');

-- name: FinalizeRepositorySync :execrows
UPDATE repositories
SET
	synced_commit = $1,
	sync_status = 'ok',
	sync_error = NULL,
	sync_started_at = NULL,
	last_sync_at = NOW(),
	updated_at = NOW()
WHERE id = $2 AND user_id = $3
AND tracked_branch = $4 AND sync_status = 'running';

-- name: ResetStuckRepositorySyncs :many
-- NOTE: this only works fine is only one server handles the queue, otherwise
-- a server could reset a running job of another instance
UPDATE repositories
SET
	sync_status = 'queued',
	sync_started_at = NULL,
	updated_at = NOW()
WHERE sync_status IN ('queued', 'running')
RETURNING id; -- return id so they can be enqueued again
