GO_DIR      := src/api
ENV_FILE    := $(GO_DIR)/.env
ENV_EXAMPLE := $(GO_DIR)/.env.example
MIGR_PATH   := ./database/migrations
SPEC        := $(GO_DIR)/openapi/openapi.yaml

# OpenAPI linter, run with `go run` rather than a go.mod tool directive: it requires a newer go
# line than the API's and would add its dependencies to the API's module graph. Bump by hand.
VACUUM_VERSION := v0.39.3

# The migration CLI needs a postgres:// URL, so it cannot consume the pgx
# keyword/value format. Extract DATABASE_URL from the env file (overridable on
# the command line, e.g. `make migrate-up DATABASE_URL=...`).
DATABASE_URL ?= $(shell sed -n 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*"\{0,1\}\([^"]*\)"\{0,1\}[[:space:]]*$$/\1/p' $(ENV_FILE))

.PHONY: help infra-up infra-down env run build test test-race fmt fmt-check vet tidy tidy-check lint openapi-lint vuln ci sqlc-generate migrate-up migrate-down migrate-new

help:
	@echo "GrepDocs targets:"
	@echo "  infra-up        Start Postgres, Redis, pgAdmin in Docker"
	@echo "  infra-down      Stop the Docker infra"
	@echo "  env             Create $(ENV_FILE) from $(ENV_EXAMPLE) if missing"
	@echo "  run             Run the API server (go run main.go)"
	@echo "  build           Build the API module"
	@echo "  test            Run the test suite (go test ./...)"
	@echo "  test-race       Run the test suite with the race detector"
	@echo "  fmt             Go format (rewrites files)"
	@echo "  fmt-check       Fail if any file is unformatted (prints the diff)"
	@echo "  vet             Vet Go code"
	@echo "  tidy            Sync go.sum with go.mod"
	@echo "  tidy-check      Fail if go.mod/go.sum are not tidy (prints the diff)"
	@echo "  lint            Run golangci-lint"
	@echo "  openapi-lint    Lint the OpenAPI spec with vacuum"
	@echo "  vuln            Run govulncheck (reachable vulnerabilities only)"
	@echo "  ci              Run every check the CI workflows run"
	@echo "  sqlc-generate   Regenerate src/api/dal from schema + queries.sql"
	@echo "  migrate-up      Apply pending migrations"
	@echo "  migrate-down    Roll back the last migration (COUNT=n for more)"
	@echo "  migrate-new     Scaffold a migration: make migrate-new NAME=create_foo"

infra-up:
	docker compose up -d

infra-down:
	docker compose down

env:
	@test -f $(ENV_FILE) || (cp $(ENV_EXAMPLE) $(ENV_FILE) && echo "Created $(ENV_FILE) — fill in your secrets.")

run:
	cd $(GO_DIR) && go run main.go

build:
	cd $(GO_DIR) && go build

test:
	cd $(GO_DIR) && go test ./...

test-race:
	cd $(GO_DIR) && go test -race ./...

fmt:
	cd $(GO_DIR) && golangci-lint fmt

fmt-check:
	cd $(GO_DIR) && golangci-lint fmt --diff

vet:
	cd $(GO_DIR) && go vet ./...

tidy:
	cd $(GO_DIR) && go mod tidy

tidy-check:
	cd $(GO_DIR) && go mod tidy -diff

lint:
	cd $(GO_DIR) && golangci-lint run ./...

openapi-lint:
	go run github.com/daveshanley/vacuum@$(VACUUM_VERSION) lint --details --fail-severity warn --ruleset $(GO_DIR)/openapi/vacuum.yaml $(SPEC)

vuln:
	cd $(GO_DIR) && go tool govulncheck ./...

ci: tidy-check fmt-check vet lint openapi-lint vuln build test-race

sqlc-generate:
	cd $(GO_DIR) && sqlc generate

migrate-up: migrate-check
	cd $(GO_DIR) && migrate -path $(MIGR_PATH) -database "$(DATABASE_URL)" up

migrate-down: migrate-check
	cd $(GO_DIR) && migrate -path $(MIGR_PATH) -database "$(DATABASE_URL)" down $(COUNT)

migrate-new:
	@test -n "$(NAME)" || (echo "Usage: make migrate-new NAME=create_foo" && exit 1)
	cd $(GO_DIR) && migrate create -ext sql -dir $(MIGR_PATH) -seq $(NAME)

migrate-check:
	@test -n "$(DATABASE_URL)" || (echo "DATABASE_URL not found in $(ENV_FILE). Set it in the env file (postgres:// URL form) or pass DATABASE_URL=... on the command line." && exit 1)
	@case "$(DATABASE_URL)" in postgres*|postgresql*) ;; *) echo "DATABASE_URL must use the postgres:// URL form for golang-migrate (see $(ENV_EXAMPLE))." && exit 1 ;; esac
