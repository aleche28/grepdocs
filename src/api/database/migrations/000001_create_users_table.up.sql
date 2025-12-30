CREATE TABLE IF NOT EXISTS users (
	id BIGSERIAL PRIMARY KEY,
	fullname text NOT NULL,
	username text NULL,
	email text NOT NULL,
	google_id text NOT NULL,
	created_at timestamptz NOT NULL
)

