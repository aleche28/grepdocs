import type { Repository } from '../api/repositories.ts'

// A tracked repository as GET /repositories returns it: acme/docs on main,
// synced through account 3, unless overridden. owner, name, html_url and
// provider_repo_id follow full_name when only that is given.
export function repository(overrides: Partial<Repository> = {}): Repository {
  const fullName = overrides.full_name ?? 'acme/docs'
  const [owner, name] = fullName.split('/')
  return {
    id: 12,
    account_id: 3,
    provider: 'github',
    provider_repo_id: `id-${fullName}`,
    owner,
    name,
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    is_private: false,
    default_branch: 'main',
    tracked_branch: 'main',
    synced_commit: null,
    sync_status: 'pending',
    sync_error: null,
    auto_sync: false,
    last_sync_at: null,
    ...overrides,
  }
}
