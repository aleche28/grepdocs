CREATE TABLE IF NOT EXISTS documents (
	repository_id BIGINT NULL REFERENCES repositories(id) ON DELETE CASCADE,
	path TEXT NOT NULL,
	blob_sha TEXT NOT NULL,
	content TEXT NOT NULL,
	synced_at TIMESTAMPTZ DEFAULT NOW(),
	UNIQUE(repository_id, path)
);

CREATE INDEX IF NOT EXISTS idx_documents_repository ON documents(repository_id);

ALTER TABLE repositories
	ADD COLUMN sync_error TEXT NULL,
	ADD COLUMN sync_started_at TIMESTAMPTZ NULL;
