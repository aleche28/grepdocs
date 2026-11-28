# AGENTS.md

Guidance for AI coding agents working in this repository. Written to be tool-agnostic — any agent
that picks up an `AGENTS.md` (or is pointed at one) should be able to work from this file and the
files it points to. This file holds the rules most tasks need; the detail behind them, and the rules
for specific areas, live in `docs/agents/`. Read the matching file before changing that area.

| Before you change…                                                      | Read                             |
| ----------------------------------------------------------------------- | -------------------------------- |
| Request pipeline, sessions, DAL, token encryption, `httpx`, Go tests    | `docs/agents/backend.md`         |
| Providers, `credentials`, token refresh/revocation, account linking     | `docs/agents/git-providers.md`   |
| Anything in `src/ui`, UI tests                                          | `docs/agents/web-ui.md`          |
| Workflows, lint config, pinned tool versions, Go/Node versions          | `docs/agents/ci.md`              |
| Dev container, Makefile, local infra, Swagger UI                        | `docs/agents/dev-environment.md` |

## Project

GrepDocs: a centralized tool to browse, search, and edit Markdown documentation living across
multiple git repositories, committing edits back to source control. The backend is `src/api` (Go
module `grepdocs/api`); the web UI is `src/ui` (React + TypeScript, built with Vite), being built in
Phase 4 of `docs/roadmap.md`.

GitHub Actions runs the quality gates on every PR and push to `main`; `make ci` runs the same checks
locally — run it before pushing.

## Commands

All Go commands run from `src/api` (godotenv loads `.env` from the working directory), and npm
commands from `src/ui`. The Makefile at the repo root wraps them and handles the `cd` for you:

| Task                   | Command                              |
| ---------------------- | ------------------------------------ |
| Start infra            | `make infra-up`                      |
| Stop infra             | `make infra-down`                    |
| Create `.env`          | `make env`                           |
| Run the API (`:3000`)  | `make run`                           |
| Build                  | `make build`                         |
| Run tests              | `make test`                          |
| Tests + race detector  | `make test-race`                     |
| Format / vet           | `make fmt` / `make vet`              |
| Lint / vuln scan       | `make lint` / `make vuln`            |
| Lint the OpenAPI spec  | `make openapi-lint`                  |
| Tidy `go.mod`          | `make tidy`                          |
| Every check CI runs    | `make ci`                            |
| Apply migrations       | `make migrate-up`                    |
| Roll back              | `make migrate-down [COUNT=n]`        |
| Scaffold a migration   | `make migrate-new NAME=create_foo`   |
| Regenerate the DAL     | `make sqlc-generate`                 |
| Install UI deps        | `make ui-install` (`npm ci`)         |
| Run the UI (`:5173`)   | `make ui-dev`                        |
| Build the UI           | `make ui-build`                      |
| Run the UI tests       | `make ui-test`                       |
| UI typecheck / lint    | `make ui-typecheck` / `make ui-lint` |
| UI format / check      | `make ui-fmt` / `make ui-fmt-check`  |
| UI dependency audit    | `make ui-audit`                      |
| Every UI check CI runs | `make ui-ci`                         |

- The `ui-*` targets, and `make ci` (it runs `ui-ci`), need `node_modules`: run `make ui-install`
  once, and again after `package-lock.json` changes.
- The dev container runs its own Docker daemon (Docker-in-Docker), not the host's: `make infra-*`
  inside it starts a separate copy of the infra. Run `make infra-*` on the host.
- Health check: <http://localhost:3000/api/ping> returns `pong`.

## Rules most tasks need

### Backend (`src/api`)

- `main.go` wires everything; there is no DI container. Handlers are receiver methods on a struct
  holding `*pgxpool.Pool` and `*session.SessionManager`; they open a `dal.New(h.dbPool)` query set
  per request and always pass `r.Context()` to DB and outbound calls.
- Sessions are hand-rolled on purpose: do not swap in `scs` or another library unilaterally.
  Handlers read the user ID with `middleware.CurrentUserID(r)`, never from the session.
- `src/api/dal` is generated, never hand-edited. Schema change: a new migration in
  `src/api/database/migrations/` (never edit an existing one), then the query in
  `src/api/database/queries.sql`, then `make sqlc-generate`. Follow
  `.agents/skills/migration-generator/SKILL.md`, and never run migrations or `sqlc generate` on the
  user's behalf: write the files and tell them the commands.
- Every response goes through `httpx` (`WriteJSON`, `WriteError`, `WriteErrorWithDetails`,
  `WriteInternalError`); never `http.Error` or hand-rolled JSON. Internal error strings never reach
  the client. A new `httpx.Code*` constant is added to `ApiErrorCode` (`src/ui/src/api/client.ts`)
  in the same change.
- Token fields from `external_git_accounts` are stripped at the DTO layer, encrypted before every
  write, and read only through `credentials.Service` — never decrypt them yourself.
- New providers go in `src/api/providers/` behind `providers.Provider`; capabilities not every
  provider has are optional interfaces checked with a type assertion.

### Web UI (`src/ui`)

- Every API call goes through `apiFetch` / `apiFetchText` (`src/api/client.ts`), never `fetch`.
  Data from the API lives in TanStack Query through the shared `queryClient`, not component state.
- Routes are in `src/router.tsx`, one component per route in `src/pages/`. Show a failed API call
  with `ApiErrorMessage`, a just-happened message with `Banner`, a confirmation or small form with
  `Dialog` (all in `src/components/`).
- Colours come only from `src/styles/tokens.css` (light and dark); icons from `lucide-react`.
- Tests are Vitest + Testing Library next to the code, with the API mocked by MSW and pages rendered
  with `renderRoute`. Vitest does not type-check: run `make ui-typecheck` too.

### Code quality

- Fix lint findings rather than suppress them; for a false positive use
  `//nolint:<linter> // <reason>` on the line. Run `make fmt` / `make ui-fmt`.
- After any `go get`, check the `go` line in the diff: a dependency can raise it silently.
- Tool versions are pinned in `.devcontainer/Dockerfile` with checksums: read
  `docs/agents/ci.md` before bumping one.

## Conventions

- Conventional commit messages (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `feat!:`).
- API paths kebab-case, JSON fields `snake_case`.
- `last_refreshed_at` is spelled that way everywhere (migration + queries) — not a typo to "fix".
- `.env` is gitignored and holds real OAuth secrets — never commit, print, or echo it. Never commit
  a `TOKEN_ENCRYPTION_KEY`.

## Skills

Reusable workflows live in `.agents/skills/<name>/SKILL.md`. Agents that understand skills load
them on matching requests; if yours doesn't, read the relevant file directly before acting.
`.claude/skills` is a symlink to `../.agents/skills` so Claude Code discovers them — add new skills
under `.agents/skills`, never inside `.claude/skills`.

- `migration-generator` — scaffold new golang-migrate up/down files from a table/column description.
- `roadmap-next` — determine the next task in the current roadmap phase (reads `docs/roadmap.md`,
  open `tech-debt` issues, and `docs/api.md`; read-only, evidence-based).
- `implementation-review` — teaching-first review of hand-written code (rubric in
  `REVIEW-RUBRIC.md`). Advisory by default; only applies fixes on explicit opt-in.
- `phase-status-sync` — close out finished work across `docs/roadmap.md` and
  `docs/roadmap-stakeholders.md`, and name the GitHub issues it closes. Docs only.
- `deep-dive` — Socratic, read-only mentor for understanding how a part of the code works, down to
  dependency/stdlib source, with history, trade-offs, and related patterns. Never edits code.

## Documentation map

- `docs/agents/` — the detailed agent guidance this file points to (see the table at the top).
- `src/api/openapi/openapi.yaml` — OpenAPI 3.1 spec of the **implemented** endpoints, hand-written
  (spec-first), embedded with `go:embed` and served with Swagger UI at `/api/docs`. Nothing checks
  it against the handlers yet (#107 will generate the server from it with oapi-codegen), so update
  it in the same change as any route, status code, or request/response field. Keep every
  `operationId` equal to its handler's name.
- `docs/api.md` — the API contract. It is a **design proposal**: much of it (repositories,
  documents, search, groups, pagination) is not implemented. Treat it as the target shape for new
  endpoints, and check it before inventing a route or response body.
- `docs/sync-engine.md` — `sync_status` state machine: state diagrams, every transition with its
  query and guard, the invariants that keep concurrent syncs safe, and when a repository stays busy.
  Update it whenever a sync query or its caller changes.
- `docs/requirements.md`, `docs/user-stories.md` — product spec.
- `docs/prd/` — one PRD per feature issue (`NNN-name.md`, by issue number): problem, decisions,
  API and UI changes, acceptance criteria, follow-up issues. Agreed before implementation; check it
  before building the issue it names.
- `docs/howto/` — Google OAuth setup, GitHub App setup, golang-migrate workflow, sqlc usage,
  running the dev container on a remote machine over SSH.
- `docs/roadmap.md` — phased build-out plan (not dated), interleaving new features with the open
  `tech-debt` issues each phase depends on or exposes. Update it as phases complete or scope shifts.
  Each phase is a GitHub milestone of the same name whose issues are its tasks; user stories are
  not tracked as issues.
- `docs/roadmap-stakeholders.md` — non-technical companion to `docs/roadmap.md`: same plan grouped
  into Now/Next/Later, feature language only. Keep the two in sync when phases change.

## Tracking work

Open work lives in GitHub issues, not in docs. Review findings and known problems carry the
`tech-debt` label (`gh issue list --label tech-debt --state open`). When you find a new problem
you are not fixing, propose an issue (title in the `type(scope): …` style, and body) to the user
rather than adding a TODO list to a doc. Reference issues as `#NN` from docs and commits.

## Known inconsistencies

- `CLAUDE.md` is only a pointer to this file (Claude Code reads it via an `@AGENTS.md` import).
  This file is the single source of truth for agent guidance — put new guidance here, or in the
  `docs/agents/` file for its area.
