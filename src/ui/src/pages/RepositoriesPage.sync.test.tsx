import { screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw/http'
import { Link } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { apiUrl } from '../api/client.ts'
import { fastPollMs } from '../api/repositories.ts'
import { errorResponse, findRow, gate } from '../test/helpers.ts'
import { renderRoute } from '../test/renderRoute.tsx'
import {
  mockRepositoriesApi,
  mockSync,
  queue,
  renderRepositoriesPage,
  repository,
  update,
} from '../test/repositories.tsx'
import { RepositoriesPage } from './RepositoriesPage.tsx'

afterEach(() => {
  vi.useRealTimers()
})

describe('RepositoriesPage sync', () => {
  test('follows a sync until it succeeds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = mockRepositoriesApi({ repositories: [repository()] })
    const paths = mockSync(queue(state))
    const { user } = renderRepositoriesPage()

    const row = await findRow('acme/docs')
    await user.click(row.getByRole('button', { name: 'Sync acme/docs' }))

    expect(await row.findByText('Waiting to sync…')).toBeInTheDocument()
    expect(paths).toEqual([apiUrl('/repositories/12/sync')])
    expect(row.getByRole('button', { name: 'Sync acme/docs' })).toBeDisabled()

    update(state, 12, { sync_status: 'running' })
    await vi.advanceTimersByTimeAsync(fastPollMs)
    expect(await row.findByText('Syncing…')).toBeInTheDocument()

    update(state, 12, {
      sync_status: 'ok',
      last_sync_at: '2026-11-25T10:12:00Z',
    })
    await vi.advanceTimersByTimeAsync(fastPollMs)
    expect(await row.findByText(/^Synced /)).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Sync acme/docs' })).toBeEnabled()
  })

  test('shows why a followed sync failed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = mockRepositoriesApi({ repositories: [repository()] })
    mockSync(queue(state))
    const { user } = renderRepositoriesPage()

    const row = await findRow('acme/docs')
    await user.click(row.getByRole('button', { name: 'Sync acme/docs' }))
    await row.findByText('Waiting to sync…')

    update(state, 12, {
      sync_status: 'failed',
      sync_error: 'app_not_installed',
    })
    await vi.advanceTimersByTimeAsync(fastPollMs)

    expect(await row.findByText('Sync failed.')).toBeInTheDocument()
    expect(
      row.getByText("The GitHub App isn't installed on acme/docs.", {
        exact: false,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('1 repository failed its last sync.'),
    ).toBeInTheDocument()
  })

  test('shows a sync already running elsewhere without a message', async () => {
    const state = mockRepositoriesApi({ repositories: [repository()] })
    mockSync(() => {
      update(state, 12, { sync_status: 'running' })
      return errorResponse(409, 'conflict', 'repository is already queued')
    })
    const { user } = renderRepositoriesPage()

    const row = await findRow('acme/docs')
    await user.click(row.getByRole('button', { name: 'Sync acme/docs' }))

    expect(await row.findByText('Syncing…')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('says when the repository is no longer tracked', async () => {
    const state = mockRepositoriesApi({ repositories: [repository()] })
    mockSync(() => {
      state.repositories = []
      return errorResponse(404, 'not_found', 'repository not found')
    })
    const { user } = renderRepositoriesPage()

    const row = await findRow('acme/docs')
    await user.click(row.getByRole('button', { name: 'Sync acme/docs' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'acme/docs is no longer tracked.',
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('link', { name: 'acme/docs' }),
      ).not.toBeInTheDocument(),
    )
  })

  test('asks to wait when the sync queue is full', async () => {
    mockRepositoriesApi({ repositories: [repository()] })
    mockSync(() =>
      errorResponse(503, 'service_unavailable', 'sync service unavailable', {
        headers: { 'Retry-After': '30' },
      }),
    )
    const { user } = renderRepositoriesPage()

    const row = await findRow('acme/docs')
    await user.click(row.getByRole('button', { name: 'Sync acme/docs' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Too many syncs are waiting. Try again in a minute.',
    )
    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(row.getByText('Not synced yet')).toBeInTheDocument()
  })

  test('shows any other failure with its message', async () => {
    mockRepositoriesApi({ repositories: [repository()] })
    mockSync(() => errorResponse(500, 'internal', 'internal server error'))
    const { user } = renderRepositoriesPage()

    const row = await findRow('acme/docs')
    await user.click(row.getByRole('button', { name: 'Sync acme/docs' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not sync acme/docs')
    expect(alert).toHaveTextContent('internal server error')
  })

  test('disables only the button whose request runs', async () => {
    mockRepositoriesApi({
      repositories: [
        repository({ id: 12, full_name: 'acme/docs' }),
        repository({ id: 13, full_name: 'acme/handbook' }),
      ],
    })
    const { released, release } = gate()
    mockSync(async () => {
      await released
      return errorResponse(500, 'internal', 'internal server error')
    })
    const { user } = renderRepositoriesPage()

    const docs = await findRow('acme/docs')
    const handbook = await findRow('acme/handbook')
    await user.click(docs.getByRole('button', { name: 'Sync acme/docs' }))

    const pending = docs.getByRole('button', { name: 'Sync acme/docs' })
    expect(pending).toBeDisabled()
    expect(pending).toHaveTextContent('Starting…')
    expect(
      handbook.getByRole('button', { name: 'Sync acme/handbook' }),
    ).toBeEnabled()
    release()
    await screen.findByRole('alert')
  })
})

describe('RepositoriesPage auto-sync', () => {
  const auto = { auto_sync: true }

  test('syncs the auto-sync repositories that can succeed, once', async () => {
    const state = mockRepositoriesApi({
      repositories: [
        repository({ id: 1, full_name: 'acme/pending', ...auto }),
        repository({ id: 2, full_name: 'acme/ok', ...auto, sync_status: 'ok' }),
        repository({
          id: 3,
          full_name: 'acme/limited',
          ...auto,
          sync_status: 'failed',
          sync_error: 'rate_limited',
        }),
        repository({
          id: 4,
          full_name: 'acme/broken',
          ...auto,
          sync_status: 'failed',
          sync_error: 'internal',
        }),
        repository({
          id: 5,
          full_name: 'acme/revoked',
          ...auto,
          sync_status: 'failed',
          sync_error: 'reauth_required',
        }),
        repository({
          id: 6,
          full_name: 'acme/gone',
          ...auto,
          sync_status: 'failed',
          sync_error: 'resource_not_found',
        }),
        repository({
          id: 7,
          full_name: 'acme/busy',
          ...auto,
          sync_status: 'running',
        }),
        repository({ id: 8, full_name: 'acme/manual', sync_status: 'ok' }),
      ],
    })
    const paths = mockSync(queue(state))
    renderRepositoriesPage()

    const row = await findRow('acme/pending')
    expect(await row.findByText('Waiting to sync…')).toBeInTheDocument()
    await waitFor(() => expect(paths).toHaveLength(4))
    expect(paths.toSorted()).toEqual(
      [1, 2, 3, 4].map((id) => apiUrl(`/repositories/${id}/sync`)),
    )
    expect(state.fetches).toBe(1)
  })

  test('does not sync again when the page opens again', async () => {
    const state = mockRepositoriesApi({
      repositories: [repository({ ...auto, sync_status: 'ok' })],
    })
    const paths = mockSync((id) => {
      // Ends at once, so the next visit finds it idle again.
      update(state, id, { sync_status: 'ok' })
      return HttpResponse.json(state.repositories[0], { status: 202 })
    })
    const { router } = renderRoute({
      path: '/repositories',
      element: (
        <>
          <Link to="/elsewhere">Elsewhere</Link>
          <RepositoriesPage />
        </>
      ),
      routes: [
        { path: '/elsewhere', element: <Link to="/repositories">Back</Link> },
      ],
    })

    await waitFor(() => expect(paths).toHaveLength(1))
    await router.navigate('/elsewhere')
    // Rendered, so the page unmounted.
    await screen.findByRole('link', { name: 'Back' })
    await router.navigate('/repositories')
    // The page mounts on the cached list, idle again, and refetches it; an
    // auto-sync would have been sent on mount, before this refetch ends.
    await waitFor(() => expect(state.fetches).toBe(2))
    await findRow('acme/docs')
    expect(paths).toHaveLength(1)
  })

  test('says how many could not start when the queue is full', async () => {
    const state = mockRepositoriesApi({
      repositories: [
        repository({ id: 1, full_name: 'acme/docs', ...auto }),
        repository({ id: 2, full_name: 'acme/handbook', ...auto }),
        repository({ id: 3, full_name: 'acme/notes', ...auto }),
      ],
    })
    mockSync((id) =>
      id === 1
        ? queue(state)(id)
        : errorResponse(503, 'service_unavailable', 'sync service unavailable'),
    )
    renderRepositoriesPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Automatic sync couldn't start for 2 repositories: too many syncs are waiting. Sync them again in a minute.",
    )
  })

  test('shows nothing for other failures', async () => {
    mockRepositoriesApi({
      repositories: [repository({ ...auto })],
    })
    const paths = mockSync(() =>
      errorResponse(500, 'internal', 'internal server error'),
    )
    renderRepositoriesPage()

    await waitFor(() => expect(paths).toHaveLength(1))
    const row = await findRow('acme/docs')
    expect(row.getByText('Not synced yet')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
