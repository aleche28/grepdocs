import {
  FileQuestion,
  FileText,
  FolderGit2,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, Outlet, useOutlet, useParams } from 'react-router'
import { useProviders } from '../api/accounts.ts'
import { useDocuments } from '../api/documents.ts'
import { parseId } from '../api/ids.ts'
import { type Repository, useRepositories } from '../api/repositories.ts'
import { ApiErrorMessage } from '../components/ApiErrorMessage.tsx'
import { StatusPill } from '../components/StatusPill.tsx'
import {
  providerDisplayName,
  syncStatusText,
  syncTone,
} from './repositories/format.ts'
import { UpstreamLink } from './repositories/UpstreamLink.tsx'
import { ContentHeader } from './repository/ContentHeader.tsx'
import type { RepositoryContext } from './repository/context.ts'
import { DocumentTree } from './repository/DocumentTree.tsx'
import { RepositorySwitcher } from './repository/RepositorySwitcher.tsx'

// /repositories/:repoId: a sidebar with the repository's documents as a
// tree, and the selected document (/repositories/:repoId/documents/
// :documentId) in the content column beside it. The tree stays mounted
// while the document changes. The route asks AppLayout for the full-width
// docs layout (router.tsx).
export function RepositoryPage() {
  const params = useParams()
  const repoId = parseId(params.repoId)
  const documentId = parseId(params.documentId)
  // Polled while a sync runs, so the page sees it end, and the documents it
  // replaced are refetched (useRepositories marks them stale).
  const repositories = useRepositories({ poll: true })
  // Only for the provider's name: the page never waits for it.
  const providers = useProviders()

  const repository = repositories.data?.find((r) => r.id === repoId)
  const documents = useDocuments(repository?.id)
  const outlet = useOutlet()

  if (!repository) {
    let content
    if (repositories.data || repoId === null) {
      content = (
        <>
          <ContentHeader title="Repository not found" />
          <div className="content-body">
            <div className="empty-state">
              <span className="empty-icon">
                <FileQuestion size={20} />
              </span>
              <p>This repository isn't tracked.</p>
              <Link to="/repositories" className="button">
                Go to your repositories
              </Link>
            </div>
          </div>
        </>
      )
    } else if (repositories.error) {
      content = (
        <>
          <ContentHeader title="Repository" />
          <div className="content-body">
            <ApiErrorMessage
              error={repositories.error}
              title="Could not load this repository"
              onRetry={() => void repositories.refetch()}
            />
          </div>
        </>
      )
    } else {
      content = (
        <div className="content-body">
          <div className="empty-state loading">
            <LoaderCircle className="spin" size={16} />
            <p>Loading repository…</p>
          </div>
        </div>
      )
    }
    return <div className="docs-content">{content}</div>
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
        <p className="tree-empty">No documents.</p>
      ) : (
        <DocumentTree
          // A fresh open/closed state and filter per repository.
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
    tree = <p className="tree-empty">Loading documents…</p>
  }

  let content
  if (outlet) {
    content = (
      <Outlet
        context={
          {
            repository,
            documents: documents.data,
          } satisfies RepositoryContext
        }
      />
    )
  } else {
    let body
    if (documents.data?.length === 0) {
      body = <EmptyState repository={repository} />
    } else if (documents.data) {
      body = <p className="muted">Choose a document.</p>
    }
    content = (
      <>
        <ContentHeader repository={repository} />
        <div className="content-body">{body}</div>
      </>
    )
  }

  const count = documents.data?.length

  return (
    <div className="docs-layout">
      <div className="docs-sidebar">
        <RepositorySwitcher
          current={repository}
          repositories={repositories.data ?? [repository]}
        />
        <div className="sidebar-meta">
          <span className="chip">
            <GitBranch size={12} />
            <span className="visually-hidden">Branch </span>
            <code>{repository.tracked_branch}</code>
          </span>
          <StatusPill
            tone={syncTone(repository.sync_status)}
            aria-live="polite"
          >
            {syncStatusText(repository)}
          </StatusPill>
          <UpstreamLink repository={repository} displayName={displayName} />
        </div>
        {tree}
        {count !== undefined && count > 0 && (
          <p className="sidebar-footer">
            {count === 1 ? '1 document' : `${count} documents`} on{' '}
            {repository.tracked_branch}
          </p>
        )}
      </div>
      <div className="docs-content">{content}</div>
    </div>
  )
}

// Why a repository has no documents, from its sync status.
function EmptyState({ repository }: { repository: Repository }) {
  const { full_name: fullName } = repository

  switch (repository.sync_status) {
    case 'queued':
    case 'running':
      return (
        <EmptyFrame icon={<RefreshCw size={20} />} title="Syncing">
          {fullName} is syncing. Its documents appear here when the sync ends.
        </EmptyFrame>
      )
    case 'failed':
      return (
        <EmptyFrame icon={<TriangleAlert size={20} />} title="Last sync failed">
          The last sync of {fullName} failed.{' '}
          <Link to="/repositories">See what went wrong</Link>
        </EmptyFrame>
      )
    case 'ok':
      return (
        <EmptyFrame icon={<FileText size={20} />} title="No documents">
          There are no Markdown files on branch{' '}
          <code>{repository.tracked_branch}</code>.
        </EmptyFrame>
      )
    default:
      return (
        <EmptyFrame icon={<FolderGit2 size={20} />} title="Not synced yet">
          {fullName} hasn't been synced yet.{' '}
          <Link to="/repositories">Sync it from Repositories</Link>
        </EmptyFrame>
      )
  }
}

interface EmptyFrameProps {
  icon: ReactNode
  title: string
  // One sentence, with its link.
  children: ReactNode
}

function EmptyFrame({ icon, title, children }: EmptyFrameProps) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  )
}
