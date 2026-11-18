#!/usr/bin/env bash
# Runs once when the dev container is created (postCreateCommand), from the workspace root.
set -eo pipefail

# The node_modules volume is mounted inside the bind mount, so it starts out owned by root.
sudo chown vscode:vscode src/ui/node_modules

# Node at the version in src/ui/.nvmrc, the same file CI reads. `nvm install` with no argument
# reads .nvmrc; the node feature points PATH at nvm's "current" symlink, so non-login shells (make,
# editor tasks) see it too.
# shellcheck source=/dev/null
. "$NVM_DIR/nvm.sh"
(cd src/ui && nvm install && nvm alias default "$(cat .nvmrc)")

set -u

make env
(cd src/api && go mod download)
make ui-install

# Claude Code, from the native installer: it needs no Node and updates itself, so it is not pinned
# like the Dockerfile's tools. A rebuild reinstalls it; the login survives in the claude-config volume.
curl -fsSL https://claude.ai/install.sh | bash
