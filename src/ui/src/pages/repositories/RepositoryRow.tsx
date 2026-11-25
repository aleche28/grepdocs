import { Link } from 'react-router'
import type { ExternalAccount, Provider } from '../../api/accounts.ts'
import {
  isBusy,
  type Repository,
  useSyncRepository,
} from '../../api/repositories.ts'
import { formatDateTime } from './format.ts'
import { SyncError } from './SyncError.tsx'

interface RepositoryRowProps {
  repository: Repository
  provider: Provider | undefined
  account: ExternalAccount | undefined
  // A sync request failed; the page decides what to show.
  onSyncError: (repository: Repository, error: Error) => void
  onEdit: () => void
  onUntrack: () => void
}

export function RepositoryRow({
  repository,
  provider,
  account,
  onSyncError,
  onEdit,
  onUntrack,
}: RepositoryRowProps) {
  // One per row, so each Sync button knows whether its own request runs.
  const sync = useSyncRepository()
  const { full_name: fullName } = repository
  const displayName = provider?.display_name ?? repository.provider

  return (
    <li
      className={
        repository.sync_status === 'failed'
          ? 'repository-entry failed'
          : 'repository-entry'
      }
    >
      <div className="repository-identity">
        <Link to={`/repositories/${repository.id}`}>
          <strong>{fullName}</strong>
        </Link>
        <span className="muted">
          {repository.is_private ? 'Private' : 'Public'}
        </span>
        <span>
          Branch <code>{repository.tracked_branch}</code>
        </span>
        {repository.auto_sync && <span className="muted">Auto-sync</span>}
        <a
          href={repository.html_url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${fullName} on ${displayName}`}
        >
          {displayName}
          <span aria-hidden="true"> ↗</span>
        </a>
      </div>
      {/* Polite: a sync started here ends while the user does something
          else, and its outcome is announced then. */}
      <div className="sync-state" aria-live="polite">
        <SyncState
          repository={repository}
          provider={provider}
          account={account}
          onChangeBranch={onEdit}
        />
      </div>
      <div className="actions">
        <button
          type="button"
          onClick={() =>
            sync.mutate(repository.id, {
              onError: (error) => onSyncError(repository, error),
            })
          }
          disabled={sync.isPending || isBusy(repository)}
          aria-label={`Sync ${fullName}`}
        >
          {sync.isPending ? 'Starting…' : 'Sync'}
        </button>
        <button type="button" onClick={onEdit} aria-label={`Edit ${fullName}`}>
          Edit
        </button>
        <button
          type="button"
          onClick={onUntrack}
          aria-label={`Untrack ${fullName}`}
        >
          Untrack
        </button>
      </div>
    </li>
  )
}

interface SyncStateProps {
  repository: Repository
  provider: Provider | undefined
  account: ExternalAccount | undefined
  onChangeBranch: () => void
}

// The sync_status in words. An unknown status reads as pending. The error is
// shown only once the sync failed: the API keeps it while a retry is queued.
function SyncState({
  repository,
  provider,
  account,
  onChangeBranch,
}: SyncStateProps) {
  const lastSync = formatDateTime(repository.last_sync_at)

  switch (repository.sync_status) {
    case 'queued':
      return <p>Waiting to sync…</p>
    case 'running':
      return <p>Syncing…</p>
    case 'ok':
      return <p>{lastSync ? `Synced ${lastSync}` : 'Synced'}</p>
    case 'failed':
      return (
        <div className="warning">
          <p>
            <strong>Sync failed.</strong>
            {lastSync && ` Last synced ${lastSync}.`}
          </p>
          <SyncError
            repository={repository}
            provider={provider}
            account={account}
            onChangeBranch={onChangeBranch}
          />
        </div>
      )
    default:
      return <p>Not synced yet</p>
  }
}
