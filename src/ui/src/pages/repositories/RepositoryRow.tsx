import { Link } from 'react-router'
import type { ExternalAccount, Provider } from '../../api/accounts.ts'
import {
  isBusy,
  type Repository,
  useSyncRepository,
  useSyncStarting,
} from '../../api/repositories.ts'
import { formatDateTime } from '../accounts/format.ts'
import { providerDisplayName, syncStatusText } from './format.ts'
import { SyncError } from './SyncError.tsx'
import { UpstreamLink } from './UpstreamLink.tsx'

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
  const { mutateAsync: sync } = useSyncRepository()
  // Also true for a sync the auto-sync or a branch change started.
  const starting = useSyncStarting(repository.id)
  const { full_name: fullName } = repository
  const displayName = providerDisplayName(provider, repository)

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
        <UpstreamLink repository={repository} displayName={displayName} />
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
            void sync(repository.id).catch((error: Error) =>
              onSyncError(repository, error),
            )
          }
          disabled={starting || isBusy(repository)}
          aria-label={`Sync ${fullName}`}
        >
          {starting ? 'Starting…' : 'Sync'}
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

// The sync_status in words, with the error and its fix once the sync
// failed. Not while a retry is queued: the API keeps the error until then.
function SyncState({
  repository,
  provider,
  account,
  onChangeBranch,
}: SyncStateProps) {
  if (repository.sync_status !== 'failed') {
    return <p>{syncStatusText(repository)}</p>
  }

  const lastSync = formatDateTime(repository.last_sync_at)
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
}
