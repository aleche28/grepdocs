import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import {
  documentDetail,
  mockDocumentsApi,
  trackedDocument,
} from '../test/documents.tsx'
import { createTestQueryClient } from '../test/queryClient.ts'
import { documentsQueryKey, useDocument, useDocuments } from './documents.ts'

function renderWithClient<T>(hook: () => T) {
  const queryClient = createTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { ...renderHook(hook, { wrapper }), queryClient }
}

function renderDocuments(repoId: number | undefined) {
  return renderWithClient(() => useDocuments(repoId))
}

describe('useDocuments', () => {
  test("lists one repository's documents", async () => {
    const readme = trackedDocument({ repository_id: 12 })
    const api = mockDocumentsApi([
      readme,
      trackedDocument({ repository_id: 13 }),
    ])

    const { result } = renderDocuments(12)

    await waitFor(() => expect(result.current.data).toEqual([readme]))
    expect(api.requests).toEqual(['12'])
  })

  test('sends nothing without a repository', () => {
    // A request would fail the test (src/test/setup.ts).
    const { result } = renderDocuments(undefined)

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
  })
})

describe('useDocument', () => {
  test('reads one document with its content', async () => {
    const readme = documentDetail()
    const api = mockDocumentsApi([readme])

    const { result } = renderWithClient(() => useDocument(12, readme.id))

    await waitFor(() => expect(result.current.data).toEqual(readme))
    expect(api.detailRequests).toEqual([String(readme.id)])
  })

  test('sends nothing without a document ID', () => {
    const { result } = renderWithClient(() => useDocument(12, null))

    expect(result.current.fetchStatus).toBe('idle')
  })

  test("follows its repository's documents: refetched, then removed", async () => {
    const readme = documentDetail()
    const api = mockDocumentsApi([readme])
    const { result, queryClient } = renderWithClient(() =>
      useDocument(12, readme.id),
    )
    await waitFor(() => expect(result.current.data).toEqual(readme))

    // What useRepositories does after a successful sync.
    api.documents = [{ ...readme, content: '# New' }]
    await queryClient.invalidateQueries({ queryKey: documentsQueryKey(12) })
    await waitFor(() => expect(result.current.data?.content).toBe('# New'))

    // What untracking does.
    queryClient.removeQueries({ queryKey: documentsQueryKey(12) })
    expect(
      queryClient.getQueriesData({ queryKey: documentsQueryKey(12) }),
    ).toEqual([])
  })
})
