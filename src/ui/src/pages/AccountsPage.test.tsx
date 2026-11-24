import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw/http'
import { describe, expect, test } from 'vitest'
import type { ExternalAccount, Provider } from '../api/accounts.ts'
import { apiUrl } from '../api/client.ts'
import { renderRoute } from '../test/renderRoute.tsx'
import { server } from '../test/server.ts'
import { AccountsPage } from './AccountsPage.tsx'

const github: Provider = {
  name: 'github',
  display_name: 'GitHub',
  install_url: 'https://github.com/apps/grepdocs/installations/new',
}

function account(overrides: Partial<ExternalAccount> = {}): ExternalAccount {
  return {
    id: 3,
    provider: 'github',
    provider_user_id: '123456',
    provider_login: 'octocat',
    label: '',
    linked_at: '2026-03-02T10:11:12Z',
    last_refreshed_at: null,
    token_expires_at: '2026-03-02T18:11:12Z',
    refresh_token_expires_at: '2026-09-02T10:11:12Z',
    needs_relink: false,
    ...overrides,
  }
}

function mockApi({
  providers = [github],
  accounts = [],
}: {
  providers?: Provider[]
  accounts?: ExternalAccount[]
}) {
  server.use(
    http.get(apiUrl('/providers'), () => HttpResponse.json(providers)),
    http.get(apiUrl('/accounts'), () => HttpResponse.json(accounts)),
  )
}

function renderPage(url = '/settings/accounts') {
  return renderRoute({
    path: '/settings/accounts',
    element: <AccountsPage />,
    url,
  })
}

// The section of one provider, found by its heading.
async function findSection(name: string) {
  return within(await screen.findByRole('region', { name }))
}

describe('AccountsPage list', () => {
  test('shows loading until both lists arrive', async () => {
    mockApi({ accounts: [account()] })
    renderPage()

    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(await screen.findByText('@octocat')).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  test('lists each account by login with its link date', async () => {
    mockApi({
      accounts: [
        account(),
        account({ id: 4, provider_user_id: '999', provider_login: 'work-bot' }),
      ],
    })
    renderPage()

    const section = await findSection('GitHub')
    const rows = section.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('@octocat')
    expect(rows[1]).toHaveTextContent('@work-bot')

    const linkedOn = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
    }).format(new Date('2026-03-02T10:11:12Z'))
    expect(rows[0]).toHaveTextContent(`Linked ${linkedOn}`)
  })

  test('names an account without a login by its provider ID', async () => {
    mockApi({ accounts: [account({ provider_login: null })] })
    renderPage()

    const section = await findSection('GitHub')
    expect(section.getByText('GitHub account 123456')).toBeInTheDocument()
  })

  test('omits the link date when there is none', async () => {
    mockApi({ accounts: [account({ linked_at: null })] })
    renderPage()

    const section = await findSection('GitHub')
    expect(section.getByRole('listitem')).not.toHaveTextContent('Linked')
  })

  test('re-links an account by its ID, as a secondary action', async () => {
    mockApi({ accounts: [account()] })
    renderPage()

    const relink = await screen.findByRole('link', { name: 'Re-link @octocat' })
    expect(relink).toHaveAttribute(
      'href',
      '/api/accounts/github/login?account_id=3',
    )
    expect(relink).not.toHaveClass('primary')
    expect(
      screen.queryByText('Access expired. Re-link to keep syncing.'),
    ).not.toBeInTheDocument()
  })

  test('warns about an account that needs re-linking, and makes re-link primary', async () => {
    mockApi({ accounts: [account({ needs_relink: true })] })
    renderPage()

    const section = await findSection('GitHub')
    expect(
      section.getByText('Access expired. Re-link to keep syncing.'),
    ).toBeInTheDocument()
    expect(section.getByRole('link', { name: 'Re-link @octocat' })).toHaveClass(
      'primary',
    )
  })

  test('links another account without a target', async () => {
    mockApi({ accounts: [account()] })
    renderPage()

    const section = await findSection('GitHub')
    expect(
      section.getByRole('link', { name: 'Link another GitHub account' }),
    ).toHaveAttribute('href', '/api/accounts/github/login')
  })

  test('shows the empty state for a provider without accounts', async () => {
    mockApi({ accounts: [] })
    renderPage()

    const section = await findSection('GitHub')
    expect(
      section.getByText(
        'No GitHub account linked yet. Link one to track your repositories.',
      ),
    ).toBeInTheDocument()
    expect(section.queryByRole('list')).not.toBeInTheDocument()
    expect(
      section.getByRole('link', { name: 'Link a GitHub account' }),
    ).toHaveAttribute('href', '/api/accounts/github/login')
  })

  test('opens the install page in a new tab', async () => {
    mockApi({ accounts: [] })
    renderPage()

    const section = await findSection('GitHub')
    const install = section.getByRole('link', {
      name: /Install the GitHub App or manage its repository access/,
    })
    expect(install).toHaveAttribute('href', github.install_url)
    expect(install).toHaveAttribute('target', '_blank')
    expect(install).toHaveAttribute('rel', 'noopener noreferrer')
  })

  test('hides the install link without an install URL', async () => {
    mockApi({ providers: [{ ...github, install_url: null }] })
    renderPage()

    const section = await findSection('GitHub')
    expect(section.queryByRole('link', { name: /Install/ })).toBeNull()
  })

  test('shows one section per provider, in the API order', async () => {
    mockApi({
      providers: [
        github,
        { name: 'bitbucket', display_name: 'Bitbucket', install_url: null },
      ],
    })
    renderPage()

    await findSection('GitHub')
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual(['GitHub', 'Bitbucket'])
  })

  test('keeps accounts of a provider the API no longer lists, without linking', async () => {
    mockApi({
      accounts: [
        account({ id: 7, provider: 'gitlab', provider_login: 'old-me' }),
      ],
    })
    renderPage()

    const section = await findSection('gitlab')
    expect(section.getByText('@old-me')).toBeInTheDocument()
    expect(section.queryByRole('link')).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual(['GitHub', 'gitlab'])
  })

  test.each([
    ['providers', '/providers'],
    ['accounts', '/accounts'],
  ])('shows a failed %s request with a retry', async (_, failingPath) => {
    let failing = true
    mockApi({ accounts: [account()] })
    server.use(
      http.get(apiUrl(failingPath), () =>
        failing
          ? HttpResponse.json(
              { error: { code: 'internal', message: 'Something went wrong' } },
              { status: 500 },
            )
          : undefined,
      ),
    )
    const { user } = renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load your linked accounts')
    expect(alert).toHaveTextContent('Something went wrong')

    failing = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('@octocat')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
