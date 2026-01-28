CREATE TABLE IF NOT EXISTS external_git_accounts (
	id BIGSERIAL PRIMARY KEY,
	user_id BIGSERIAL NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	provider VARCHAR(50) NOT NULL,
	provider_user_id VARCHAR(255) NOT NULL,
	access_token TEXT NOT NULL,
	refresh_token TEXT,
	token_expires_at TIMESTAMPTZ,
	linked_at TIMESTAMPTZ DEFAULT NOW(),
	last_refreshed_at TIMESTAMPTZ,

	UNIQUE(user_id, provider)
);

CREATE INDEX idx_external_git_accounts_user ON external_git_accounts(user_id);

-- CREATE TABLE IF NOT EXISTS repositories (
-- 	id bigserial PRIMARY KEY,
-- 	provider text NOT NULL,
-- 	repo_id bigserial NOT NULL,
-- 	web_url text NULL,
-- 	api_url text NULL,
-- 	is_private boolean NULL,
-- 	tracked_branch text NOT NULL,
-- 	tracked_commit text NOT NULL,
-- 	tracked_at timestamptz NOT NULL,
-- 	updated_at timestamptz NOT NULL,
-- 	last_sync_at timestamptz NOT NULL
-- )
--
-- CREATE TABLE IF NOT EXISTS tracked_files (
-- 	repository_id BIGSERIAL NOT NULL,
-- 	file_path text NOT NULL,
-- 	file_content BLOB NOT NULL,
-- 	tracked_at timestamptz NOT NULL
-- )
