import { lazy, Suspense, useEffect, useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useProviders } from '../api/accounts.ts'
import { ApiError } from '../api/client.ts'
import { type DocumentDetail, useDocument } from '../api/documents.ts'
import { parseId } from '../api/ids.ts'
import { ApiErrorMessage } from '../components/ApiErrorMessage.tsx'
import { ExternalLink } from '../components/ExternalLink.tsx'
import { formatDateTime } from './accounts/format.ts'
import { providerDisplayName } from './repositories/format.ts'
import { useRepositoryContext } from './repository/context.ts'
import { documentRoute, providerFileUrl } from './repository/links.ts'
import type { LinkTargets } from './repository/MarkdownView.tsx'

// The Markdown libraries are a chunk of their own, not part of the rest of
// the app. DocumentPage starts loading it alongside the document.
const loadMarkdownView = () => import('./repository/MarkdownView.tsx')
const MarkdownView = lazy(loadMarkdownView)

// /repositories/:repoId/documents/:documentId, in RepositoryPage's right
// column: one document, rendered or (?view=raw) as its source.
export function DocumentPage() {
  const params = useParams()
  const documentId = parseId(params.documentId)
  const { repository } = useRepositoryContext()
  const detail = useDocument(repository.id, documentId)

  useEffect(() => {
    void loadMarkdownView()
  }, [])

  if (documentId === null) {
    return <p>Document not found.</p>
  }
  // A 404 wins over the document shown so far: a sync removed it.
  if (detail.error instanceof ApiError && detail.error.code === 'not_found') {
    return <p>Document not found. The last sync may have removed it.</p>
  }
  if (detail.data) {
    if (detail.data.repository_id !== repository.id) {
      return (
        <p>
          This document is in another repository.{' '}
          <Link to={documentRoute(detail.data.repository_id, detail.data.id)}>
            Open it there
          </Link>
        </p>
      )
    }
    // A failed refetch keeps the document.
    return <DocumentView document={detail.data} />
  }
  if (detail.error) {
    return (
      <ApiErrorMessage
        error={detail.error}
        title="Could not load the document"
        onRetry={() => void detail.refetch()}
      />
    )
  }
  return <p>Loading document…</p>
}

function DocumentView({ document }: { document: DocumentDetail }) {
  const { repository, documents } = useRepositoryContext()
  const providers = useProviders()
  const [searchParams] = useSearchParams()
  const raw = searchParams.get('view') === 'raw'
  // The synced commit, which the content is from. Every stored document has
  // one; the branch is only a fallback.
  const ref = document.upstream_commit ?? document.branch

  // Only on what the links read: the polled repository is a new object on
  // every change of its sync status, and a new `links` parses the document
  // again.
  const { id: repoId, provider, html_url: htmlUrl } = repository
  const links = useMemo((): LinkTargets => {
    const ids = new Map(documents?.map((d) => [d.path, d.id]))
    const upstream = { provider, html_url: htmlUrl }
    return {
      documentRoute: (path) => {
        const id = ids.get(path)
        return id === undefined ? null : documentRoute(repoId, id)
      },
      fileUrl: (path, kind) => providerFileUrl(upstream, ref, path, kind),
    }
  }, [documents, repoId, provider, htmlUrl, ref])

  const upstream = providerFileUrl(repository, ref, document.path, 'blob')
  const displayName = providerDisplayName(
    providers.data?.find((p) => p.name === provider),
    repository,
  )
  const syncedAt = formatDateTime(document.synced_at)

  let body
  if (document.content === '') {
    body = <p className="muted">This document is empty.</p>
  } else if (raw) {
    body = (
      <pre className="document-raw">
        <code>{document.content}</code>
      </pre>
    )
  } else {
    body = (
      <Suspense fallback={<p>Loading document…</p>}>
        <MarkdownView
          content={document.content}
          path={document.path}
          links={links}
        />
      </Suspense>
    )
  }

  return (
    <div className="document">
      <h2>{document.path}</h2>
      <p className="document-origin">
        <span>
          Branch <code>{document.branch}</code>
        </span>
        {document.upstream_commit && (
          <span>
            Commit <code>{document.upstream_commit.slice(0, 7)}</code>
          </span>
        )}
        {syncedAt && <span>Synced {syncedAt}</span>}
        {upstream && (
          <ExternalLink href={upstream}>View on {displayName}</ExternalLink>
        )}
      </p>
      <nav className="document-modes" aria-label="View">
        <Link
          to={{ search: '' }}
          replace
          aria-current={raw ? undefined : 'page'}
        >
          Rendered
        </Link>
        <Link
          to={{ search: '?view=raw' }}
          replace
          aria-current={raw ? 'page' : undefined}
        >
          Raw
        </Link>
      </nav>
      {body}
    </div>
  )
}
