import type { Provider } from '../../api/accounts.ts'
import type { Repository } from '../../api/repositories.ts'
import { formatDateTime } from '../accounts/format.ts'

// The sync_status in words. An unknown status reads as pending. A failed
// sync names the last successful one, whose documents are still stored.
export function syncStatusText(
  repository: Pick<Repository, 'sync_status' | 'last_sync_at'>,
): string {
  const lastSync = formatDateTime(repository.last_sync_at)

  switch (repository.sync_status) {
    case 'queued':
      return 'Waiting to sync…'
    case 'running':
      return 'Syncing…'
    case 'ok':
      return lastSync ? `Synced ${lastSync}` : 'Synced'
    case 'failed':
      return lastSync ? `Sync failed. Last synced ${lastSync}.` : 'Sync failed.'
    default:
      return 'Not synced yet'
  }
}

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
