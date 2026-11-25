import { type ReactNode, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAccounts, useProviders } from '../api/accounts.ts'
import { ApiError } from '../api/client.ts'
import { type Repository, useRepositories } from '../api/repositories.ts'
import { ApiErrorMessage } from '../components/ApiErrorMessage.tsx'
import { Banner } from '../components/Banner.tsx'
import { retryAfterText } from '../components/errorText.ts'
import { useAutoSync } from './repositories/autoSync.ts'
import { byFullName } from './repositories/format.ts'
import { RepositoryRow } from './repositories/RepositoryRow.tsx'

// What the banner above the list reports: the outcome of the last action,
// one at a time, replaced by the next.
type Notice =
  | { tone: 'success' | 'error'; message: ReactNode }
  | { error: unknown; title: string }

// /repositories: the tracked repositories with their sync status. The list
// is polled while a sync runs, so each row follows it to the end.
export function RepositoriesPage() {
  const repositories = useRepositories({ poll: true })
  // Only for names and links in the messages: the list never waits for them.
  const providers = useProviders()
  const accounts = useAccounts()
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeRef = useRef<HTMLDivElement>(null)

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
                provider={providers.data?.find(
                  (p) => p.name === repository.provider,
                )}
                account={
                  repository.account_id === null
                    ? undefined
                    : accounts.data?.find((a) => a.id === repository.account_id)
                }
                onSyncError={onSyncError}
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
