import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { mockDocumentsApi, trackedDocument } from '../test/documents.tsx'
import { createTestQueryClient } from '../test/queryClient.ts'
import { useDocuments } from './documents.ts'

function renderDocuments(repoId: number | undefined) {
  const queryClient = createTestQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return renderHook(() => useDocuments(repoId), { wrapper })
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
