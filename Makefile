GO_DIR      := src/api
ENV_FILE    := $(GO_DIR)/.env
ENV_EXAMPLE := $(GO_DIR)/.env.example
MIGR_PATH   := ./database/migrations

# The migration CLI needs a postgres:// URL, so it cannot consume the pgx
# keyword/value format. Extract DATABASE_URL from the env file (overridable on
# the command line, e.g. `make migrate-up DATABASE_URL=...`).
DATABASE_URL ?= $(shell sed -n 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*"\{0,1\}\([^"]*\)"\{0,1\}[[:space:]]*$$/\1/p' $(ENV_FILE))

.PHONY: help infra-up infra-down env run build fmt vet tidy sqlc-generate migrate-up migrate-down migrate-new

help:
	@echo "GrepDocs targets:"
	@echo "  infra-up        Start Postgres, Redis, pgAdmin in Docker"
	@echo "  infra-down      Stop the Docker infra"
	@echo "  env             Create $(ENV_FILE) from $(ENV_EXAMPLE) if missing"
	@echo "  run             Run the API server (go run main.go)"
	@echo "  build           Build the API module"
	@echo "  fmt, vet        Go formatting / vetting (quality gates)"
	@echo "  tidy            Sync go.sum with go.mod"
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

fmt:
	cd $(GO_DIR) && go fmt

vet:
	cd $(GO_DIR) && go vet

tidy:
	cd $(GO_DIR) && go tidy

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