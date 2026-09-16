-- Restore the original BIGSERIAL semantics for user_id.
CREATE SEQUENCE IF NOT EXISTS external_git_accounts_user_id_seq
    OWNED BY external_git_accounts.user_id;

ALTER TABLE external_git_accounts
    ALTER COLUMN user_id SET DEFAULT nextval('external_git_accounts_user_id_seq');