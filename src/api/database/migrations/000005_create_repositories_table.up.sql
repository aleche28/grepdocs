CREATE TABLE IF NOT EXISTS repositories (
	id BIGSERIAL PRIMARY KEY,
	user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	account_id BIGINT NULL REFERENCES external_git_accounts(id) ON DELETE SET NULL,
	provider TEXT NOT NULL,
	provider_repo_id TEXT NOT NULL,
	owner TEXT NOT NULL,
	name TEXT NOT NULL,
	full_name TEXT NOT NULL,
	html_url TEXT NOT NULL,
	is_private BOOLEAN NOT NULL DEFAULT false,
	default_branch TEXT NOT NULL,
	tracked_branch TEXT NOT NULL,
	synced_commit TEXT NULL,
	sync_status TEXT NOT NULL DEFAULT 'pending',
	auto_sync BOOLEAN NOT NULL DEFAULT true,
	last_sync_at TIMESTAMPTZ NULL,
	created_at TIMESTAMPTZ DEFAULT NOW(),
	updated_at TIMESTAMPTZ DEFAULT NOW(),
	UNIQUE(user_id, provider, provider_repo_id)
);

CREATE INDEX IF NOT EXISTS idx_repositories_user ON repositories(user_id);
CREATE INDEX IF NOT EXISTS idx_repositories_account ON repositories(account_id);
CREATE INDEX IF NOT EXISTS idx_repositories_provider ON repositories(provider);

