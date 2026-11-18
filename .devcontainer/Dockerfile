# Dev container image: the Go toolchain plus the tools CI and the Makefile need, at pinned versions.
# Node is installed by post-create.sh, at the version in src/ui/.nvmrc.

# Only the toolchain is taken from here. GOTOOLCHAIN stays auto (go.env), so a newer `toolchain`
# line in src/api/go.mod is downloaded on first use, as on the host; keep this tag in step anyway.
FROM golang:1.27.4-trixie AS go

FROM mcr.microsoft.com/devcontainers/base:2.2.6-trixie

# gcc and libc headers: the race detector (make test-race) needs cgo.
# psql and redis-cli: for poking at the local infra.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        gcc libc6-dev postgresql-client redis-tools \
    && rm -rf /var/lib/apt/lists/*

COPY --from=go /usr/local/go /usr/local/go
ENV GOPATH=/home/vscode/go
ENV PATH=/usr/local/go/bin:${GOPATH}/bin:${PATH}

# Created here, owned by the user, so the named volumes mounted on them start with that owner.
RUN mkdir -p /home/vscode/go/pkg/mod /home/vscode/.cache/go-build /home/vscode/.claude \
    && chown -R vscode:vscode /home/vscode/go /home/vscode/.cache /home/vscode/.claude

# Claude Code's native installer (post-create.sh) puts the binary here
ENV PATH=/home/vscode/.local/bin:${PATH}

# Release binaries, checked against the sha256 of each linux archive. Bump a version together with
# both of its checksums. This is the single place these versions live: CI reads the golangci-lint
# version and the vacuum version and amd64 checksum from here (.github/workflows/ci.yml), and so
# does the Makefile for VACUUM_VERSION. SQLC_VERSION must match the version in the header of the
# generated files in src/api/dal.
ARG GOLANGCI_LINT_VERSION=2.15.0
ARG GOLANGCI_LINT_SHA256_AMD64=9b7fe6a6bf6334b98decf8d86b11415ea7889afdabdd1959fdce23af2a9ebcea
ARG GOLANGCI_LINT_SHA256_ARM64=b4d8f17068b35ee6060cc2f69a16fb48740d706fbba81661c318649c114a6998
ARG SQLC_VERSION=1.30.0
ARG SQLC_SHA256_AMD64=468aecee071bfe55e97fcbcac52ea0208eeca444f67736f3b8f0f3d6a106132e
ARG SQLC_SHA256_ARM64=dd9ab43b022ba3b3402054f99d7ae6e5efea33c949e869c3c66b214415e0c82d
ARG MIGRATE_VERSION=4.20.1
ARG MIGRATE_SHA256_AMD64=b1e13121d4178b7804a9fb29dca62d57b732390f7e5ae33f2cd65e9b192e1bd4
ARG MIGRATE_SHA256_ARM64=03ea70d9ba535b68fe03602120d1856a567cd0fa2fbca3748ba8070e9d4b8f60
ARG VACUUM_VERSION=0.39.3
ARG VACUUM_SHA256_AMD64=fd08ed9bb27f84c740008029ba992681046479ea5f745108ea3fd87d3988fd47
ARG VACUUM_SHA256_ARM64=57052b0ca332508d04f7e7cbae5c8e954e8ae5fa1d529837386c7b42da7d7900
ARG TARGETARCH

RUN set -eu; \
    arch="${TARGETARCH:-$(dpkg --print-architecture)}"; \
    case "$arch" in \
        amd64) lint_sha=$GOLANGCI_LINT_SHA256_AMD64; sqlc_sha=$SQLC_SHA256_AMD64; migrate_sha=$MIGRATE_SHA256_AMD64; \
               vacuum_sha=$VACUUM_SHA256_AMD64; vacuum_arch=x86_64 ;; \
        arm64) lint_sha=$GOLANGCI_LINT_SHA256_ARM64; sqlc_sha=$SQLC_SHA256_ARM64; migrate_sha=$MIGRATE_SHA256_ARM64; \
               vacuum_sha=$VACUUM_SHA256_ARM64; vacuum_arch=arm64 ;; \
        *) echo "unsupported architecture: $arch" >&2; exit 1 ;; \
    esac; \
    tmp=$(mktemp -d); cd "$tmp"; \
    fetch() { curl -fsSLo "$1" "$2"; echo "$3  $1" | sha256sum -c -; }; \
    fetch golangci-lint.tar.gz "https://github.com/golangci/golangci-lint/releases/download/v${GOLANGCI_LINT_VERSION}/golangci-lint-${GOLANGCI_LINT_VERSION}-linux-${arch}.tar.gz" "$lint_sha"; \
    tar -xzf golangci-lint.tar.gz --no-same-owner --strip-components=1 -C /usr/local/bin "golangci-lint-${GOLANGCI_LINT_VERSION}-linux-${arch}/golangci-lint"; \
    fetch sqlc.tar.gz "https://github.com/sqlc-dev/sqlc/releases/download/v${SQLC_VERSION}/sqlc_${SQLC_VERSION}_linux_${arch}.tar.gz" "$sqlc_sha"; \
    tar -xzf sqlc.tar.gz --no-same-owner -C /usr/local/bin sqlc; \
    fetch migrate.tar.gz "https://github.com/golang-migrate/migrate/releases/download/v${MIGRATE_VERSION}/migrate.linux-${arch}.tar.gz" "$migrate_sha"; \
    tar -xzf migrate.tar.gz --no-same-owner -C /usr/local/bin migrate; \
    fetch vacuum.tar.gz "https://github.com/daveshanley/vacuum/releases/download/v${VACUUM_VERSION}/vacuum_${VACUUM_VERSION}_linux_${vacuum_arch}.tar.gz" "$vacuum_sha"; \
    tar -xzf vacuum.tar.gz --no-same-owner -C /usr/local/bin vacuum; \
    cd /; rm -rf "$tmp"

# make openapi-lint runs this binary instead of compiling vacuum with `go run` (the Makefile's
# VACUUM ?= defers to the environment)
ENV VACUUM=vacuum
