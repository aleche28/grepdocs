DROP TABLE IF EXISTS documents;

ALTER TABLE repositories
	DROP COLUMN IF EXISTS sync_error,
	DROP COLUMN IF EXISTS sync_started_at;
