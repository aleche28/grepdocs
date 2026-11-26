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
import { errorResponse, findRow } from '../test/helpers.ts'
import { server } from '../test/server.ts'
import { formatDateTime } from './accounts/format.ts'

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
    expect(docs.getByText('GitHub · @octocat')).toBeInTheDocument()

    const notes = await findRow('octocat/notes')
    expect(notes.getByText('Private')).toBeInTheDocument()
  })

  test('labels each cell for screen readers', async () => {
    mockRepositoriesApi({ repositories: [repository({ sync_status: 'ok' })] })
    renderRepositoriesPage()

    const row = await findRow('acme/docs')
    // The column headers are hidden from them.
    expect(row.getByText('Branch')).toHaveClass('visually-hidden')
    expect(row.getByText('Status')).toHaveClass('visually-hidden')
    expect(row.getByText('Auto-sync')).toHaveClass('cell-label')
  })

  test('names where a repository without an account comes from', async () => {
    mockRepositoriesApi({
      repositories: [
        repository({ id: 12, full_name: 'acme/docs', account_id: null }),
        repository({
          id: 13,
          full_name: 'acme/private',
          account_id: null,
          is_private: true,
        }),
      ],
    })
    renderRepositoriesPage()

    expect(
      (await findRow('acme/docs')).getByText('GitHub · public, no account'),
    ).toBeInTheDocument()
    expect(
      (await findRow('acme/private')).getByText('GitHub · no account'),
    ).toBeInTheDocument()
  })

  test('counts the tracked repositories', async () => {
    mockRepositoriesApi({
      repositories: [
        repository({ id: 12, full_name: 'acme/docs' }),
        repository({ id: 13, full_name: 'acme/handbook' }),
      ],
    })
    renderRepositoriesPage()

    expect(
      await screen.findByText('2 tracked repositories'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Track a repository' }),
    ).toHaveAttribute('href', '/repositories/track')
  })

  test('says one tracked repository', async () => {
    mockRepositoriesApi({ repositories: [repository()] })
    renderRepositoriesPage()

    expect(await screen.findByText('1 tracked repository')).toBeInTheDocument()
  })

  test('shows the other actions in a menu', async () => {
    mockRepositoriesApi({ repositories: [repository()] })
    const { user } = renderRepositoriesPage()

    const row = await findRow('acme/docs')
    const more = row.getByRole('button', { name: 'More actions for acme/docs' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(
      row.queryByRole('button', { name: 'Untrack' }),
    ).not.toBeInTheDocument()

    await user.click(more)

    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(
      row.getByRole('button', { name: 'Edit branch and sync' }),
    ).toBeInTheDocument()
    const upstream = row.getByRole('link', { name: 'View on GitHub' })
    expect(upstream).toHaveAttribute('href', 'https://github.com/acme/docs')
    expect(upstream).toHaveAttribute('target', '_blank')
    expect(upstream).toHaveAttribute('rel', 'noopener noreferrer')
    expect(row.getByRole('button', { name: 'Untrack' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(more).toHaveFocus()
  })

  test('explains an empty list, with the way to track one', async () => {
    mockRepositoriesApi({})
    renderRepositoriesPage()

    expect(
      await screen.findByRole('heading', { name: 'No repositories yet' }),
    ).toBeInTheDocument()
    // Only the empty state's: the heading drops its own.
    expect(
      screen.getByRole('link', { name: 'Track a repository' }),
    ).toHaveAttribute('href', '/repositories/track')
    expect(screen.queryByText(/tracked repositor/)).not.toBeInTheDocument()
  })

  test('says the list is loading', async () => {
    mockRepositoriesApi({})
    server.use(
      http.get(apiUrl('/repositories'), () => new Promise<Response>(() => {})),
    )
    renderRepositoriesPage()

    expect(await screen.findByText('Loading repositories…')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Track a repository' }),
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

    expect((await findRow('acme/docs')).getByText('On')).toBeVisible()
    expect((await findRow('acme/handbook')).getByText('Off')).toBeVisible()
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
    ['queued', { sync_status: 'queued' }, 'Queued'],
    ['running', { sync_status: 'running' }, 'Syncing'],
    ['ok', { sync_status: 'ok', last_sync_at: syncedAt }, 'Synced'],
    [
      'an unknown status',
      { sync_status: 'paused' as Repository['sync_status'] },
      'Not synced yet',
    ],
    [
      'a retry queued after a failure',
      { sync_status: 'queued', sync_error: 'internal' },
      'Queued',
    ],
  ])('shows %s', async (_, overrides, text) => {
    mockRepositoriesApi({ repositories: [repository(overrides)] })
    renderRepositoriesPage()

    const row = await findRow('acme/docs')
    expect(row.getByText(text)).toBeInTheDocument()
    expect(row.queryByText('Sync failed.')).not.toBeInTheDocument()
  })

  test('says how long ago a repository synced', async () => {
    const fourMinutesAgo = new Date(Date.now() - 4 * 60_000).toISOString()
    mockRepositoriesApi({
      repositories: [
        repository({ sync_status: 'ok', last_sync_at: fourMinutesAgo }),
      ],
    })
    renderRepositoriesPage()

    const row = await findRow('acme/docs')
    const when = row.getByText('4 minutes ago')
    expect(when).toHaveAttribute('datetime', fourMinutesAgo)
    // The date and time on hover.
    expect(when).toHaveAttribute('title', formatDateTime(fourMinutesAgo))
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
    [
      'internal',
      'Something went wrong. Try again; if it keeps failing, report it.',
    ],
    [
      'a_new_code',
      'Something went wrong. Try again; if it keeps failing, report it.',
    ],
  ])('explains %s', async (code, text) => {
    renderFailed(code)

    const row = await findRow('acme/docs')
    expect(row.getByText('Failed')).toBeInTheDocument()
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
