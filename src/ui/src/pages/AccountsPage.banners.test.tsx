import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw/http'
import { describe, expect, test } from 'vitest'
import { apiUrl } from '../api/client.ts'
import {
  account,
  github,
  mockAccountsApi,
  renderAccountsPage,
} from '../test/accounts.tsx'
import { server } from '../test/server.ts'

const page = '/settings/accounts'

describe('AccountsPage banners after a link attempt', () => {
  test('a new link names the account and gives the next steps', async () => {
    mockAccountsApi({ accounts: [account()] })
    renderAccountsPage(`${page}?result=linked&account_id=3`)

    const banner = await screen.findByRole('status')
    expect(banner).toHaveTextContent(
      'Linked @octocat. Next: make sure the GitHub App can see your repositories ↗, then track a repository.',
    )
    expect(
      within(banner).getByRole('link', {
        name: 'make sure the GitHub App can see your repositories',
      }),
    ).toHaveAttribute('href', github.install_url)
    expect(
      within(banner).getByRole('link', { name: 'track a repository' }),
    ).toHaveAttribute('href', '/repositories/track')
  })

  test('the next steps skip the install link without an install URL', async () => {
    mockAccountsApi({
      providers: [{ ...github, install_url: null }],
      accounts: [account()],
    })
    renderAccountsPage(`${page}?result=linked&account_id=3`)

    const banner = await screen.findByRole('status')
    expect(banner).toHaveTextContent(
      'make sure the GitHub App can see your repositories, then',
    )
    expect(within(banner).getAllByRole('link')).toHaveLength(1)
  })

  test.each([
    ['result=relinked&account_id=3', 'Re-linked @octocat.'],
    ['error=access_denied', 'Linking was cancelled on GitHub.'],
    ['error=invalid_state', 'The linking session expired. Try again.'],
    ['error=link_failed', 'GitHub did not complete the sign-in. Try again.'],
    [
      'error=identity_mismatch&account_id=3',
      'You signed in to GitHub with a different account than @octocat, so nothing was changed. Switch accounts in the picker and re-link again.',
    ],
    ['error=account_not_found', 'That account is no longer linked.'],
    ['error=server_error', 'Something went wrong while linking. Try again.'],
    ['error=something_new', 'Something went wrong while linking. Try again.'],
  ])('%s shows "%s"', async (query, message) => {
    mockAccountsApi({ accounts: [account()] })
    renderAccountsPage(`${page}?${query}`)

    const banner = await screen.findByRole(
      query.startsWith('error=') ? 'alert' : 'status',
    )
    expect(banner).toHaveTextContent(message, { normalizeWhitespace: true })
  })

  test.each([
    ['result=linked&account_id=99', 'status', 'Account linked. Next:'],
    ['result=relinked&account_id=99', 'status', 'Account re-linked.'],
    [
      'error=identity_mismatch&account_id=99',
      'alert',
      'a different account than the one you re-linked, so nothing',
    ],
  ] as const)(
    '%s drops the name of an account that is not listed',
    async (query, role, message) => {
      mockAccountsApi({ accounts: [account()] })
      renderAccountsPage(`${page}?${query}`)

      expect(await screen.findByRole(role)).toHaveTextContent(message)
    },
  )

  test('drops the name when the accounts cannot be loaded', async () => {
    mockAccountsApi({})
    server.use(
      http.get(apiUrl('/accounts'), () =>
        HttpResponse.json(
          { error: { code: 'internal', message: 'Something went wrong' } },
          { status: 500 },
        ),
      ),
    )
    renderAccountsPage(`${page}?result=relinked&account_id=3`)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Account re-linked.',
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load your linked accounts',
    )
  })

  test('removes the outcome from the URL, keeping other parameters', async () => {
    mockAccountsApi({ accounts: [account()] })
    const { router } = renderAccountsPage(
      `${page}?result=linked&account_id=3&tab=github`,
    )

    await screen.findByRole('status')
    await waitFor(() =>
      expect(router.state.location.search).toBe('?tab=github'),
    )
    expect(router.state.location.pathname).toBe(page)
    // Replaced, not pushed: back does not return to the outcome.
    expect(router.state.historyAction).toBe('REPLACE')
    // Still shown after the URL changed.
    expect(screen.getByRole('status')).toHaveTextContent('Linked @octocat.')
  })

  test('can be dismissed', async () => {
    mockAccountsApi({ accounts: [account()] })
    const { user } = renderAccountsPage(`${page}?error=access_denied`)

    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('shows nothing without an outcome', async () => {
    mockAccountsApi({ accounts: [account()] })
    const { router } = renderAccountsPage(page)

    await screen.findByText('@octocat')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(router.state.historyAction).toBe('POP')
  })

  test('highlights the row a link changed', async () => {
    mockAccountsApi({
      accounts: [account(), account({ id: 4, provider_login: 'work-bot' })],
    })
    renderAccountsPage(`${page}?result=relinked&account_id=4`)

    const rows = await screen.findAllByRole('listitem')
    expect(rows[0]).not.toHaveClass('highlighted')
    expect(rows[1]).toHaveClass('highlighted')
  })

  test('highlights no row after a failure', async () => {
    mockAccountsApi({ accounts: [account()] })
    renderAccountsPage(`${page}?error=identity_mismatch&account_id=3`)

    const row = await screen.findByRole('listitem')
    expect(row).not.toHaveClass('highlighted')
  })
})
