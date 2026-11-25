import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw/http'
import { describe, expect, test } from 'vitest'
import { apiUrl } from '../api/client.ts'
import {
  mockRepositoriesApi,
  type RepositoriesApiState,
  renderRepositoriesPage,
  repository,
} from '../test/repositories.tsx'
import { errorResponse, gate } from '../test/helpers.ts'
import { server } from '../test/server.ts'

const docs = repository({ id: 12, full_name: 'acme/docs' })
const handbook = repository({ id: 13, full_name: 'acme/handbook' })

// DELETE /repositories/12 answers with `respond`; a 204 or a 404 removes the
// repository from what GET /repositories returns next, like the API.
function mockDelete(
  state: RepositoriesApiState,
  respond: () => Response | Promise<Response>,
) {
  const calls = { count: 0 }
  server.use(
    http.delete(apiUrl('/repositories/12'), async () => {
      calls.count++
      const response = await respond()
      if (response.status === 204 || response.status === 404) {
        state.repositories = state.repositories.filter((r) => r.id !== 12)
      }
      return response
    }),
  )
  return calls
}

async function openUntrack(
  user: ReturnType<typeof renderRepositoriesPage>['user'],
) {
  await user.click(
    await screen.findByRole('button', { name: 'Untrack acme/docs' }),
  )
  return within(
    await screen.findByRole('dialog', { name: 'Stop tracking acme/docs?' }),
  )
}

describe('RepositoriesPage untrack', () => {
  test('asks first, with Cancel focused', async () => {
    const state = mockRepositoriesApi({ repositories: [docs, handbook] })
    const calls = mockDelete(
      state,
      () => new HttpResponse(null, { status: 204 }),
    )
    const { user } = renderRepositoriesPage()

    const dialog = await openUntrack(user)

    expect(
      dialog.getByText(
        'Its synced documents are removed from GrepDocs. Nothing changes on GitHub.',
      ),
    ).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(calls.count).toBe(0)
    expect(screen.getByRole('link', { name: 'acme/docs' })).toBeInTheDocument()
  })

  test.each([
    ['204', () => new HttpResponse(null, { status: 204 })],
    [
      '404 (untracked elsewhere)',
      () => errorResponse(404, 'not_found', 'repository not found'),
    ],
  ])('removes the row on %s', async (_, respond) => {
    const state = mockRepositoriesApi({ repositories: [docs, handbook] })
    mockDelete(state, respond)
    const { user } = renderRepositoriesPage()

    const dialog = await openUntrack(user)
    await user.click(dialog.getByRole('button', { name: 'Untrack' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('acme/docs is no longer tracked.')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('link', { name: 'acme/docs' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'acme/handbook' }),
    ).toBeInTheDocument()
    // The row that had focus is gone; the message takes it.
    expect(status.parentElement).toHaveFocus()
  })

  test('keeps the dialog open while the request runs', async () => {
    const state = mockRepositoriesApi({ repositories: [docs] })
    const { released, release } = gate()
    mockDelete(state, async () => {
      await released
      return new HttpResponse(null, { status: 204 })
    })
    const { user } = renderRepositoriesPage()

    const dialog = await openUntrack(user)
    await user.click(dialog.getByRole('button', { name: 'Untrack' }))

    expect(dialog.getByRole('button', { name: 'Untracking…' })).toBeDisabled()
    expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    release()
    expect(await screen.findByRole('status')).toHaveTextContent(
      'acme/docs is no longer tracked.',
    )
  })

  test('shows a failure in the dialog and keeps the row', async () => {
    const state = mockRepositoriesApi({ repositories: [docs] })
    mockDelete(state, () =>
      errorResponse(500, 'internal', 'internal server error'),
    )
    const { user } = renderRepositoriesPage()

    const dialog = await openUntrack(user)
    await user.click(dialog.getByRole('button', { name: 'Untrack' }))

    const alert = await dialog.findByRole('alert')
    expect(alert).toHaveTextContent('Could not untrack acme/docs')
    expect(alert).toHaveTextContent('internal server error')
    expect(screen.getByRole('link', { name: 'acme/docs' })).toBeInTheDocument()
  })
})
