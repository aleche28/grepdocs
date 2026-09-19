-- WARNING: this rollback cannot restore the old (user_id, provider) uniqueness if
-- any user now has more than one account for the same provider. Deduplicate those
-- rows before rolling back, or the ADD UNIQUE below will fail.
--
-- The constraint name in the DROP below is the name Postgres auto-generated for
-- the UNIQUE added in the up migration (external_git_accounts_<cols>_key).
ALTER TABLE IF EXISTS public.external_git_accounts
	DROP CONSTRAINT IF EXISTS external_git_accounts_user_id_provider_provider_user_id_key,
	DROP COLUMN label,
	ADD UNIQUE (user_id, provider);