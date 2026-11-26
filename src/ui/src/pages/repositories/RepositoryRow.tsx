import {
  Check,
  Ellipsis,
  GitBranch,
  Globe,
  Lock,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { Link } from 'react-router'
import type { ExternalAccount, Provider } from '../../api/accounts.ts'
import {
  isBusy,
  type Repository,
  useSyncRepository,
  useSyncStarting,
} from '../../api/repositories.ts'
import { ExternalLink } from '../../components/ExternalLink.tsx'
import { Menu } from '../../components/Menu.tsx'
import { StatusPill } from '../../components/StatusPill.tsx'
import {
  providerDisplayName,
  repositorySource,
  syncStatusLabel,
  syncTone,
} from './format.ts'
import { RelativeTime } from './RelativeTime.tsx'
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

// One repository: its name and source, branch, sync status and auto-sync as
// the columns of the page's grid (a card on a narrow screen), its actions,
// and why its last sync failed below them. The column headers are hidden
// from screen readers, so each cell carries its own label.
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
  const { full_name: fullName, sync_status: status } = repository
  const displayName = providerDisplayName(provider, repository)

  return (
    <li>
      <div className="entry-main">
        <div className="entry-name">
          <span className="row-icon">
            {repository.is_private ? <Lock size={14} /> : <Globe size={14} />}
            <span className="visually-hidden">
              {repository.is_private ? 'Private' : 'Public'}
            </span>
          </span>
          <div className="entry-text">
            <Link
              to={`/repositories/${repository.id}`}
              className="entry-link"
              // The name is cut short when the column is narrow.
              title={fullName}
            >
              {fullName}
            </Link>
            <span className="entry-source">
              {repositorySource(repository, displayName, account)}
            </span>
          </div>
        </div>
        <div className="entry-facts">
          <div className="entry-branch">
            <span className="chip" title={repository.tracked_branch}>
              <GitBranch size={12} />
              <span className="visually-hidden">Branch </span>
              <code>{repository.tracked_branch}</code>
            </span>
          </div>
          <div className="entry-status">
            <span className="visually-hidden">Status </span>
            {/* Polite: a sync started here ends while the user does something
                else, and its outcome is announced then. */}
            <StatusPill
              tone={starting ? 'busy' : syncTone(status)}
              aria-live="polite"
            >
              {starting ? 'Starting…' : syncStatusLabel(status)}
            </StatusPill>
            {status === 'ok' && !starting && repository.last_sync_at && (
              <span className="entry-when">
                <RelativeTime value={repository.last_sync_at} />
              </span>
            )}
          </div>
          <div
            className={repository.auto_sync ? 'entry-auto on' : 'entry-auto'}
          >
            <span className="cell-label">Auto-sync </span>
            {repository.auto_sync ? (
              <>
                <Check size={14} strokeWidth={2.4} />
                On
              </>
            ) : (
              'Off'
            )}
          </div>
        </div>
        <div className="entry-actions">
          <button
            type="button"
            className="icon-button"
            onClick={() =>
              void sync(repository.id).catch((error: Error) =>
                onSyncError(repository, error),
              )
            }
            disabled={starting || isBusy(repository)}
            aria-label={`Sync ${fullName}`}
            title="Sync now"
          >
            <RefreshCw size={16} className={starting ? 'spin' : undefined} />
          </button>
          <Menu
            triggerClassName="icon-button"
            label={`More actions for ${fullName}`}
            trigger={<Ellipsis size={16} />}
          >
            <button type="button" className="menu-item" onClick={onEdit}>
              <Pencil size={15} />
              Edit branch and sync
            </button>
            <ExternalLink href={repository.html_url} className="menu-item">
              View on {displayName}
            </ExternalLink>
            <div className="menu-separator" />
            <button
              type="button"
              className="menu-item menu-danger"
              onClick={onUntrack}
            >
              <Trash2 size={15} />
              Untrack
            </button>
          </Menu>
        </div>
      </div>
      {/* Always rendered, so the reason is announced when a sync fails. */}
      <div aria-live="polite">
        {status === 'failed' && (
          <SyncError
            repository={repository}
            provider={provider}
            account={account}
            onChangeBranch={onEdit}
          />
        )}
      </div>
    </li>
  )
}
