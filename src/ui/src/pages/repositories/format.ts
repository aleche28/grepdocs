import type { Provider } from '../../api/accounts.ts'
import type { Repository } from '../../api/repositories.ts'

// How messages name a repository's provider: its display name, or the raw
// name when GET /providers does not list it (or has not loaded).
export function providerDisplayName(
  provider: Provider | undefined,
  repository: Pick<Repository, 'provider'>,
): string {
  return provider?.display_name ?? repository.provider
}

// The list in a stable order, so a row does not move when its status
// changes.
export function byFullName(repositories: Repository[]): Repository[] {
  return [...repositories].sort((a, b) =>
    a.full_name.localeCompare(b.full_name),
  )
}
