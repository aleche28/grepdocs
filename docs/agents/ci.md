# CI and code quality

Moved from `AGENTS.md`. Read it before changing workflows, lint config, or pinned tool versions.

Two workflows in `.github/workflows/`, both calling `make` from the repo root (the Makefile does the
`cd src/api`, so do not set a default `working-directory`):

- `ci.yml` — job `check` (`tidy-check`, `vet`, `build`, `test-race`), job `lint`
  (`golangci-lint-action`, which also reports formatting, so `fmt-check` is not run separately,
  then `make openapi-lint`), and job `ui` (`ui-install`, `ui-fmt-check`, `ui-lint`, `ui-test`,
  `ui-build`, which also type-checks).
- `security.yml` — `make vuln` (govulncheck) and `make ui-audit` (`npm audit`) on PRs, pushes to
  `main`, a weekly cron, and manually.

Rules worth preserving:

- Linting is configured in `src/api/.golangci.yml`. Fix findings rather than suppress them; when a
  finding is a false positive, use `//nolint:<linter> // <reason>` on the line (or the line above).
  `nolintlint` rejects directives without a linter or reason, and flags unused ones. Prefer a
  per-line directive over a global exclusion, so new occurrences are still caught.
- Formatting is gofumpt + gci (imports: standard, third-party, then `grepdocs/api`). Run `make fmt`.
  `gofumpt.module-path` must stay set: without a dot in its first element, `grepdocs/api` looks
  like a standard-library path to gofumpt, and it then fights gci over import groups. Editors hit
  the same trap (gofumpt on stdin cannot see `go.mod`), so `.vscode/settings.json` and `.nvim.lua`
  format Go with `golangci-lint fmt` and this config instead; `.nvim.lua` needs `'exrc'` and `:trust`.
- The Go version is the `toolchain` line in `src/api/go.mod`. CI reads it via `go-version-file`
  (setup-go sets `GOTOOLCHAIN=local`), so bumping that line is how CI's Go changes.
- The UI's Node version is `src/ui/.nvmrc`, which CI reads via `node-version-file`, so bumping it
  is how CI's Node changes. `engines` in `package.json` is the minimum the dependencies need, not
  the version to use.
- `make ui-audit` is `npm audit --omit=dev`: runtime dependencies only, like govulncheck's
  reachable-only report. Dev tooling (ESLint, Vite) never ships to the browser, and a finding there
  would fail the build with no runtime impact.
- After any `go get`, check the `go` line in the diff: a dependency (or a `go tool` dependency,
  which shares the module graph) requiring a newer Go raises it silently.
- Versions: govulncheck is pinned by the `tool` directive in `go.mod`, UI packages by
  `package-lock.json`, actions by commit SHA with a `# vX.Y.Z` comment, and images by tag in
  `docker-compose.yml` and the `FROM` lines of `.devcontainer/Dockerfile`; Dependabot
  (`.github/dependabot.yml`) bumps all of them, and the dev container features, weekly.
- golangci-lint, sqlc, golang-migrate and vacuum are pinned by the `ARG`s in
  `.devcontainer/Dockerfile`, each with the sha256 of its linux amd64 and arm64 release archive. It
  is the single place for these versions: CI reads `GOLANGCI_LINT_VERSION`, `VACUUM_VERSION` and
  `VACUUM_SHA256_AMD64` from it, and the Makefile reads `VACUUM_VERSION`. Dependabot does not touch
  them: bump a version together with both checksums (take them from the release's checksum file, or
  `shasum -a 256` the archives; sqlc publishes none), and update your local golangci-lint too. Keep
  `SQLC_VERSION` equal to the version in the header of the generated `src/api/dal` files.
- The Dockerfile's `golang` tag should follow the `toolchain` line in `go.mod`. A mismatch is not an
  error (`GOTOOLCHAIN` stays `auto`, so the newer one is downloaded), only slower.
- The OpenAPI linter is vacuum, run with `go run …@$(VACUUM_VERSION)` from the Makefile (no install
  needed). It is not a `tool` directive on purpose: it requires a newer `go` line than the API's
  and would add its dependencies to the API's module graph. CI downloads the release binary
  instead (compiling it took ~5 min per run), checks it against `VACUUM_SHA256_AMD64` from
  `.devcontainer/Dockerfile`, and calls `make openapi-lint VACUUM=vacuum`; the dev container image
  has the same binary and sets `VACUUM=vacuum`. Bump it in the Dockerfile (see the rule above); a
  checksum mismatch fails the install step. Warnings fail the build (`--fail-severity warn`): fix the spec rather
  than disabling a rule. The ruleset is `src/api/openapi/vacuum.yaml` (recommended rules); it turns
  off only rules that conflict with a project convention, each with its reason. Locally, the first
  run downloads and compiles vacuum (slow); Go caches the binary, so later runs are fast.
- Workflows get `permissions: contents: read` and `persist-credentials: false`; widen per job only
  when a step needs it.

