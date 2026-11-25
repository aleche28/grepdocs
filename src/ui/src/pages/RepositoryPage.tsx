import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link, useOutlet, useParams } from 'react-router'
import { useProviders } from '../api/accounts.ts'
import { documentsQueryKey, useDocuments } from '../api/documents.ts'
import { parseId } from '../api/ids.ts'
import { type Repository, useRepositories } from '../api/repositories.ts'
import { ApiErrorMessage } from '../components/ApiErrorMessage.tsx'
import { providerDisplayName, syncStatusText } from './repositories/format.ts'
import { DocumentTree } from './repository/DocumentTree.tsx'

// /repositories/:repoId: the repository's documents as a tree, with the
// selected document (/repositories/:repoId/documents/:documentId) beside it.
// The tree stays mounted while the document changes.
export function RepositoryPage() {
  const params = useParams()
  const repoId = parseId(params.repoId)
  const documentId = parseId(params.documentId)
  const outlet = useOutlet()
  // Polled while a sync runs, so the page sees it end (useRefetchAfterSync).
  const repositories = useRepositories({ poll: true })
  // Only for the provider's name: the page never waits for it.
  const providers = useProviders()

  const repository =
    repoId === null
      ? undefined
      : repositories.data?.find((r) => r.id === repoId)
  const documents = useDocuments(repository?.id)
  useRefetchAfterSync(repository)

  const back = (
    <p>
      <Link to="/repositories">
        <span aria-hidden="true">← </span>Repositories
      </Link>
    </p>
  )

  if (!repository) {
    let content
    if (repositories.data || repoId === null) {
      content = (
        <>
          <h1>Repository not found</h1>
          <p>This repository isn't tracked.</p>
        </>
      )
    } else if (repositories.error) {
      content = (
        <ApiErrorMessage
          error={repositories.error}
          title="Could not load this repository"
          onRetry={() => void repositories.refetch()}
        />
      )
    } else {
      content = <p>Loading…</p>
    }
    return (
      <>
        {back}
        {content}
      </>
    )
  }

  const { full_name: fullName } = repository
  const displayName = providerDisplayName(
    providers.data?.find((p) => p.name === repository.provider),
    repository,
  )
  const selected = documents.data?.find((d) => d.id === documentId)

  let tree
  if (documents.data) {
    tree =
      documents.data.length === 0 ? (
        <EmptyState repository={repository} />
      ) : (
        <DocumentTree
          // A fresh open/closed state per repository.
          key={repository.id}
          repositoryId={repository.id}
          fullName={fullName}
          documents={documents.data}
          selected={selected}
        />
      )
  } else if (documents.error) {
    // Only when there is nothing to show: a failed refetch keeps the tree.
    tree = (
      <ApiErrorMessage
        error={documents.error}
        title="Could not load the documents"
        onRetry={() => void documents.refetch()}
      />
    )
  } else {
    tree = <p>Loading documents…</p>
  }

  return (
    <>
      {back}
      <div className="repository-heading">
        <h1>{fullName}</h1>
        <span>
          Branch <code>{repository.tracked_branch}</code>
        </span>
        <span aria-live="polite">{syncStatusText(repository)}</span>
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
      <div className="repository-browser">
        <div>{tree}</div>
        <div>{outlet ?? <p className="muted">Choose a document.</p>}</div>
      </div>
    </>
  )
}

// Why a repository has no documents, from its sync status.
function EmptyState({ repository }: { repository: Repository }) {
  const { full_name: fullName } = repository

  switch (repository.sync_status) {
    case 'queued':
    case 'running':
      return (
        <p>
          {fullName} is syncing. Its documents appear here when the sync ends.
        </p>
      )
    case 'failed':
      return (
        <p className="warning">
          The last sync of {fullName} failed.{' '}
          <Link to="/repositories">See what went wrong</Link>
        </p>
      )
    case 'ok':
      return (
        <p>
          There are no Markdown files on branch{' '}
          <code>{repository.tracked_branch}</code>.
        </p>
      )
    default:
      return (
        <p>
          {fullName} hasn't been synced yet.{' '}
          <Link to="/repositories">Sync it from Repositories</Link>
        </p>
      )
  }
}

// Refetches the repository's documents when a sync of it succeeds, which
// is when last_sync_at takes a new value. A failed sync leaves it alone, and
// so does the first value the page sees: the documents load with it.
function useRefetchAfterSync(repository: Repository | undefined) {
  const queryClient = useQueryClient()
  const seen = useRef<Pick<Repository, 'id' | 'last_sync_at'> | null>(null)
  const id = repository?.id
  const lastSyncAt = repository?.last_sync_at ?? null

  useEffect(() => {
    if (id === undefined) {
      return
    }
    const previous = seen.current
    seen.current = { id, last_sync_at: lastSyncAt }
    if (
      previous?.id === id &&
      lastSyncAt !== null &&
      lastSyncAt !== previous.last_sync_at
    ) {
      void queryClient.invalidateQueries({ queryKey: documentsQueryKey(id) })
    }
  }, [queryClient, id, lastSyncAt])
}
