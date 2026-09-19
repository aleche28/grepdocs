-- Phase 1: allow more than one account per provider per user.
--
-- The unique key moves from (user_id, provider) to (user_id, provider,
-- provider_user_id): re-linking the same provider identity updates that row in
-- place (see UpsertExternalGitAccount), while a different identity adds a new
-- account.
--
-- `label` lets a user tell accounts apart (e.g. "personal" vs "work"). It is not
-- user-writable yet.
ALTER TABLE IF EXISTS public.external_git_accounts
	DROP CONSTRAINT IF EXISTS external_git_accounts_user_id_provider_key,
	ADD COLUMN label VARCHAR(255) NOT NULL DEFAULT '',
	ADD UNIQUE (user_id, provider, provider_user_id);