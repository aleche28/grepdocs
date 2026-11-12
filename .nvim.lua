-- Project-local Neovim config, loaded when 'exrc' is on (approve it once with :trust).
--
-- Go files are formatted by golangci-lint with src/api/.golangci.yml (gofumpt + gci), the same
-- formatters `make fmt` and CI run. Plain gofumpt reads the buffer from stdin and cannot see
-- go.mod, so it takes grepdocs/api for a standard-library path and moves its imports into the
-- standard group.
local ok, conform = pcall(require, 'conform')
if not ok then
  return
end

-- goimports still adds and removes imports; golangci-lint then fixes formatting and grouping.
conform.formatters_by_ft.go = { 'goimports', 'golangci-lint' }
conform.formatters['golangci-lint'] = {
  -- golangci-lint looks for its config from the working directory upwards.
  cwd = require('conform.util').root_file { '.golangci.yml' },
  require_cwd = true,
}
