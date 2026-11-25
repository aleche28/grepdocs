import { http, HttpResponse } from 'msw/http'
import type {
  AccountRepository,
  ExternalAccount,
  Provider,
} from '../api/accounts.ts'
import { apiUrl } from '../api/client.ts'
import type { Repository } from '../api/repositories.ts'
import { TrackRepositoryPage } from '../pages/TrackRepositoryPage.tsx'
import { github } from './accounts.tsx'
import { renderRoute } from './renderRoute.tsx'
import { server } from './server.ts'

// Fixtures and helpers for the TrackRepositoryPage tests. Accounts come from
// account() in accounts.tsx.

export function discovered(
  fullName: string,
  overrides: Partial<AccountRepository> = {},
): AccountRepository {
  const [, name] = fullName.split('/')
  return {
    provider: 'github',
    provider_repo_id: `id-${fullName}`,
    name,
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    is_private: false,
    default_branch: 'main',
    ...overrides,
  }
}

// The tracked repository the API would create from a discovered one.
export function trackedFrom(
  repository: AccountRepository,
  id = 12,
  accountId: number | null = 3,
): Repository {
  return {
    id,
    account_id: accountId,
    provider: repository.provider,
    provider_repo_id: repository.provider_repo_id,
    full_name: repository.full_name,
    default_branch: repository.default_branch,
    tracked_branch: repository.default_branch,
  }
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  { details, headers }: { details?: object; headers?: HeadersInit } = {},
) {
  return HttpResponse.json(
    { error: details ? { code, message, details } : { code, message } },
    { status, headers },
  )
}

interface TrackApi {
  providers?: Provider[]
  accounts?: ExternalAccount[]
  // GET /repositories; a function to answer differently per request.
  tracked?: Repository[] | (() => Repository[])
  // GET /accounts/github/repositories, by account ID. An account missing
  // here gets no handler, so requesting its list fails the test.
  repositories?: Record<number, AccountRepository[] | (() => Response)>
}

// Serves the lists the page loads, and records each request as
// "METHOD path?query", to see what the page asked for.
export function mockTrackApi({
  providers = [github],
  accounts = [],
  tracked = [],
  repositories = {},
}: TrackApi) {
  const requests: string[] = []
  const record = (request: Request) => {
    const url = new URL(request.url)
    requests.push(`${request.method} ${url.pathname}${url.search}`)
  }

  server.use(
    http.get(apiUrl('/providers'), () => HttpResponse.json(providers)),
    http.get(apiUrl('/accounts'), () => HttpResponse.json(accounts)),
    http.get(apiUrl('/repositories'), ({ request }) => {
      record(request)
      return HttpResponse.json(
        typeof tracked === 'function' ? tracked() : tracked,
      )
    }),
    http.get(apiUrl('/accounts/github/repositories'), ({ request }) => {
      record(request)
      const id = Number(new URL(request.url).searchParams.get('account_id'))
      const answer = repositories[id]
      if (answer === undefined) {
        throw new Error(`no repositories mocked for account ${id}`)
      }
      return typeof answer === 'function' ? answer() : HttpResponse.json(answer)
    }),
  )
  return requests
}

export function renderTrackPage(url = '/repositories/track') {
  return renderRoute({
    path: '/repositories/track',
    element: <TrackRepositoryPage />,
    url,
  })
}
