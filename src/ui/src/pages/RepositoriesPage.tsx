import { type ReactNode, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAccounts, useProviders } from '../api/accounts.ts'
import { ApiError } from '../api/client.ts'
import {
  type Repository,
  useRepositories,
  useSyncRepository,
} from '../api/repositories.ts'
import { ApiErrorMessage } from '../components/ApiErrorMessage.tsx'
import { Banner } from '../components/Banner.tsx'
import { retryAfterText } from '../components/errorText.ts'
import { useAutoSync } from './repositories/autoSync.ts'
import { EditDialog } from './repositories/EditDialog.tsx'
import { byFullName } from './repositories/format.ts'
import { RepositoryRow } from './repositories/RepositoryRow.tsx'
import { UntrackDialog } from './repositories/UntrackDialog.tsx'

// What the banner above the list reports: the outcome of the last action,
// one at a time, replaced by the next.
type Notice =
  | { tone: 'success' | 'error'; message: ReactNode }
  | { error: unknown; title: string }

// The dialog open on a repository. The repository is the one the dialog
// opened on, used when a refetch no longer lists it.
interface DialogTarget {
  kind: 'edit' | 'untrack'
  repository: Repository
}

// /repositories: the tracked repositories with their sync status. The list
// is polled while a sync runs, so each row follows it to the end.
export function RepositoriesPage() {
  const repositories = useRepositories({ poll: true })
  // Only for names and links in the messages: the list never waits for them.
  const providers = useProviders()
  const accounts = useAccounts()
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dialog, setDialog] = useState<DialogTarget | null>(null)
  // Takes focus when a dialog closes and its row is gone.
  const noticeRef = useRef<HTMLDivElement>(null)
  // The sync that follows a branch change.
  const syncAfterEdit = useSyncRepository()

  useAutoSync(repositories.data, (count) =>
    setNotice({
      tone: 'error',
      message: `Automatic sync couldn't start for ${count === 1 ? '1 repository' : `${count} repositories`}: too many syncs are waiting. Sync ${count === 1 ? 'it' : 'them'} again in a minute.`,
    }),
  )

  const sorted = useMemo(
    () => (repositories.data ? byFullName(repositories.data) : undefined),
    [repositories.data],
  )

  const onSyncError = (repository: Repository, error: Error) => {
    const next = syncErrorNotice(repository, error)
    if (next) {
      setNotice(next)
    }
  }

  const providerOf = (repository: Repository) =>
    providers.data?.find((p) => p.name === repository.provider)
  const accountOf = (repository: Repository) =>
    repository.account_id === null
      ? undefined
      : accounts.data?.find((a) => a.id === repository.account_id)

  const onSaved = (repository: Repository, branchChanged: boolean) => {
    setDialog(null)
    setNotice({
      tone: 'success',
      message: branchChanged
        ? `${repository.full_name} now tracks ${repository.tracked_branch}.`
        : `Saved ${repository.full_name}.`,
    })
    // The documents still come from the old branch until a sync.
    if (branchChanged) {
      syncAfterEdit.mutate(repository.id, {
        onError: (error) => onSyncError(repository, error),
      })
    }
  }

  // The current row of the dialog's repository, so it shows what a poll
  // brought in.
  const dialogRepository =
    dialog &&
    (repositories.data?.find((r) => r.id === dialog.repository.id) ??
      dialog.repository)

  let content
  if (sorted) {
    const failed = sorted.filter((r) => r.sync_status === 'failed').length
    content =
      sorted.length === 0 ? (
        <p>You don't track any repository yet.</p>
      ) : (
        <>
          {failed > 0 && (
            <p className="warning">
              {failed === 1
                ? '1 repository failed its last sync.'
                : `${failed} repositories failed their last sync.`}
            </p>
          )}
          <ul className="repository-entries">
            {sorted.map((repository) => (
              <RepositoryRow
                key={repository.id}
                repository={repository}
                provider={providerOf(repository)}
                account={accountOf(repository)}
                onSyncError={onSyncError}
                onEdit={() => setDialog({ kind: 'edit', repository })}
                onUntrack={() => setDialog({ kind: 'untrack', repository })}
              />
            ))}
          </ul>
        </>
      )
  } else if (repositories.error) {
    // Only when there is nothing to show: a failed poll keeps the list.
    content = (
      <ApiErrorMessage
        error={repositories.error}
        title="Could not load your repositories"
        onRetry={() => void repositories.refetch()}
      />
    )
  } else {
    content = <p>Loading repositories…</p>
  }

  return (
    <>
      <div className="page-heading">
        <h1>Repositories</h1>
        <Link to="/repositories/track" className="button primary">
          Track a repository
        </Link>
      </div>
      <div ref={noticeRef} tabIndex={-1}>
        {notice &&
          ('error' in notice ? (
            <ApiErrorMessage error={notice.error} title={notice.title} />
          ) : (
            <Banner tone={notice.tone} onDismiss={() => setNotice(null)}>
              {notice.message}
            </Banner>
          ))}
      </div>
      {content}
      {dialog?.kind === 'edit' && dialogRepository && (
        <EditDialog
          // A fresh form, and mutation, per repository.
          key={dialogRepository.id}
          repository={dialogRepository}
          provider={providerOf(dialogRepository)}
          account={accountOf(dialogRepository)}
          onClose={() => setDialog(null)}
          onSaved={onSaved}
          fallbackFocus={noticeRef}
        />
      )}
      {dialog?.kind === 'untrack' && dialogRepository && (
        <UntrackDialog
          key={dialogRepository.id}
          repository={dialogRepository}
          provider={providerOf(dialogRepository)}
          onClose={() => setDialog(null)}
          onUntracked={() => {
            setDialog(null)
            setNotice({
              tone: 'success',
              message: `${dialogRepository.full_name} is no longer tracked.`,
            })
          }}
          // The row that opened it is gone: focus goes to the message.
          fallbackFocus={noticeRef}
        />
      )}
    </>
  )
}

// What a failed sync request shows. Null for a 409: the repository is busy
// already (another tab, or the auto-sync), and its row says so.
function syncErrorNotice(repository: Repository, error: Error): Notice | null {
  const { full_name: fullName } = repository
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'conflict':
        return null
      case 'not_found':
        return { tone: 'error', message: `${fullName} is no longer tracked.` }
      case 'service_unavailable':
        return {
          tone: 'error',
          message: `Too many syncs are waiting. ${retryAfterText(error.retryAfter)}`,
        }
    }
  }
  return { error, title: `Could not sync ${fullName}` }
}
