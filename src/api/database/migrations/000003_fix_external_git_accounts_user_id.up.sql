-- user_id was created as BIGSERIAL, which implies auto-generation of the id
-- for an FK column. It should be a plain BIGINT reference, not an identity.
ALTER TABLE external_git_accounts
    ALTER COLUMN user_id DROP DEFAULT;

DROP SEQUENCE IF EXISTS external_git_accounts_user_id_seq;