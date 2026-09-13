# AGENTS.md

GrepDocs is a backend-only Go service (`src/api`) for searching/browsing/editing docs across git repos. `src/ui` is empty (no frontend yet). There are no tests and no CI — `go vet` / `go fmt` are the only quality gates.

## Toolchain: modular Go, not classic Go

This uses the new modular Go toolchain (gomod.sh), not the classic toolchain:
- `src/api/go.mod` declares `module grepdocs/api`; deps are module paths like `github.com/go-chi/chi/v5`.
- Add a dependency: `go get github.com/<owner>/<repo>/<path>` (updates the `go.sum` lockfile).
- Build: `go build`. Run server: `go run main.go`.

## Local development

- All commands run from `src/api` — godotenv loads `.env` from the working directory.
- Start infra first: `docker compose up -d` (postgres:5432, redis:6379, pgadmin:8080). `main.go` needs BOTH postgres (pgx pool) and redis (session store) and fatals without `DATABASE_URL`.
- `.env` is gitignored and holds real OAuth secrets — never commit or expose it.
- Server listens on `:3000`; routes are mounted in `src/api/main.go` under `/api`.

## Database changes: two steps, order matters

1. Write a migration by hand in `src/api/database/migrations/` as `NNNNNN_name.up.sql` + `.down.sql` — never edit existing migration files, and use the `migration-generator` skill to scaffold new ones. golang-migrate applies them, and `sqlc.yaml` also uses the migrations folder as schema source.
2. Regenerate the DAL: `sqlc generate` rewrites `src/api/dal/` (generated, do not edit by hand). New query functions come from `-- name:` comments in `src/api/database/queries.sql`.

Apply pending migrations:
`migrate -path ./database/migrations -database "postgresql://alessio:password@localhost:5432/grepdocs?sslmode=disable" up`

Gotchas:
- Schema/query changes won't be visible in code until `sqlc generate` is run.
- `last_refreshed_at` is spelled that way everywhere (migration + queries) — not a typo to "fix".

## Conventions

- Commit messages use conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `feat!:`).
- Sessions are custom-built (Redis store + cookie wrapper in `src/api/session`); `main.go` has a TODO about possibly migrating to `scs` — don't swap implementations unilaterally.