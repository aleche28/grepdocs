import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw/http'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTestQueryClient } from '../test/queryClient.ts'
import { repository as fixture } from '../test/repositories.tsx'
import { errorResponse } from '../test/helpers.ts'
import { server } from '../test/server.ts'
import { apiUrl } from './client.ts'
import {
  fastPollMs,
  fastPollPeriodMs,
  pollInterval,
  type Repository,
  repositoriesQueryKey,
  slowPollMs,
  type TrackRepositoryRequest,
  useRepositories,
  useSyncRepository,
  useTrackRepository,
  useUntrackRepository,
  useUpdateRepository,
} from './repositories.ts'

function repository(id: number, fullName: string): Repository {
  return fixture({
    id,
    provider_repo_id: String(1000 + id),
    full_name: fullName,
  })
}

describe('useTrackRepository', () => {
  function renderTrack(tracked: Repository[] | null = []) {
    return renderWithList(() => useTrackRepository(), tracked)
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

// Renders a hook with a fresh client whose tracked list starts as `tracked`
// (unless null), to see how the hook changes it.
function renderWithList<T>(hook: () => T, tracked: Repository[] | null) {
  const queryClient = createTestQueryClient()
  if (tracked) {
    queryClient.setQueryData(repositoriesQueryKey, tracked)
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(hook, { wrapper })
  return {
    result,
    tracked: () => queryClient.getQueryData<Repository[]>(repositoriesQueryKey),
    isInvalidated: () =>
      queryClient.getQueryState(repositoriesQueryKey)?.isInvalidated,
  }
}

describe('pollInterval', () => {
  const idle = { sync_status: 'ok' as const }
  const busy = { sync_status: 'running' as const }

  test('does not poll without a list or a busy repository', () => {
    expect(pollInterval(undefined, null, 0)).toEqual({
      interval: false,
      busySince: null,
    })
    expect(pollInterval([idle], 5_000, 9_000)).toEqual({
      interval: false,
      busySince: null,
    })
  })

  test('polls fast from the first busy list', () => {
    expect(pollInterval([idle, busy], null, 9_000)).toEqual({
      interval: fastPollMs,
      busySince: 9_000,
    })
    expect(
      pollInterval([{ sync_status: 'queued' }], 9_000, 9_000 + 1_000),
    ).toEqual({ interval: fastPollMs, busySince: 9_000 })
  })

  test('slows down once the list has been busy for a while', () => {
    expect(pollInterval([busy], 9_000, 9_000 + fastPollPeriodMs)).toEqual({
      interval: slowPollMs,
      busySince: 9_000,
    })
  })
})

describe('useRepositories', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('with poll, refetches while a repository is busy, then stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const answers: Repository[][] = [
      [fixture({ sync_status: 'queued' })],
      [fixture({ sync_status: 'running' })],
      [fixture({ sync_status: 'ok' })],
    ]
    let requests = 0
    server.use(
      http.get(apiUrl('/repositories'), () =>
        HttpResponse.json(answers[Math.min(requests++, answers.length - 1)]),
      ),
    )
    const { result } = renderWithList(
      () => useRepositories({ poll: true }),
      null,
    )

    await waitFor(() =>
      expect(result.current.data?.[0].sync_status).toBe('queued'),
    )
    await vi.advanceTimersByTimeAsync(fastPollMs)
    await waitFor(() =>
      expect(result.current.data?.[0].sync_status).toBe('running'),
    )
    await vi.advanceTimersByTimeAsync(fastPollMs)
    await waitFor(() => expect(result.current.data?.[0].sync_status).toBe('ok'))
    await vi.advanceTimersByTimeAsync(slowPollMs * 2)
    expect(requests).toBe(3)
  })

  test('without poll, does not refetch a busy list', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let requests = 0
    server.use(
      http.get(apiUrl('/repositories'), () => {
        requests++
        return HttpResponse.json([fixture({ sync_status: 'running' })])
      }),
    )
    const { result } = renderWithList(() => useRepositories(), null)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    await vi.advanceTimersByTimeAsync(slowPollMs * 2)
    expect(requests).toBe(1)
  })
})

describe('useSyncRepository', () => {
  const docs = fixture({ id: 12, sync_status: 'ok' })
  const handbook = fixture({ id: 13, full_name: 'acme/handbook' })

  function mockSync(response: () => Response) {
    const paths: string[] = []
    server.use(
      http.post(apiUrl('/repositories/:id/sync'), ({ request }) => {
        paths.push(new URL(request.url).pathname)
        return response()
      }),
    )
    return paths
  }

  test('puts the queued repository in place of its row', async () => {
    const queued = { ...docs, sync_status: 'queued' as const }
    const paths = mockSync(() => HttpResponse.json(queued, { status: 202 }))
    const { result, tracked, isInvalidated } = renderWithList(
      () => useSyncRepository(),
      [docs, handbook],
    )

    result.current.mutate(12)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(paths).toEqual([apiUrl('/repositories/12/sync')])
    expect(tracked()).toEqual([queued, handbook])
    // The response is the new row: no refetch.
    expect(isInvalidated()).toBe(false)
  })

  test.each([
    [409, 'conflict'],
    [404, 'not_found'],
  ])('refetches the list on %i', async (status, code) => {
    mockSync(() => errorResponse(status, code))
    const { result, tracked, isInvalidated } = renderWithList(
      () => useSyncRepository(),
      [docs],
    )

    result.current.mutate(12)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(tracked()).toEqual([docs])
    expect(isInvalidated()).toBe(true)
  })

  test('refetches nothing when the queue is full', async () => {
    mockSync(() => errorResponse(503, 'service_unavailable'))
    const { result, isInvalidated } = renderWithList(
      () => useSyncRepository(),
      [docs],
    )

    result.current.mutate(12)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(isInvalidated()).toBe(false)
  })
})

describe('useUpdateRepository', () => {
  test('sends only the changes and puts the result in place of its row', async () => {
    const docs = fixture({ id: 12, sync_status: 'ok' })
    const updated = {
      ...docs,
      tracked_branch: 'release',
      sync_status: 'pending' as const,
    }
    const bodies: unknown[] = []
    server.use(
      http.patch(apiUrl('/repositories/12'), async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(updated)
      }),
    )
    const { result, tracked, isInvalidated } = renderWithList(
      () => useUpdateRepository(),
      [docs],
    )

    result.current.mutate({ id: 12, changes: { tracked_branch: 'release' } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(bodies).toEqual([{ tracked_branch: 'release' }])
    expect(tracked()).toEqual([updated])
    // The response is the new row: no refetch.
    expect(isInvalidated()).toBe(false)
  })
})

describe('useUntrackRepository', () => {
  const docs = fixture({ id: 12 })
  const handbook = fixture({ id: 13, full_name: 'acme/handbook' })

  test.each([
    ['204', () => new HttpResponse(null, { status: 204 })],
    ['404 (already untracked)', () => errorResponse(404, 'not_found')],
  ])('removes the row on %s', async (_, response) => {
    server.use(http.delete(apiUrl('/repositories/12'), response))
    const { result, tracked, isInvalidated } = renderWithList(
      () => useUntrackRepository(),
      [docs, handbook],
    )

    result.current.mutate(12)

    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(tracked()).toEqual([handbook])
    expect(isInvalidated()).toBe(true)
  })

  test('keeps the row on any other error', async () => {
    server.use(
      http.delete(apiUrl('/repositories/12'), () =>
        errorResponse(500, 'internal'),
      ),
    )
    const { result, tracked } = renderWithList(
      () => useUntrackRepository(),
      [docs],
    )

    result.current.mutate(12)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(tracked()).toEqual([docs])
  })
})
