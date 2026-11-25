import { http, HttpResponse } from 'msw/http'
import type { Document } from '../api/documents.ts'
import { apiUrl } from '../api/client.ts'
import { DocumentPage } from '../pages/DocumentPage.tsx'
import { RepositoryPage } from '../pages/RepositoryPage.tsx'
import { renderRoute } from './renderRoute.tsx'
import { server } from './server.ts'

// Fixtures and helpers for the RepositoryPage tests.

let nextId = 100

// A document as GET /documents returns it: README.md of acme/docs (id 12)
// on main, unless overridden. Each call gets a new id.
export function trackedDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: nextId++,
    sha: '3b18e512dba79e4c8300dd08aeb37f8e728b8dad',
    path: 'README.md',
    synced_at: '2026-11-25T10:12:00Z',
    repository_id: 12,
    repository: 'acme/docs',
    provider: 'github',
    branch: 'main',
    upstream_commit: 'abcd123',
    ...overrides,
  }
}

// The documents the API holds, which a test can change between requests (a
// sync replacing them), and the repo_id of every request.
export interface DocumentsApiState {
  documents: Document[]
  requests: (string | null)[]
}

export function mockDocumentsApi(documents: Document[] = []) {
  const state: DocumentsApiState = { documents, requests: [] }
  server.use(
    http.get(apiUrl('/documents'), ({ request }) => {
      const repoId = new URL(request.url).searchParams.get('repo_id')
      state.requests.push(repoId)
      return HttpResponse.json(
        state.documents.filter((d) => String(d.repository_id) === repoId),
      )
    }),
  )
  return state
}

// The repository page at `url`, with the document route nested as in
// router.tsx.
export function renderRepositoryPage(url: string) {
  return renderRoute({
    path: '/repositories/:repoId',
    element: <RepositoryPage />,
    children: [{ path: 'documents/:documentId', element: <DocumentPage /> }],
    url,
  })
}
