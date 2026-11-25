# Dev environment

Moved from `AGENTS.md`. Read it when touching the dev container, the Makefile, or local infra.

Makefile caveats:

- `make fmt` rewrites files; `make fmt-check` and `make tidy-check` only print a diff and fail.
- The `ui-*` targets need `node_modules`, and so does `make ci` (it runs `ui-ci`): run
  `make ui-install` once, and again after `package-lock.json` changes. Only CI installs on its own.
- `make migrate-*` parses `DATABASE_URL` out of `src/api/.env` with `sed` and requires the
  `postgres://` URL form (golang-migrate cannot read pgx keyword/value strings). Override on the
  command line with `make migrate-up DATABASE_URL=...`.

Prerequisites beyond Go and Docker: `golang-migrate`, `sqlc`, and `golangci-lint` on `PATH` (see
README), and Node.js at the version in `src/ui/.nvmrc` for the UI. govulncheck needs no install: it is a `tool` directive in `go.mod`, run with `go tool`.
The dev container (`.devcontainer/`) has all of them, at the versions pinned in its `Dockerfile`.

Dev container rules worth preserving:

- It layers `.devcontainer/docker-compose.yml` on the root `docker-compose.yml`, whose fixed
  `name: grepdocs` makes the container and `make infra-up` share containers and volumes. Do not add
  `container_name` back: fixed names break that sharing.
- Inside it, `DATABASE_URL` and `REDIS_ADDR` are set by compose to the service names (`postgres`,
  `redis`). This relies on `godotenv.Load` not overriding set variables and on the Makefile's
  `DATABASE_URL ?=`; switching to `godotenv.Overload` would break it.
- Ports 3000 and 5173 use `requireLocalPort`: the OAuth redirect URLs and `FRONTEND_URL` name them.
- Vite binds `127.0.0.1` (`vite.config.ts`), not the default `localhost`: Node resolves that to
  `::1`, and the forwarded port connects over IPv4, so the UI hangs. Servers in the container must
  listen on IPv4 loopback or on all addresses (the API listens on `:3000`).
- `devcontainer-lock.json` pins the features by digest; Dependabot updates it with the features.
- Claude Code is installed by `post-create.sh` and keeps its state in the `claude-config` volume
  through `CLAUDE_CONFIG_DIR`; the Dockerfile creates `/home/vscode/.claude` so the volume starts
  owned by `vscode`, like the Go cache volumes. The `anthropic.claude-code` extension shares that
  directory, so its login survives a rebuild too. Keep the native installer rather than the
  `claude-code` dev container feature: the feature needs npm at build time, when the image has
  only nvm, and would install a second, outdated Node (details in `post-create.sh`).
- The image has no Docker CLI or socket on purpose: it keeps agents running inside the container away
  from the host's Docker daemon. Run `make infra-*` on the host.
Health check: <http://localhost:3000/api/ping> returns `pong`.

Interactive API docs (Swagger UI) are at <http://localhost:3000/api/docs>, mounted only when `ENV`
is not `production`. Sign in first at <http://localhost:3000/api/auth/google/login>: requests from
the page carry the browser's session cookie, so no cookie copying is needed.

Infra (`make infra-up`) starts Postgres on `5432`, Redis on `6379`, pgAdmin on `8080`. The server
needs both Postgres and Redis, and exits at startup if `DATABASE_URL` is unset. Their data lives in
named volumes (`grepdocs_pgdata`, `grepdocs_cache`): `make infra-down` keeps it, `docker compose
down -v` deletes it. Postgres 18+ images mount the volume at `/var/lib/postgresql`, not `.../data`.
