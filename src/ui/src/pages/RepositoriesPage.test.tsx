import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw/http'
import { describe, expect, test } from 'vitest'
import { relinkUrl } from '../api/accounts.ts'
import { apiUrl } from '../api/client.ts'
import type { Repository, SyncErrorCode } from '../api/repositories.ts'
import { account, github } from '../test/accounts.tsx'
import {
  mockRepositoriesApi,
  renderRepositoriesPage,
  repository,
} from '../test/repositories.tsx'
import { server } from '../test/server.ts'
import { errorResponse } from '../test/track.tsx'
import { formatDateTime } from './repositories/format.ts'

async function findRow(fullName: string) {
  const link = await screen.findByRole('link', { name: fullName })
  return within(link.closest('li')!)
}

describe('RepositoriesPage', () => {
  test('lists the tracked repositories by name', async () => {
    mockRepositoriesApi({
      repositories: [
        repository({ id: 13, full_name: 'octocat/notes', is_private: true }),
        repository({ id: 12, full_name: 'acme/docs', tracked_branch: 'trunk' }),
      ],
    })
    renderRepositoriesPage()

    const links = await screen.findAllByRole('link', {
      name: /\/(docs|notes)$/,
    })
    expect(links.map((link) => link.textContent)).toEqual([
      'acme/docs',
      'octocat/notes',
    ])
    expect(links[0]).toHaveAttribute('href', '/repositories/12')

    const docs = await findRow('acme/docs')
    expect(docs.getByText('Public')).toBeInTheDocument()
    expect(docs.getByText('trunk')).toBeInTheDocument()
    const upstream = docs.getByRole('link', { name: 'acme/docs on GitHub' })
    expect(upstream).toHaveAttribute('href', 'https://github.com/acme/docs')
    expect(upstream).toHaveAttribute('target', '_blank')
    expect(upstream).toHaveAttribute('rel', 'noopener noreferrer')

    const notes = await findRow('octocat/notes')
    expect(notes.getByText('Private')).toBeInTheDocument()
  })

  test('links to the track page', async () => {
    mockRepositoriesApi({})
    renderRepositoriesPage()

    expect(
      screen.getByRole('link', { name: 'Track a repository' }),
    ).toHaveAttribute('href', '/repositories/track')
    expect(
      await screen.findByText("You don't track any repository yet."),
    ).toBeInTheDocument()
  })

  test('marks the repositories that sync when the app opens', async () => {
    mockRepositoriesApi({
      repositories: [
        repository({ id: 12, full_name: 'acme/docs', auto_sync: true }),
        repository({ id: 13, full_name: 'acme/handbook' }),
      ],
    })
    // auto_sync on an idle repository starts a sync on opening.
    server.use(
      http.post(apiUrl('/repositories/12/sync'), () =>
        errorResponse(409, 'conflict', 'busy'),
      ),
    )
    renderRepositoriesPage()

    expect((await findRow('acme/docs')).getByText('Auto-sync')).toBeVisible()
    expect(
      (await findRow('acme/handbook')).queryByText('Auto-sync'),
    ).not.toBeInTheDocument()
  })

  test('shows a failure to load with a retry', async () => {
    mockRepositoriesApi({})
    let fail = true
    server.use(
      http.get(apiUrl('/repositories'), () =>
        fail
          ? errorResponse(500, 'internal', 'internal server error')
          : HttpResponse.json([repository()]),
      ),
    )
    const { user } = renderRepositoriesPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load your repositories')
    expect(alert).toHaveTextContent('internal server error')

    fail = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: 'acme/docs' })).toBeVisible()
  })

  const syncedAt = '2026-11-20T09:30:00Z'

  test.each<[string, Partial<Repository>, string]>([
    ['pending', { sync_status: 'pending' }, 'Not synced yet'],
    ['queued', { sync_status: 'queued' }, 'Waiting to sync…'],
    ['running', { sync_status: 'running' }, 'Syncing…'],
    [
      'ok',
      { sync_status: 'ok', last_sync_at: syncedAt },
      `Synced ${formatDateTime(syncedAt)}`,
    ],
    [
      'an unknown status',
      { sync_status: 'paused' as Repository['sync_status'] },
      'Not synced yet',
    ],
    [
      'a retry queued after a failure',
      { sync_status: 'queued', sync_error: 'internal' },
      'Waiting to sync…',
    ],
  ])('shows %s', async (_, overrides, text) => {
    mockRepositoriesApi({ repositories: [repository(overrides)] })
    renderRepositoriesPage()

    const row = await findRow('acme/docs')
    expect(row.getByText(text)).toBeInTheDocument()
    expect(row.queryByText('Sync failed.')).not.toBeInTheDocument()
  })

  test('disables Sync while a sync is busy', async () => {
    mockRepositoriesApi({
      repositories: [repository({ sync_status: 'running' })],
    })
    renderRepositoriesPage()

    const row = await findRow('acme/docs')
    expect(row.getByRole('button', { name: 'Sync acme/docs' })).toBeDisabled()
  })

  test('counts the failed repositories above the list', async () => {
    const failed = {
      sync_status: 'failed' as const,
      sync_error: 'internal' as const,
    }
    mockRepositoriesApi({
      repositories: [
        repository({ id: 12, full_name: 'acme/docs', ...failed }),
        repository({ id: 13, full_name: 'acme/handbook', sync_status: 'ok' }),
      ],
    })
    renderRepositoriesPage()

    expect(
      await screen.findByText('1 repository failed its last sync.'),
    ).toBeInTheDocument()
  })

  test('says how many failed when several did', async () => {
    const failed = {
      sync_status: 'failed' as const,
      sync_error: 'internal' as const,
    }
    mockRepositoriesApi({
      repositories: [
        repository({ id: 12, full_name: 'acme/docs', ...failed }),
        repository({ id: 13, full_name: 'acme/handbook', ...failed }),
      ],
    })
    renderRepositoriesPage()

    expect(
      await screen.findByText('2 repositories failed their last sync.'),
    ).toBeInTheDocument()
  })

  test('shows when a failed repository last synced', async () => {
    mockRepositoriesApi({
      repositories: [
        repository({
          sync_status: 'failed',
          sync_error: 'internal',
          last_sync_at: syncedAt,
        }),
      ],
    })
    renderRepositoriesPage()

    const row = await findRow('acme/docs')
    expect(
      row.getByText(`Last synced ${formatDateTime(syncedAt)}.`, {
        exact: false,
      }),
    ).toBeInTheDocument()
  })
})

describe('RepositoriesPage sync errors', () => {
  function renderFailed(
    sync_error: SyncErrorCode | string,
    overrides: Partial<Repository> = {},
    accounts = [account()],
  ) {
    mockRepositoriesApi({
      repositories: [
        repository({
          sync_status: 'failed',
          sync_error: sync_error as SyncErrorCode,
          ...overrides,
        }),
      ],
      accounts,
    })
    return renderRepositoriesPage()
  }

  test.each<[string, string]>([
    [
      'resource_not_found',
      "GitHub can't find acme/docs or its branch main any more.",
    ],
    ['rate_limited', "GitHub's rate limit was reached. Try again later."],
    [
      'truncated_tree',
      "acme/docs has too many files for GitHub to list at once. This isn't supported yet.",
    ],
    ['provider_not_supported', "GitHub isn't available on this server."],
    ['internal', 'The sync failed. Try again; if it keeps failing, report it.'],
    [
      'a_new_code',
      'The sync failed. Try again; if it keeps failing, report it.',
    ],
  ])('explains %s', async (code, text) => {
    renderFailed(code)

    const row = await findRow('acme/docs')
    expect(row.getByText('Sync failed.')).toBeInTheDocument()
    expect(row.getByText(text)).toBeInTheDocument()
  })

  test('offers to re-link the account whose access was revoked', async () => {
    renderFailed('reauth_required')

    const row = await findRow('acme/docs')
    expect(
      row.getByText('GitHub no longer accepts the access of @octocat.', {
        exact: false,
      }),
    ).toBeInTheDocument()
    expect(row.getByRole('link', { name: 'Re-link @octocat' })).toHaveAttribute(
      'href',
      relinkUrl('github', 3),
    )
  })

  test('sends to the accounts page when the account is unknown', async () => {
    renderFailed('reauth_required', { account_id: null }, [])

    const row = await findRow('acme/docs')
    expect(
      row.getByRole('link', { name: 'Link a GitHub account' }),
    ).toHaveAttribute('href', '/settings/accounts')
  })

  test('links to the app installation', async () => {
    renderFailed('app_not_installed')

    const row = await findRow('acme/docs')
    expect(
      row.getByText("The GitHub App isn't installed on acme/docs.", {
        exact: false,
      }),
    ).toBeInTheDocument()
    const install = row.getByRole('link', { name: 'Install the GitHub App' })
    expect(install).toHaveAttribute('href', github.install_url)
    expect(install).toHaveAttribute('target', '_blank')
  })

  test('explains the shared limit of a repository without an account', async () => {
    renderFailed('rate_limited', { account_id: null, is_private: false })

    const row = await findRow('acme/docs')
    expect(
      row.getByText(
        'Repositories tracked without an account share a low limit.',
        {
          exact: false,
        },
      ),
    ).toBeInTheDocument()
  })

  test('names the provider by its raw name when it is not listed', async () => {
    mockRepositoriesApi({
      repositories: [
        repository({
          sync_status: 'failed',
          sync_error: 'provider_not_supported',
          provider: 'gitea',
        }),
      ],
    })
    renderRepositoriesPage()

    const row = await findRow('acme/docs')
    expect(
      row.getByText("gitea isn't available on this server."),
    ).toBeInTheDocument()
  })
})
