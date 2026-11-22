-- The provider's login (e.g. the GitHub username), so users can tell their
-- accounts apart. Written on every link and re-link, since logins can be
-- renamed. NULL for accounts linked before this migration, until their next
-- re-link: there is no backfill.
ALTER TABLE external_git_accounts
	ADD COLUMN provider_login VARCHAR(255) NULL;
