import { http, HttpResponse } from 'msw/http'
import type { Document, DocumentDetail } from '../api/documents.ts'
import { apiUrl } from '../api/client.ts'
import { errorResponse } from './helpers.ts'
import { DocumentPage } from '../pages/DocumentPage.tsx'
import { RepositoryPage } from '../pages/RepositoryPage.tsx'
import { renderRoute } from './renderRoute.tsx'
import { server } from './server.ts'

// Fixtures and helpers for the RepositoryPage and DocumentPage tests.

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

// A document as GET /documents/{id} returns it: trackedDocument() with its
// content.
export function documentDetail(
  overrides: Partial<DocumentDetail> = {},
): DocumentDetail {
  return { ...trackedDocument(overrides), content: '# Docs\n', ...overrides }
}

// A document the mock API holds; without content, GET /documents/{id}
// answers with an empty one.
export type MockDocument = Document & { content?: string }

// The documents the API holds, which a test can change between requests (a
// sync replacing them), with the repo_id of every GET /documents and the ID
// of every GET /documents/{id}.
export interface DocumentsApiState {
  documents: MockDocument[]
  requests: (string | null)[]
  detailRequests: string[]
}

// Both document endpoints, from one list as the API serves both from one
// table: the list without content, filtered by repo_id, and each document
// by ID, or a 404 (as for another user's).
export function mockDocumentsApi(documents: MockDocument[] = []) {
  const state: DocumentsApiState = {
    documents,
    requests: [],
    detailRequests: [],
  }
  server.use(
    http.get(apiUrl('/documents'), ({ request }) => {
      const repoId = new URL(request.url).searchParams.get('repo_id')
      state.requests.push(repoId)
      return HttpResponse.json(
        state.documents
          .filter((d) => String(d.repository_id) === repoId)
          .map((d) => ({ ...d, content: undefined })),
      )
    }),
    http.get(apiUrl('/documents/:id'), ({ params }) => {
      const id = String(params.id)
      state.detailRequests.push(id)
      const found = state.documents.find((d) => String(d.id) === id)
      return found
        ? HttpResponse.json({ content: '', ...found })
        : errorResponse(404, 'not_found', 'Document not found.')
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
