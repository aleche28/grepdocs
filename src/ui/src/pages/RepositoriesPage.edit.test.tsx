import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw/http'
import { describe, expect, test } from 'vitest'
import { relinkUrl } from '../api/accounts.ts'
import { apiUrl } from '../api/client.ts'
import type { Branch, Repository } from '../api/repositories.ts'
import { account } from '../test/accounts.tsx'
import {
  mockRepositoriesApi,
  type RepositoriesApiState,
  renderRepositoriesPage,
  repository,
  update,
} from '../test/repositories.tsx'
import { server } from '../test/server.ts'
import { errorResponse } from '../test/track.tsx'

function branch(name: string): Branch {
  return { name, commit: `sha-${name}`, protected: false }
}

// GET /repositories/12/branches answers with `respond` (a list, or a
// response), counting the requests.
function mockBranches(
  respond: Branch[] | (() => Response | Promise<Response>),
) {
  const calls = { count: 0 }
  server.use(
    http.get(apiUrl('/repositories/12/branches'), () => {
      calls.count++
      return typeof respond === 'function'
        ? respond()
        : HttpResponse.json(respond)
    }),
  )
  return calls
}

// PATCH /repositories/12 applies the body to `state` and returns the result,
// like the API; or answers with `respond` when given.
function mockPatch(state: RepositoriesApiState, respond?: () => Response) {
  const bodies: Partial<Repository>[] = []
  server.use(
    http.patch(apiUrl('/repositories/12'), async ({ request }) => {
      const body = (await request.json()) as Partial<Repository>
      bodies.push(body)
      if (respond) {
        return respond()
      }
      const reset = body.tracked_branch
        ? { sync_status: 'pending' as const, last_sync_at: null }
        : {}
      return HttpResponse.json(update(state, 12, { ...body, ...reset }))
    }),
  )
  return bodies
}

function mockSync(state: RepositoriesApiState) {
  const paths: string[] = []
  server.use(
    http.post(apiUrl('/repositories/:id/sync'), ({ request, params }) => {
      paths.push(new URL(request.url).pathname)
      return HttpResponse.json(
        update(state, Number(params.id), { sync_status: 'queued' }),
        { status: 202 },
      )
    }),
  )
  return paths
}

async function openEdit(
  user: ReturnType<typeof renderRepositoriesPage>['user'],
) {
  await user.click(
    await screen.findByRole('button', { name: 'Edit acme/docs' }),
  )
  return within(await screen.findByRole('dialog', { name: 'Edit acme/docs' }))
}

describe('RepositoriesPage edit', () => {
  test('lists the branches, the tracked one first', async () => {
    mockRepositoriesApi({
      repositories: [repository({ tracked_branch: 'trunk' })],
    })
    const calls = mockBranches([branch('main'), branch('trunk'), branch('dev')])
    const { user } = renderRepositoriesPage()

    await screen.findByRole('button', { name: 'Edit acme/docs' })
    // Requested only once the dialog opens.
    expect(calls.count).toBe(0)
    const dialog = await openEdit(user)

    const select = dialog.getByRole('combobox', { name: 'Tracked branch' })
    expect(select).toHaveFocus()
    await waitFor(() =>
      expect(
        within(select)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['trunk', 'main', 'dev']),
    )
    expect(select).toHaveValue('trunk')
    expect(
      dialog.getByRole('checkbox', { name: 'Sync when I open GrepDocs' }),
    ).not.toBeChecked()
  })

  test('shows the tracked branch while the branches load', async () => {
    mockRepositoriesApi({ repositories: [repository()] })
    mockBranches(() => new Promise<Response>(() => {}))
    const { user } = renderRepositoriesPage()

    const dialog = await openEdit(user)

    expect(dialog.getByText('Loading branches…')).toBeInTheDocument()
    expect(
      within(dialog.getByRole('combobox')).getAllByRole('option'),
    ).toHaveLength(1)
  })

  test('marks a tracked branch the provider no longer has', async () => {
    mockRepositoriesApi({ repositories: [repository()] })
    mockBranches([branch('trunk')])
    const { user } = renderRepositoriesPage()

    const dialog = await openEdit(user)

    expect(
      await dialog.findByRole('option', { name: 'main (not found on GitHub)' }),
    ).toBeInTheDocument()
  })

  test('changes the branch, then syncs it', async () => {
    const state = mockRepositoriesApi({
      repositories: [repository({ sync_status: 'ok' })],
    })
    mockBranches([branch('main'), branch('release')])
    const bodies = mockPatch(state)
    const syncs = mockSync(state)
    const { user } = renderRepositoriesPage()

    const dialog = await openEdit(user)
    await dialog.findByRole('option', { name: 'release' })
    await user.selectOptions(dialog.getByRole('combobox'), 'release')
    expect(
      dialog.getByText(
        'Saving starts a sync of release. Until it ends, the documents still come from main.',
      ),
    ).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'acme/docs now tracks release.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(bodies).toEqual([{ tracked_branch: 'release' }])
    await waitFor(() =>
      expect(syncs).toEqual([apiUrl('/repositories/12/sync')]),
    )
    expect(await screen.findByText('Waiting to sync…')).toBeInTheDocument()
    // Focus returns to the button that opened the dialog.
    expect(screen.getByRole('button', { name: 'Edit acme/docs' })).toHaveFocus()
  })

  test('turns auto-sync on without a sync', async () => {
    const state = mockRepositoriesApi({
      repositories: [repository({ sync_status: 'ok' })],
    })
    mockBranches([branch('main')])
    const bodies = mockPatch(state)
    const { user } = renderRepositoriesPage()

    const dialog = await openEdit(user)
    await user.click(
      dialog.getByRole('checkbox', { name: 'Sync when I open GrepDocs' }),
    )
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Saved acme/docs.',
    )
    expect(bodies).toEqual([{ auto_sync: true }])
    expect(screen.getByText('Auto-sync')).toBeInTheDocument()
  })

  test('closes without a request when nothing changed', async () => {
    const state = mockRepositoriesApi({ repositories: [repository()] })
    mockBranches([branch('main')])
    const bodies = mockPatch(state)
    const { user } = renderRepositoriesPage()

    const dialog = await openEdit(user)
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(bodies).toEqual([])
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('closes on Cancel and on Esc', async () => {
    mockRepositoriesApi({ repositories: [repository()] })
    mockBranches([branch('main')])
    const { user } = renderRepositoriesPage()

    const dialog = await openEdit(user)
    await user.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )

    await openEdit(user)
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
  })

  test('says when the branch went away, and reloads the branches', async () => {
    const state = mockRepositoriesApi({ repositories: [repository()] })
    const calls = mockBranches([branch('main'), branch('release')])
    mockPatch(state, () =>
      errorResponse(400, 'bad_request', 'tracked_branch not found'),
    )
    const { user } = renderRepositoriesPage()

    const dialog = await openEdit(user)
    await dialog.findByRole('option', { name: 'release' })
    await user.selectOptions(dialog.getByRole('combobox'), 'release')
    await user.click(dialog.getByRole('button', { name: 'Save' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent(
      'Could not save acme/docsThe branch release no longer exists on GitHub.',
    )
    await waitFor(() => expect(calls.count).toBe(2))
  })

  test('opens from the Change branch action of a missing branch', async () => {
    mockRepositoriesApi({
      repositories: [
        repository({ sync_status: 'failed', sync_error: 'resource_not_found' }),
      ],
    })
    mockBranches([branch('trunk')])
    const { user } = renderRepositoriesPage()

    await user.click(
      await screen.findByRole('button', { name: 'Change branch' }),
    )

    expect(
      await screen.findByRole('dialog', { name: 'Edit acme/docs' }),
    ).toBeInTheDocument()
  })
})

describe('RepositoriesPage edit failures', () => {
  test.each<[string, () => Response, string]>([
    [
      '403 without an account',
      () => errorResponse(403, 'forbidden', 're-link'),
      'Link a GitHub account to read this repository.',
    ],
    [
      '409',
      () => errorResponse(409, 'conflict', 'Multiple github accounts found'),
      "This private repository's account was unlinked, and you have several GitHub accounts. Untrack it and track it again from the account to use.",
    ],
    [
      '404',
      () => errorResponse(404, 'not_found', 'Repository not found'),
      "GitHub can't find acme/docs any more.",
    ],
    [
      '429',
      () =>
        errorResponse(429, 'rate_limited', 'rate limited', {
          headers: { 'Retry-After': '120' },
        }),
      "GitHub's rate limit was reached. Try again in 2 minutes.",
    ],
    [
      'any other failure',
      () => errorResponse(500, 'internal', 'internal server error'),
      'internal server error',
    ],
  ])('explains a branch list failing with %s', async (_, respond, text) => {
    mockRepositoriesApi({
      repositories: [repository({ account_id: null })],
      accounts: [],
    })
    mockBranches(respond)
    const { user } = renderRepositoriesPage()

    const dialog = await openEdit(user)

    const alert = await dialog.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the branches')
    expect(alert).toHaveTextContent(text)
    expect(
      within(alert).getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument()
    // The rest of the dialog still works.
    expect(dialog.getByRole('combobox')).toHaveValue('main')
    expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  test('offers to re-link the account on a 403', async () => {
    mockRepositoriesApi({
      repositories: [repository()],
      accounts: [account()],
    })
    mockBranches(() => errorResponse(403, 'forbidden', 're-link'))
    const { user } = renderRepositoriesPage()

    const dialog = await openEdit(user)

    const alert = await dialog.findByRole('alert')
    expect(alert).toHaveTextContent(
      'GitHub no longer accepts the access of @octocat.',
    )
    expect(
      within(alert).getByRole('link', { name: 'Re-link @octocat' }),
    ).toHaveAttribute('href', relinkUrl('github', 3))
  })

  test('links to the app installation on a 404 that carries it', async () => {
    const installUrl = 'https://github.com/apps/grepdocs/installations/new'
    mockRepositoriesApi({ repositories: [repository()] })
    mockBranches(() =>
      errorResponse(404, 'not_found', 'Repository not found', {
        details: { install_url: installUrl },
      }),
    )
    const { user } = renderRepositoriesPage()

    const dialog = await openEdit(user)

    const alert = await dialog.findByRole('alert')
    expect(alert).toHaveTextContent(
      "GitHub can't find acme/docs, or the GitHub App isn't installed on it.",
    )
    expect(
      within(alert).getByRole('link', {
        name: "Manage the GitHub App's repository access",
      }),
    ).toHaveAttribute('href', installUrl)
  })

  test('retries the branch list', async () => {
    mockRepositoriesApi({ repositories: [repository()] })
    let fail = true
    mockBranches(() =>
      fail
        ? errorResponse(500, 'internal', 'internal server error')
        : HttpResponse.json([branch('main'), branch('release')]),
    )
    const { user } = renderRepositoriesPage()

    const dialog = await openEdit(user)
    const alert = await dialog.findByRole('alert')
    fail = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(
      await dialog.findByRole('option', { name: 'release' }),
    ).toBeInTheDocument()
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument()
  })
})
