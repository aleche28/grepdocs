import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw/http'
import { describe, expect, test } from 'vitest'
import type { ExternalAccount } from '../api/accounts.ts'
import { apiUrl } from '../api/client.ts'
import type { Repository } from '../api/repositories.ts'
import { account, github, renderAccountsPage } from '../test/accounts.tsx'
import { server } from '../test/server.ts'

function repository(id: number, accountId: number | null): Repository {
  return {
    id,
    account_id: accountId,
    provider: 'github',
    full_name: `octocat/repo-${id}`,
  }
}

// A response the test releases when it is ready, to look at the page while
// the request is still in flight.
function gate() {
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  return { released, release }
}

interface ApiState {
  accounts: ExternalAccount[]
  repositories: Repository[]
  // Requests per endpoint, to see what the page refetched.
  requests: string[]
}

// The API as a small stateful fake: DELETE removes the account, so the
// refetch that follows no longer lists it.
function mockApi(
  accounts: ExternalAccount[],
  repositories: Repository[] = [],
): ApiState {
  const state: ApiState = { accounts, repositories, requests: [] }
  server.use(
    http.get(apiUrl('/providers'), () => HttpResponse.json([github])),
    http.get(apiUrl('/accounts'), () => {
      state.requests.push('GET /accounts')
      return HttpResponse.json(state.accounts)
    }),
    http.get(apiUrl('/repositories'), () => {
      state.requests.push('GET /repositories')
      return HttpResponse.json(state.repositories)
    }),
    http.delete(apiUrl('/accounts/:id'), ({ params }) => {
      state.requests.push(`DELETE /accounts/${String(params.id)}`)
      state.accounts = state.accounts.filter((a) => String(a.id) !== params.id)
      return HttpResponse.json({
        message: 'External account unlinked successfully',
      })
    }),
  )
  return state
}

function failWith(method: 'get' | 'delete', path: string, status: number) {
  server.use(
    http[method](apiUrl(path), () =>
      HttpResponse.json(
        {
          error: {
            code: status === 404 ? 'not_found' : 'internal',
            message: status === 404 ? 'Account not found' : 'Server error',
          },
        },
        { status },
      ),
    ),
  )
}

async function openDialog(name = '@octocat') {
  const rendered = renderAccountsPage()
  const trigger = await screen.findByRole('button', { name: `Unlink ${name}` })
  await rendered.user.click(trigger)
  const dialog = await screen.findByRole('dialog', { name: `Unlink ${name}?` })
  return { ...rendered, trigger, dialog: within(dialog), dialogElement: dialog }
}

describe('AccountsPage unlink', () => {
  test('asks for confirmation, with focus on Cancel', async () => {
    mockApi([account()])
    const { dialog } = await openDialog()

    expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(dialog.getByRole('button', { name: 'Unlink' })).toBeEnabled()
  })

  test('fetches the repositories only once the dialog opens', async () => {
    const state = mockApi([account()])
    renderAccountsPage()

    await screen.findByText('@octocat')
    expect(state.requests).not.toContain('GET /repositories')
  })

  test.each([
    [[], 'No tracked repositories use this account.'],
    [
      [repository(1, 3), repository(2, 4), repository(3, null)],
      '1 tracked repository uses this account. It stays in GrepDocs but cannot sync until you link an account that can access it.',
    ],
    [
      [repository(1, 3), repository(2, 3), repository(3, 4)],
      '2 tracked repositories use this account. They stay in GrepDocs but cannot sync until you link an account that can access them.',
    ],
  ])('counts the tracked repositories it affects (%#)', async (repos, line) => {
    mockApi([account(), account({ id: 4, provider_login: 'work-bot' })], repos)
    const { dialog } = await openDialog()

    expect(await dialog.findByText(line)).toBeInTheDocument()
  })

  test('can unlink while the count is loading', async () => {
    mockApi([account()])
    const { released, release } = gate()
    server.use(
      http.get(apiUrl('/repositories'), async () => {
        await released
        return HttpResponse.json([])
      }),
    )
    const { dialog } = await openDialog()

    expect(
      dialog.getByText('Checking tracked repositories…'),
    ).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Unlink' })).toBeEnabled()
    release()
  })

  test('leaves out the count when it fails, still allowing the unlink', async () => {
    mockApi([account()])
    failWith('get', '/repositories', 500)
    const { dialog } = await openDialog()

    await waitFor(() =>
      expect(
        dialog.queryByText('Checking tracked repositories…'),
      ).not.toBeInTheDocument(),
    )
    expect(dialog.queryByText(/tracked repositor/)).not.toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Unlink' })).toBeEnabled()
  })

  test('unlinks, refetches both lists and confirms', async () => {
    const state = mockApi([account()], [repository(1, 3)])
    const { dialog, user } = await openDialog()
    await dialog.findByText(/1 tracked repository/)
    state.requests = []

    await user.click(dialog.getByRole('button', { name: 'Unlink' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Unlinked @octocat.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('@octocat')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'No GitHub account linked yet. Link one to track your repositories.',
      ),
    ).toBeInTheDocument()
    expect(state.requests).toEqual(
      expect.arrayContaining([
        'DELETE /accounts/3',
        'GET /accounts',
        // The repository moved to account_id null.
        'GET /repositories',
      ]),
    )
    // The refetch comes after the delete.
    expect(state.requests[0]).toBe('DELETE /accounts/3')
  })

  test('disables both actions while the unlink runs', async () => {
    mockApi([account()])
    const { released, release } = gate()
    server.use(
      http.delete(apiUrl('/accounts/3'), async () => {
        await released
        return HttpResponse.json({ message: 'ok' })
      }),
    )
    const { dialog, user } = await openDialog()

    await user.click(dialog.getByRole('button', { name: 'Unlink' }))

    expect(
      await dialog.findByRole('button', { name: 'Unlinking…' }),
    ).toBeDisabled()
    expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    release()
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Unlinked @octocat.',
    )
  })

  test('closes and refetches when the account is already gone', async () => {
    const state = mockApi([account()])
    const { dialog, user } = await openDialog()
    // Another tab unlinked it.
    state.accounts = []
    failWith('delete', '/accounts/3', 404)

    await user.click(dialog.getByRole('button', { name: 'Unlink' }))

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(
      await screen.findByText(/No GitHub account linked yet/),
    ).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('shows any other failure inside the dialog', async () => {
    mockApi([account()])
    failWith('delete', '/accounts/3', 500)
    const { dialog, user } = await openDialog()

    await user.click(dialog.getByRole('button', { name: 'Unlink' }))

    const alert = await dialog.findByRole('alert')
    expect(alert).toHaveTextContent('Could not unlink the account')
    expect(alert).toHaveTextContent('Server error')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Unlink' })).toBeEnabled()
  })

  test('Cancel closes without unlinking and returns focus', async () => {
    const state = mockApi([account()])
    const { dialog, trigger, user } = await openDialog()

    await user.click(dialog.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(screen.getByText('@octocat')).toBeInTheDocument()
    expect(state.requests).not.toContain('DELETE /accounts/3')
  })

  test('Esc closes without unlinking and returns focus', async () => {
    const state = mockApi([account()])
    const { trigger, user } = await openDialog()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(state.requests).not.toContain('DELETE /accounts/3')
  })

  test('unlinks an account of a provider the API no longer lists', async () => {
    const state = mockApi([
      account({ id: 7, provider: 'gitlab', provider_login: 'old-me' }),
    ])
    const { dialog, user } = await openDialog('@old-me')

    await user.click(dialog.getByRole('button', { name: 'Unlink' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Unlinked @old-me.',
    )
    expect(state.requests).toContain('DELETE /accounts/7')
  })
})

describe('AccountsPage unlink dialog closed by the browser', () => {
  test('clears the dialog, so it opens again', async () => {
    mockApi([account()])
    const { dialogElement, trigger, user } = await openDialog()

    // What Chrome does on a second Esc, even when the page cancelled it.
    ;(dialogElement as HTMLDialogElement).close()

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    await user.click(trigger)
    expect(
      await screen.findByRole('dialog', { name: 'Unlink @octocat?' }),
    ).toBeVisible()
  })
})

describe('AccountsPage unlink, review regressions', () => {
  test('reopens a dialog the browser closes while the unlink runs', async () => {
    mockApi([account()])
    const { released, release } = gate()
    server.use(
      http.delete(apiUrl('/accounts/3'), async () => {
        await released
        return HttpResponse.json({ message: 'ok' })
      }),
    )
    const { dialog, dialogElement, user } = await openDialog()
    await user.click(dialog.getByRole('button', { name: 'Unlink' }))
    await dialog.findByRole('button', { name: 'Unlinking…' })

    ;(dialogElement as HTMLDialogElement).close()
    // Let the queued close event run.
    await new Promise((resolve) => setTimeout(resolve))

    expect(dialogElement).toBeVisible()
    release()
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Unlinked @octocat.',
    )
  })

  test('confirms without waiting for the lists to refetch', async () => {
    mockApi([account()])
    const { dialog, user } = await openDialog()
    const { released, release } = gate()
    server.use(
      http.get(apiUrl('/accounts'), async () => {
        await released
        return HttpResponse.json([])
      }),
    )

    await user.click(dialog.getByRole('button', { name: 'Unlink' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Unlinked @octocat.',
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('@octocat')).not.toBeInTheDocument()
    release()
  })

  test('moves focus to the heading once the unlinked row is gone', async () => {
    mockApi([account()])
    const { dialog, user } = await openDialog()

    await user.click(dialog.getByRole('button', { name: 'Unlink' }))

    await screen.findByRole('status')
    expect(
      screen.getByRole('heading', { level: 1, name: 'Linked accounts' }),
    ).toHaveFocus()
  })
})
