import { screen, within } from '@testing-library/react'
import { http } from 'msw/http'
import { describe, expect, test } from 'vitest'
import { relinkUrl } from '../api/accounts.ts'
import { apiUrl } from '../api/client.ts'
import { account, github } from '../test/accounts.tsx'
import {
  discovered,
  mockTrackApi,
  renderTrackPage,
  trackedFrom,
} from '../test/track.tsx'
import { errorResponse } from '../test/helpers.ts'
import { server } from '../test/server.ts'

const docs = discovered('acme/docs')
const handbook = discovered('acme/handbook', {
  is_private: true,
  default_branch: 'trunk',
})
const work = account({
  id: 4,
  provider_user_id: '999',
  provider_login: 'work-bot',
})

async function findRows() {
  const list = await screen.findByRole('list')
  return within(list).getAllByRole('listitem')
}

describe('TrackRepositoryPage accounts', () => {
  test('selects the only account and lists its repositories', async () => {
    const requests = mockTrackApi({
      accounts: [account()],
      repositories: { 3: [docs, handbook] },
    })
    renderTrackPage()

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    const rows = await findRows()
    expect(screen.getByText('@octocat')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('acme/docsPublicmain')
    expect(rows[1]).toHaveTextContent('acme/handbookPrivatetrunk')
    expect(
      within(rows[0]).getByRole('link', { name: 'acme/docs' }),
    ).toHaveAttribute('href', 'https://github.com/acme/docs')
    expect(requests).toContain(
      'GET /api/accounts/github/repositories?account_id=3',
    )
  })

  test('requests nothing until one of several accounts is picked', async () => {
    const requests = mockTrackApi({
      accounts: [account(), work],
      repositories: { 4: [docs] },
    })
    const { router, user } = renderTrackPage()

    const picker = await screen.findByRole('combobox', { name: 'Account' })
    expect(picker).toHaveValue('')
    expect(requests.filter((r) => r.includes('/accounts/'))).toEqual([])

    await user.selectOptions(picker, '@work-bot')

    expect(await findRows()).toHaveLength(1)
    expect(router.state.location.search).toBe('?account_id=4')
    expect(requests).toContain(
      'GET /api/accounts/github/repositories?account_id=4',
    )
  })

  test('keeps the account named in the URL', async () => {
    mockTrackApi({
      accounts: [account(), work],
      repositories: { 4: [docs] },
    })
    renderTrackPage('/repositories/track?account_id=4')

    expect(await findRows()).toHaveLength(1)
    expect(screen.getByRole('combobox', { name: 'Account' })).toHaveValue('4')
  })

  test('ignores an account_id that names no linked account', async () => {
    const requests = mockTrackApi({ accounts: [account(), work] })
    renderTrackPage('/repositories/track?account_id=99')

    expect(
      await screen.findByRole('combobox', { name: 'Account' }),
    ).toHaveValue('')
    expect(requests.filter((r) => r.includes('/accounts/'))).toEqual([])
  })

  test('still selects the only account after an unknown account_id', async () => {
    mockTrackApi({ accounts: [account()], repositories: { 3: [docs] } })
    renderTrackPage('/repositories/track?account_id=99')

    expect(await findRows()).toHaveLength(1)
  })

  test('names the provider when there are several', async () => {
    mockTrackApi({
      providers: [
        github,
        { name: 'bitbucket', display_name: 'Bitbucket', install_url: null },
      ],
      accounts: [account(), work],
    })
    renderTrackPage()

    const picker = await screen.findByRole('combobox', { name: 'Account' })
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choose an account', '@octocat (GitHub)', '@work-bot (GitHub)'])
  })

  test('leaves out accounts of a provider the API no longer lists', async () => {
    mockTrackApi({
      accounts: [account({ provider: 'gitlab' }), work],
      repositories: { 4: [docs] },
    })
    renderTrackPage()

    expect(await findRows()).toHaveLength(1)
    expect(screen.getByText('@work-bot')).toBeInTheDocument()
  })

  test('sends a user without accounts to the accounts page', async () => {
    mockTrackApi({ accounts: [] })
    renderTrackPage()

    expect(
      await screen.findByText(
        /Link a GitHub account to track its repositories/,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Go to linked accounts' }),
    ).toHaveAttribute('href', '/settings/accounts')
  })

  test('offers a re-link instead of listing an expired account', async () => {
    const requests = mockTrackApi({
      accounts: [account({ needs_relink: true })],
    })
    renderTrackPage()

    expect(
      await screen.findByRole('link', { name: 'Re-link @octocat' }),
    ).toHaveAttribute('href', relinkUrl('github', 3))
    expect(
      screen.getByText('The access of @octocat expired.'),
    ).toBeInTheDocument()
    expect(requests.filter((r) => r.includes('/accounts/'))).toEqual([])
  })

  test('shows a failed account list with a retry', async () => {
    mockTrackApi({})
    server.use(
      http.get(apiUrl('/accounts'), () =>
        errorResponse(500, 'internal', 'Something went wrong'),
      ),
    )
    renderTrackPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load your linked accounts')
    expect(
      within(alert).getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument()
  })
})

describe('TrackRepositoryPage list', () => {
  test('marks the repositories already tracked', async () => {
    mockTrackApi({
      accounts: [account()],
      tracked: [trackedFrom(handbook)],
      repositories: { 3: [docs, handbook] },
    })
    renderTrackPage()

    const rows = await findRows()
    expect(await within(rows[1]).findByText('Tracked')).toBeInTheDocument()
    expect(within(rows[1]).queryByRole('button')).not.toBeInTheDocument()
    expect(
      within(rows[0]).getByRole('button', { name: 'Track acme/docs' }),
    ).toBeEnabled()
  })

  test('filters as the user types, without a request', async () => {
    const requests = mockTrackApi({
      accounts: [account()],
      repositories: { 3: [docs, handbook] },
    })
    const { user } = renderTrackPage()
    await findRows()
    const before = requests.length

    const filter = screen.getByRole('searchbox', {
      name: 'Filter repositories',
    })
    await user.type(filter, 'HAND')
    const rows = await findRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('acme/handbook')

    await user.clear(filter)
    await user.type(filter, 'nothing')
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(
      screen.getByText('No repositories match “nothing”.'),
    ).toBeInTheDocument()
    expect(requests).toHaveLength(before)
  })

  test('points to the app installation under the list', async () => {
    mockTrackApi({ accounts: [account()], repositories: { 3: [docs] } })
    renderTrackPage()
    await findRows()

    expect(screen.getByText(/Don't see a repository\?/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: "Manage the GitHub App's repository access",
      }),
    ).toHaveAttribute('href', github.install_url)
  })

  test('hides the installation link when the provider has none', async () => {
    mockTrackApi({
      providers: [{ ...github, install_url: null }],
      accounts: [account()],
      repositories: { 3: [docs] },
    })
    renderTrackPage()
    await findRows()

    expect(
      screen.queryByText(/Don't see a repository\?/),
    ).not.toBeInTheDocument()
  })

  test('explains an empty list', async () => {
    mockTrackApi({ accounts: [account()], repositories: { 3: [] } })
    renderTrackPage()

    expect(
      await screen.findByText(
        "The GitHub App can't see any repository of @octocat yet.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(
      screen.getByRole('link', {
        name: "Manage the GitHub App's repository access",
      }),
    ).toBeInTheDocument()
  })
})

describe('TrackRepositoryPage list failures', () => {
  function renderWithListError(response: () => Response) {
    const requests = mockTrackApi({
      accounts: [account()],
      repositories: { 3: response },
    })
    return { requests, ...renderTrackPage() }
  }

  test('app_not_installed links to the installation', async () => {
    renderWithListError(() =>
      errorResponse(403, 'app_not_installed', 'The app is not installed', {
        details: { install_url: 'https://github.com/apps/x/installations/new' },
      }),
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Install the GitHub App to choose which repositories GrepDocs can see.',
    )
    expect(
      within(alert).getByRole('link', { name: 'Install the GitHub App' }),
    ).toHaveAttribute('href', 'https://github.com/apps/x/installations/new')
  })

  test('app_not_installed without an install_url shows no link', async () => {
    renderWithListError(() =>
      errorResponse(403, 'app_not_installed', 'The app is not installed'),
    )

    const alert = await screen.findByRole('alert')
    expect(within(alert).queryByRole('link')).not.toBeInTheDocument()
  })

  test('forbidden offers a re-link of the account', async () => {
    renderWithListError(() =>
      errorResponse(403, 'forbidden', 'Invalid or expired token'),
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'GitHub no longer accepts the access of @octocat.',
    )
    expect(
      within(alert).getByRole('link', { name: 'Re-link @octocat' }),
    ).toHaveAttribute('href', relinkUrl('github', 3))
  })

  test('rate_limited says how long to wait, and retries', async () => {
    let calls = 0
    const { user } = renderWithListError(() => {
      calls++
      return calls === 1
        ? errorResponse(429, 'rate_limited', 'Rate limit exceeded', {
            headers: { 'Retry-After': '150' },
          })
        : Response.json([docs])
    })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      "GitHub's rate limit was reached. Try again in 3 minutes.",
    )
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await findRows()).toHaveLength(1)
  })

  test('any other error shows its message with a retry', async () => {
    renderWithListError(() =>
      errorResponse(500, 'internal', 'Something went wrong'),
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Could not list the repositories of @octocat',
    )
    expect(alert).toHaveTextContent('Something went wrong')
    expect(
      within(alert).getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument()
  })
})
