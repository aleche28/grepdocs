import { http, HttpResponse } from 'msw/http'
import type { ExternalAccount, Provider } from '../api/accounts.ts'
import { apiUrl } from '../api/client.ts'
import type { Repository } from '../api/repositories.ts'
import { RepositoriesPage } from '../pages/RepositoriesPage.tsx'
import { account, github, mockAccountsApi } from './accounts.tsx'
import { renderRoute } from './renderRoute.tsx'
import { server } from './server.ts'

// Fixtures and helpers for the RepositoriesPage tests.

// A tracked repository as GET /repositories returns it: acme/docs on main,
// synced through account 3, unless overridden. owner, name, html_url and
// provider_repo_id follow full_name when only that is given.
export function repository(overrides: Partial<Repository> = {}): Repository {
  const fullName = overrides.full_name ?? 'acme/docs'
  const [owner, name] = fullName.split('/')
  return {
    id: 12,
    account_id: 3,
    provider: 'github',
    provider_repo_id: `id-${fullName}`,
    owner,
    name,
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    is_private: false,
    default_branch: 'main',
    tracked_branch: 'main',
    synced_commit: null,
    sync_status: 'pending',
    sync_error: null,
    auto_sync: false,
    last_sync_at: null,
    ...overrides,
  }
}

interface RepositoriesApi {
  repositories?: Repository[]
  providers?: Provider[]
  accounts?: ExternalAccount[]
}

// The lists the page loads, as state a test can change between requests
// (a sync moving on, a row going away), and how many times the page fetched
// the repositories.
export interface RepositoriesApiState {
  repositories: Repository[]
  fetches: number
}

export function mockRepositoriesApi({
  repositories = [],
  providers = [github],
  accounts = [account()],
}: RepositoriesApi): RepositoriesApiState {
  const state: RepositoriesApiState = { repositories, fetches: 0 }
  mockAccountsApi({ providers, accounts })
  server.use(
    http.get(apiUrl('/repositories'), () => {
      state.fetches++
      return HttpResponse.json(state.repositories)
    }),
  )
  return state
}

// Replaces one repository of the state, as the API would after a change.
export function update(
  state: RepositoriesApiState,
  id: number,
  changes: Partial<Repository>,
): Repository {
  let updated: Repository | undefined
  state.repositories = state.repositories.map((r) => {
    if (r.id !== id) return r
    updated = { ...r, ...changes }
    return updated
  })
  if (!updated) {
    throw new Error(`no repository ${id}`)
  }
  return updated
}

// Answers POST /repositories/:id/sync with `respond`, recording each path.
export function mockSync(
  respond: (id: number) => Response | Promise<Response>,
): string[] {
  const paths: string[] = []
  server.use(
    http.post(apiUrl('/repositories/:id/sync'), ({ request, params }) => {
      paths.push(new URL(request.url).pathname)
      return respond(Number(params.id))
    }),
  )
  return paths
}

// A 202 that queues the repository in `state`, like the API.
export function queue(state: RepositoriesApiState) {
  return (id: number) =>
    HttpResponse.json(update(state, id, { sync_status: 'queued' }), {
      status: 202,
    })
}

export function renderRepositoriesPage() {
  return renderRoute({ path: '/repositories', element: <RepositoriesPage /> })
}
