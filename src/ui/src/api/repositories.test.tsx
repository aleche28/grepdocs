import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw/http'
import type { ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { createTestQueryClient } from '../test/queryClient.ts'
import { server } from '../test/server.ts'
import { apiUrl } from './client.ts'
import {
  type Repository,
  repositoriesQueryKey,
  type TrackRepositoryRequest,
  useTrackRepository,
} from './repositories.ts'

function repository(id: number, fullName: string): Repository {
  return {
    id,
    account_id: 3,
    provider: 'github',
    provider_repo_id: String(1000 + id),
    full_name: fullName,
    default_branch: 'main',
    tracked_branch: 'main',
  }
}

describe('useTrackRepository', () => {
  // Seeds the tracked list (unless told not to), so the test can see how the
  // mutation changes it.
  function renderTrack(tracked: Repository[] | null = []) {
    const queryClient = createTestQueryClient()
    if (tracked) {
      queryClient.setQueryData(repositoriesQueryKey, tracked)
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useTrackRepository(), { wrapper })
    const cached = () =>
      queryClient.getQueryData<Repository[]>(repositoriesQueryKey)
    const isInvalidated = () =>
      queryClient.getQueryState(repositoriesQueryKey)?.isInvalidated
    return { result, tracked: cached, isInvalidated }
  }

  // Answers POST /repositories with `response`, recording each body.
  function mockTrack(response: () => Response) {
    const bodies: unknown[] = []
    server.use(
      http.post(apiUrl('/repositories'), async ({ request }) => {
        bodies.push(await request.json())
        return response()
      }),
    )
    return bodies
  }

  test.each<[string, TrackRepositoryRequest]>([
    [
      'from an account',
      { provider: 'github', owner: 'acme', name: 'docs', account_id: 3 },
    ],
    [
      'public, without an account',
      { provider: 'github', owner: 'acme', name: 'docs' },
    ],
  ])('sends the request as is %s', async (_, request) => {
    const bodies = mockTrack(() =>
      HttpResponse.json(repository(12, 'acme/docs'), { status: 201 }),
    )
    const { result } = renderTrack()

    result.current.mutate(request)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(bodies).toEqual([request])
  })

  test('adds the new repository to the tracked list and refetches it', async () => {
    const existing = repository(5, 'acme/handbook')
    const created = repository(12, 'acme/docs')
    mockTrack(() => HttpResponse.json(created, { status: 201 }))
    const { result, tracked, isInvalidated } = renderTrack([existing])

    result.current.mutate({ provider: 'github', owner: 'acme', name: 'docs' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(created)
    expect(tracked()).toEqual([existing, created])
    expect(isInvalidated()).toBe(true)
  })

  test('does not add a repository the list already has', async () => {
    const created = repository(12, 'acme/docs')
    mockTrack(() => HttpResponse.json(created, { status: 201 }))
    const { result, tracked } = renderTrack([created])

    result.current.mutate({ provider: 'github', owner: 'acme', name: 'docs' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(tracked()).toEqual([created])
  })

  test('does not create a tracked list that was never loaded', async () => {
    mockTrack(() =>
      HttpResponse.json(repository(12, 'acme/docs'), { status: 201 }),
    )
    const { result, tracked } = renderTrack(null)

    result.current.mutate({ provider: 'github', owner: 'acme', name: 'docs' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(tracked()).toBeUndefined()
  })

  test('refetches the tracked list when the repository is already tracked', async () => {
    mockTrack(() =>
      HttpResponse.json(
        { error: { code: 'conflict', message: 'repository already tracked' } },
        { status: 409 },
      ),
    )
    const { result, tracked, isInvalidated } = renderTrack([])

    result.current.mutate({ provider: 'github', owner: 'acme', name: 'docs' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ code: 'conflict' })
    expect(tracked()).toEqual([])
    expect(isInvalidated()).toBe(true)
  })

  test('refetches nothing on any other error', async () => {
    mockTrack(() =>
      HttpResponse.json(
        { error: { code: 'not_found', message: 'Repository not found' } },
        { status: 404 },
      ),
    )
    const { result, isInvalidated } = renderTrack([])

    result.current.mutate({ provider: 'github', owner: 'acme', name: 'docs' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(isInvalidated()).toBe(false)
  })
})
