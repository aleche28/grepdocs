CREATE TABLE IF NOT EXISTS documents (
	id BIGSERIAL PRIMARY KEY,
	repository_id BIGINT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
	path TEXT NOT NULL,
	blob_sha TEXT NOT NULL,
	content TEXT NOT NULL,
	synced_at TIMESTAMPTZ NOT NULL,
	UNIQUE(repository_id, path)
);

ALTER TABLE repositories
	ADD COLUMN sync_error TEXT NULL,
	ADD COLUMN sync_started_at TIMESTAMPTZ NULL;
