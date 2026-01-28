CREATE TABLE IF NOT EXISTS users (
	id BIGSERIAL PRIMARY KEY,
	fullname VARCHAR(255),
	username VARCHAR(255),
	email VARCHAR(255) UNIQUE NOT NULL,
	google_id VARCHAR(255) UNIQUE NOT NULL,
	created_at timestamptz DEFAULT NOW(),
	updated_at timestamptz DEFAULT NOW(),
	last_login_at timestamptz
)
