import type { ExternalAccount, Provider } from '../../api/accounts.ts'
import type { Repository, SyncStatus } from '../../api/repositories.ts'
import type { StatusTone } from '../../components/StatusPill.tsx'
import { accountName, formatDateTime } from '../accounts/format.ts'

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

// The status pill's text on the repositories page, where the time of the
// last sync sits beside it. An unknown status reads as pending.
export function syncStatusLabel(status: SyncStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'running':
      return 'Syncing'
    case 'ok':
      return 'Synced'
    case 'failed':
      return 'Failed'
    default:
      return 'Not synced yet'
  }
}

// The status pill's colour for a sync_status.
export function syncTone(status: SyncStatus): StatusTone {
  switch (status) {
    case 'ok':
      return 'ok'
    case 'queued':
    case 'running':
      return 'busy'
    case 'failed':
      return 'failed'
    default:
      return 'pending'
  }
}

// Where a repository comes from: "GitHub · @octocat", or what it syncs
// without when it has no account. Only the provider while the account is
// unknown (GET /accounts has not loaded, or does not list it).
export function repositorySource(
  repository: Pick<Repository, 'account_id' | 'is_private'>,
  displayName: string,
  account: ExternalAccount | undefined,
): string {
  if (repository.account_id === null) {
    return `${displayName} · ${repository.is_private ? 'no account' : 'public, no account'}`
  }
  return account
    ? `${displayName} · ${accountName(account, displayName)}`
    : displayName
}

// In English, like the rest of the UI. numeric: 'auto' says "yesterday"
// rather than "1 day ago".
const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

// From the largest unit down, in seconds.
const relativeUnits: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

// How long before `now` (in ms) a timestamp from the API was: "just now",
// "4 minutes ago", "yesterday". Null when there is none or it does not
// parse. A time after `now` (a clock ahead of this one) is just now.
export function relativeTime(value: string | null, now: number): string | null {
  if (value === null) {
    return null
  }
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) {
    return null
  }
  const seconds = Math.max(0, (now - time) / 1000)
  for (const [unit, size] of relativeUnits) {
    if (seconds >= size) {
      return relativeFormat.format(-Math.floor(seconds / size), unit)
    }
  }
  return 'just now'
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
