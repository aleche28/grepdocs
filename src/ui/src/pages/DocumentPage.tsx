import { Copy, GitBranch, GitCommitHorizontal, Link2 } from 'lucide-react'
import { lazy, type ReactNode, Suspense, useEffect, useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useProviders } from '../api/accounts.ts'
import { ApiError } from '../api/client.ts'
import { type DocumentDetail, useDocument } from '../api/documents.ts'
import { parseId } from '../api/ids.ts'
import { ApiErrorMessage } from '../components/ApiErrorMessage.tsx'
import { ExternalLink } from '../components/ExternalLink.tsx'
import { formatDateTime } from './accounts/format.ts'
import { providerDisplayName } from './repositories/format.ts'
import { useCopyToClipboard } from './repository/clipboard.ts'
import { ContentHeader } from './repository/ContentHeader.tsx'
import { useRepositoryContext } from './repository/context.ts'
import { documentRoute, providerFileUrl } from './repository/links.ts'
import type { LinkTargets } from './repository/MarkdownView.tsx'

// The Markdown libraries are a chunk of their own, not part of the rest of
// the app. DocumentPage starts loading it alongside the document.
const loadMarkdownView = () => import('./repository/MarkdownView.tsx')
const MarkdownView = lazy(loadMarkdownView)

// /repositories/:repoId/documents/:documentId, in RepositoryPage's content
// column: one document, rendered or (?view=raw) as its source, under a
// header with its path and actions.
export function DocumentPage() {
  const params = useParams()
  const documentId = parseId(params.documentId)
  const { repository, documents } = useRepositoryContext()
  const detail = useDocument(repository.id, documentId)
  // From the list the tree shows, for the header while the document loads.
  const listedPath = documents?.find((d) => d.id === documentId)?.path

  useEffect(() => {
    void loadMarkdownView()
  }, [])

  const message = (title: string, body: ReactNode) => (
    <>
      <ContentHeader repository={repository} title={title} />
      <div className="content-body">{body}</div>
    </>
  )

  if (documentId === null) {
    return message(
      'Document not found',
      <p>There is no document at this address.</p>,
    )
  }
  // A 404 wins over the document shown so far: a sync removed it.
  if (detail.error instanceof ApiError && detail.error.code === 'not_found') {
    return message(
      'Document not found',
      <p>The last sync may have removed it.</p>,
    )
  }
  if (detail.data) {
    if (detail.data.repository_id !== repository.id) {
      return message(
        'Document in another repository',
        <p>
          This document is in another repository.{' '}
          <Link to={documentRoute(detail.data.repository_id, detail.data.id)}>
            Open it there
          </Link>
        </p>,
      )
    }
    // A failed refetch keeps the document.
    return <DocumentView document={detail.data} />
  }

  const header = (
    <ContentHeader
      repository={repository}
      path={listedPath}
      title={listedPath ? undefined : 'Document'}
    />
  )
  if (detail.error) {
    return (
      <>
        {header}
        <div className="content-body">
          <ApiErrorMessage
            error={detail.error}
            title="Could not load the document"
            onRetry={() => void detail.refetch()}
          />
        </div>
      </>
    )
  }
  return (
    <>
      {header}
      <div className="content-body">
        <p className="muted">Loading document…</p>
      </div>
    </>
  )
}

function DocumentView({ document }: { document: DocumentDetail }) {
  const { repository, documents } = useRepositoryContext()
  const providers = useProviders()
  const [searchParams] = useSearchParams()
  const raw = searchParams.get('view') === 'raw'
  const clipboard = useCopyToClipboard()
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
  // The document's page in the app, without the view or a heading.
  const link = new URL(
    documentRoute(repoId, document.id),
    window.location.origin,
  ).href

  let body
  if (document.content === '') {
    body = <p className="muted">This document is empty.</p>
  } else if (raw) {
    body = <RawSource content={document.content} path={document.path} />
  } else {
    body = (
      <Suspense fallback={<p className="muted">Loading document…</p>}>
        <MarkdownView
          content={document.content}
          path={document.path}
          links={links}
        />
      </Suspense>
    )
  }

  const actions = (
    <>
      <div className="segmented" role="group" aria-label="View">
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
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label="Copy link to this document"
        title="Copy link"
        onClick={() =>
          void clipboard.copy(link, 'Link copied', 'Could not copy the link')
        }
      >
        <Link2 size={16} />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Copy file path"
        title="Copy path"
        onClick={() =>
          void clipboard.copy(
            document.path,
            'Path copied',
            'Could not copy the path',
          )
        }
      >
        <Copy size={16} />
      </button>
      {upstream && (
        <ExternalLink href={upstream} className="button">
          View on {displayName}
        </ExternalLink>
      )}
    </>
  )

  const meta = (
    <p className="document-meta">
      <span className="chip">
        <GitBranch size={12} />
        <span className="visually-hidden">Branch </span>
        <code>{document.branch}</code>
      </span>
      {document.upstream_commit && (
        <span className="chip" title={document.upstream_commit}>
          <GitCommitHorizontal size={12} />
          <span className="visually-hidden">Commit </span>
          <code>{document.upstream_commit.slice(0, 7)}</code>
        </span>
      )}
      {syncedAt && (
        <span>
          Synced <time dateTime={document.synced_at}>{syncedAt}</time>
        </span>
      )}
      <span role="status" className="copy-status">
        {clipboard.message}
      </span>
    </p>
  )

  return (
    <>
      <ContentHeader
        repository={repository}
        path={document.path}
        actions={actions}
        meta={meta}
      />
      <div className="document-body">{body}</div>
    </>
  )
}

// The source, line by line, with line numbers beside it. The numbers are a
// column of their own, hidden from screen readers and from a selection, so
// the source copies as it is.
function RawSource({ content, path }: { content: string; path: string }) {
  const lines = content.split('\n')
  // A final newline ends the last line rather than starting another.
  const count = content.endsWith('\n') ? lines.length - 1 : lines.length
  const numbers = Array.from({ length: count }, (_, i) => i + 1).join('\n')

  return (
    <div
      className="document-raw"
      role="region"
      aria-label={`Source of ${path}`}
      // Scrolls sideways, so it takes focus for the keyboard.
      tabIndex={0}
    >
      <pre className="line-numbers" aria-hidden="true">
        {numbers}
      </pre>
      <pre>
        <code>{content}</code>
      </pre>
    </div>
  )
}
