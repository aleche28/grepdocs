import { http, HttpResponse } from 'msw/http'
import type { ExternalAccount, Provider } from '../api/accounts.ts'
import { apiUrl } from '../api/client.ts'
import { AccountsPage } from '../pages/AccountsPage.tsx'
import { renderRoute } from './renderRoute.tsx'
import { server } from './server.ts'

// Fixtures and helpers for the AccountsPage tests.

export const github: Provider = {
  name: 'github',
  display_name: 'GitHub',
  install_url: 'https://github.com/apps/grepdocs/installations/new',
}

export function account(
  overrides: Partial<ExternalAccount> = {},
): ExternalAccount {
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

// Serves the two lists the page loads.
export function mockAccountsApi({
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

export function renderAccountsPage(url = '/settings/accounts') {
  return renderRoute({
    path: '/settings/accounts',
    element: <AccountsPage />,
    url,
  })
}
