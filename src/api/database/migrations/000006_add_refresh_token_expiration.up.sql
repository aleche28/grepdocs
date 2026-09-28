ALTER TABLE external_git_accounts
	ADD COLUMN refresh_token_expires_at TIMESTAMPTZ NULL;
