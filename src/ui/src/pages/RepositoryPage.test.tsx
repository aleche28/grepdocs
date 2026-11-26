import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw/http'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { apiUrl } from '../api/client.ts'
import { fastPollMs, type SyncStatus } from '../api/repositories.ts'
import {
  documentDetail,
  mockDocumentsApi,
  renderRepositoryPage,
  trackedDocument,
} from '../test/documents.tsx'
import { mockAccountsApi } from '../test/accounts.tsx'
import { errorResponse } from '../test/helpers.ts'
import {
  mockRepositoriesApi,
  repository,
  update,
} from '../test/repositories.tsx'
import { server } from '../test/server.ts'
import { formatDateTime } from './accounts/format.ts'

afterEach(() => {
  vi.useRealTimers()
})

const synced = repository({
  id: 12,
  sync_status: 'ok',
  synced_commit: 'abcd123',
  last_sync_at: '2026-11-25T10:12:00Z',
})

const treeName = 'Documents in acme/docs'

function tree() {
  return within(screen.getByRole('navigation', { name: treeName }))
}

// A document's link in the tree, once the tree has loaded. Hidden too: a
// link in a closed directory is not shown.
async function findTreeLink(name: string) {
  await screen.findByRole('navigation', { name: treeName })
  return tree().findByRole('link', { name, hidden: true })
}

// A directory's name in its <summary>, which toggles it when clicked.
function summary(name: string) {
  return screen.getByText(name, { selector: 'summary .tree-name' })
}

// The <details> of a directory, found by its <summary>.
function directory(name: string) {
  return summary(name).closest('details')!
}

describe('RepositoryPage', () => {
  test('shows the repository and its documents as a tree', async () => {
    mockRepositoriesApi({ repositories: [synced] })
    const readme = trackedDocument({ path: 'README.md' })
    const setup = trackedDocument({ path: 'docs/guides/2-setup.md' })
    const faq = trackedDocument({ path: 'docs/guides/10-faq.md' })
    mockDocumentsApi([readme, faq, setup])
    renderRepositoryPage('/repositories/12')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'acme/docs' }),
    ).toBeInTheDocument()
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(
      screen.getByText(`Synced ${formatDateTime(synced.last_sync_at)}`),
    ).toBeInTheDocument()
    const upstream = screen.getByRole('link', { name: 'acme/docs on GitHub' })
    expect(upstream).toHaveAttribute('href', 'https://github.com/acme/docs')
    expect(upstream).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'Repositories' })).toHaveAttribute(
      'href',
      '/repositories',
    )

    expect(await findTreeLink('README.md')).toHaveAttribute(
      'href',
      `/repositories/12/documents/${readme.id}`,
    )
    // Nothing selected: every directory starts closed.
    expect(directory('docs')).not.toHaveAttribute('open')
    expect(directory('guides')).not.toHaveAttribute('open')
    // Natural order inside a directory.
    const files = tree()
      .getAllByRole('link', { hidden: true })
      .map((link) => link.textContent)
    expect(files).toEqual(['2-setup.md', '10-faq.md', 'README.md'])
    expect(screen.getByText('Choose a document.')).toBeInTheDocument()
  })

  test('highlights the selected document and opens its directories', async () => {
    mockRepositoriesApi({ repositories: [synced] })
    const setup = documentDetail({ path: 'docs/guides/setup.md' })
    mockDocumentsApi([
      trackedDocument({ path: 'docs/api/auth.md' }),
      setup,
      trackedDocument({ path: 'README.md' }),
    ])
    renderRepositoryPage(`/repositories/12/documents/${setup.id}`)

    const link = await findTreeLink('setup.md')
    expect(link).toHaveAttribute('aria-current', 'page')
    expect(directory('docs')).toHaveAttribute('open')
    expect(directory('guides')).toHaveAttribute('open')
    expect(directory('api')).not.toHaveAttribute('open')
    expect(tree().getByRole('link', { name: 'README.md' })).not.toHaveAttribute(
      'aria-current',
    )
    // The document route renders beside the tree.
    expect(
      await screen.findByRole('heading', { name: setup.path }),
    ).toBeInTheDocument()
    expect(screen.queryByText('Choose a document.')).not.toBeInTheDocument()
  })

  test('moves between documents and keeps the tree as the user left it', async () => {
    mockRepositoriesApi({ repositories: [synced] })
    const readme = documentDetail({ path: 'README.md' })
    const setup = documentDetail({ path: 'docs/guides/setup.md' })
    const auth = documentDetail({ path: 'docs/api/auth.md' })
    const api = mockDocumentsApi([readme, setup, auth])
    const { user, router } = renderRepositoryPage(
      `/repositories/12/documents/${setup.id}`,
    )
    await findTreeLink('setup.md')

    // Open api, close guides (which holds the selected document).
    await user.click(summary('api'))
    await user.click(summary('guides'))
    await user.click(tree().getByRole('link', { name: 'auth.md' }))

    expect(router.state.location.pathname).toBe(
      `/repositories/12/documents/${auth.id}`,
    )
    expect(
      await screen.findByRole('heading', { name: auth.path }),
    ).toBeInTheDocument()
    expect(tree().getByRole('link', { name: 'auth.md' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(directory('api')).toHaveAttribute('open')
    expect(directory('guides')).not.toHaveAttribute('open')

    // Back to a document in the closed directory: it opens again.
    await router.navigate(-1)
    expect(
      await screen.findByRole('heading', { name: setup.path }),
    ).toBeInTheDocument()
    await waitFor(() => expect(directory('guides')).toHaveAttribute('open'))
    expect(api.requests).toEqual(['12'])
  })

  test('shows a breadcrumb to the document, ending in its path as the heading', async () => {
    mockRepositoriesApi({ repositories: [synced] })
    const setup = documentDetail({ path: 'docs/guides/setup.md' })
    mockDocumentsApi([setup])
    renderRepositoryPage(`/repositories/12/documents/${setup.id}`)

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'docs/guides/setup.md',
    })
    const breadcrumb = within(
      screen.getByRole('navigation', { name: 'Breadcrumb' }),
    )
    const links = breadcrumb.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Repositories',
      'acme/docs',
    ])
    expect(links[0]).toHaveAttribute('href', '/repositories')
    expect(links[1]).toHaveAttribute('href', '/repositories/12')
    // The heading ends the trail, after the breadcrumb.
    expect(
      screen
        .getByRole('navigation', { name: 'Breadcrumb' })
        .compareDocumentPosition(heading),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  test('switches to another tracked repository', async () => {
    const other = repository({ id: 13, full_name: 'acme/api' })
    const secret = repository({
      id: 14,
      full_name: 'zeta/notes',
      is_private: true,
    })
    mockRepositoriesApi({ repositories: [secret, synced, other] })
    mockDocumentsApi([trackedDocument({ path: 'README.md' })])
    const { user } = renderRepositoryPage('/repositories/12')

    const trigger = await screen.findByRole('button', {
      name: 'acme/docs, switch repository',
    })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)

    const panel = within(
      document.getElementById(trigger.getAttribute('aria-controls')!)!,
    )
    const links = panel.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'acme/api',
      'acme/docs',
      'zeta/notes',
      'All repositories',
    ])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/repositories/13',
      '/repositories/12',
      '/repositories/14',
      '/repositories',
    ])
    expect(panel.getByRole('link', { name: 'acme/docs' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(panel.getByRole('link', { name: 'acme/api' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  test('filters the tree by path, opening the directories that match', async () => {
    mockRepositoriesApi({ repositories: [synced] })
    mockDocumentsApi([
      trackedDocument({ path: 'README.md' }),
      trackedDocument({ path: 'docs/guides/Setup.md' }),
      trackedDocument({ path: 'docs/api/auth.md' }),
    ])
    const { user } = renderRepositoryPage('/repositories/12')
    await findTreeLink('README.md')
    expect(screen.getByText('3 documents on main')).toBeInTheDocument()
    const filter = screen.getByRole('searchbox', { name: 'Filter documents' })

    await user.type(filter, 'setup')

    expect(tree().getByRole('link', { name: 'Setup.md' })).toBeVisible()
    expect(
      tree().queryByRole('link', { name: 'README.md', hidden: true }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('api')).not.toBeInTheDocument()
    expect(directory('docs')).toHaveAttribute('open')
    expect(directory('guides')).toHaveAttribute('open')

    await user.clear(filter)
    await user.type(filter, 'nothing')

    expect(
      tree().getByText('No documents match “nothing”.'),
    ).toBeInTheDocument()
    expect(tree().queryByRole('link', { hidden: true })).not.toBeInTheDocument()

    // Cleared, the tree is back as it was: every directory closed.
    await user.clear(filter)

    expect(tree().getByRole('link', { name: 'README.md' })).toBeVisible()
    expect(directory('docs')).not.toHaveAttribute('open')
    expect(directory('api')).not.toHaveAttribute('open')
  })

  test('highlights nothing for a document that is not in the list', async () => {
    mockRepositoriesApi({ repositories: [synced] })
    mockDocumentsApi([trackedDocument({ path: 'docs/a.md' })])
    renderRepositoryPage('/repositories/12/documents/9999')

    const link = await findTreeLink('a.md')
    expect(link).not.toHaveAttribute('aria-current')
    expect(directory('docs')).not.toHaveAttribute('open')
  })

  test.each<[SyncStatus, string, string | RegExp, string | null]>([
    [
      'pending',
      'Not synced yet',
      "acme/docs hasn't been synced yet.",
      'Sync it from Repositories',
    ],
    [
      'queued',
      'Syncing',
      'acme/docs is syncing. Its documents appear here when the sync ends.',
      null,
    ],
    [
      'running',
      'Syncing',
      'acme/docs is syncing. Its documents appear here when the sync ends.',
      null,
    ],
    [
      'failed',
      'Last sync failed',
      /^The last sync of acme\/docs failed\./,
      'See what went wrong',
    ],
    ['ok', 'No documents', /^There are no Markdown files on branch/, null],
  ])(
    'says why there are no documents when %s',
    async (status, title, text, link) => {
      mockRepositoriesApi({
        repositories: [repository({ id: 12, sync_status: status })],
      })
      mockDocumentsApi([])
      renderRepositoryPage('/repositories/12')

      const message = await screen.findByText(text)
      expect(
        screen.getByRole('heading', { level: 2, name: title }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('navigation', { name: treeName }),
      ).not.toBeInTheDocument()
      if (link) {
        expect(
          within(message).getByRole('link', { name: link }),
        ).toHaveAttribute('href', '/repositories')
      }
    },
  )

  test('shows the documents of the last good sync while a sync fails', async () => {
    mockRepositoriesApi({
      repositories: [{ ...synced, sync_status: 'failed' }],
    })
    mockDocumentsApi([trackedDocument({ path: 'README.md' })])
    renderRepositoryPage('/repositories/12')

    expect(await findTreeLink('README.md')).toBeInTheDocument()
    expect(
      screen.getByText(
        `Sync failed. Last synced ${formatDateTime(synced.last_sync_at)}.`,
      ),
    ).toBeInTheDocument()
  })

  test.each([
    ['not one of the user', '/repositories/99'],
    ['not an ID', '/repositories/abc'],
    ['zero', '/repositories/0'],
  ])('says a repository is not tracked when its ID is %s', async (_, url) => {
    mockRepositoriesApi({ repositories: [synced] })
    const api = mockDocumentsApi([trackedDocument()])
    renderRepositoryPage(url)

    expect(
      await screen.findByText("This repository isn't tracked."),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Repositories' })).toBeVisible()
    expect(api.requests).toEqual([])
  })

  test('shows a failure to load the repositories, with a retry', async () => {
    server.use(
      http.get(apiUrl('/repositories'), () =>
        errorResponse(500, 'internal', 'Something broke.'),
      ),
    )
    mockAccountsApi({})
    mockDocumentsApi()
    renderRepositoryPage('/repositories/12')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load this repository')
    expect(alert).toHaveTextContent('Something broke.')
    expect(
      within(alert).getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument()
  })

  test('shows a failure to load the documents, and retries', async () => {
    mockRepositoriesApi({ repositories: [synced] })
    let fail = true
    server.use(
      http.get(apiUrl('/documents'), () =>
        fail
          ? errorResponse(500, 'internal', 'Something broke.')
          : HttpResponse.json([trackedDocument({ path: 'README.md' })]),
      ),
    )
    const { user } = renderRepositoryPage('/repositories/12')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the documents')
    fail = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await findTreeLink('README.md')).toBeInTheDocument()
  })

  test('shows the new documents when a sync of the repository succeeds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = mockRepositoriesApi({
      repositories: [{ ...synced, sync_status: 'running' }],
    })
    const api = mockDocumentsApi([trackedDocument({ path: 'README.md' })])
    renderRepositoryPage('/repositories/12')
    await findTreeLink('README.md')
    // Announced as it changes.
    expect(screen.getByText('Syncing…')).toHaveAttribute('aria-live', 'polite')

    api.documents = [trackedDocument({ path: 'CHANGELOG.md' })]
    update(state, 12, {
      sync_status: 'ok',
      last_sync_at: '2026-11-25T11:00:00Z',
    })
    await vi.advanceTimersByTimeAsync(fastPollMs)

    expect(await findTreeLink('CHANGELOG.md')).toBeInTheDocument()
    expect(api.requests).toEqual(['12', '12'])
  })

  test('keeps the documents when a sync of the repository fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const state = mockRepositoriesApi({
      repositories: [{ ...synced, sync_status: 'running' }],
    })
    const api = mockDocumentsApi([trackedDocument({ path: 'README.md' })])
    renderRepositoryPage('/repositories/12')
    await findTreeLink('README.md')

    // A failed sync leaves last_sync_at alone: nothing to refetch.
    update(state, 12, { sync_status: 'failed', sync_error: 'internal' })
    await vi.advanceTimersByTimeAsync(fastPollMs)

    expect(await screen.findByText(/^Sync failed\./)).toBeInTheDocument()
    expect(tree().getByRole('link', { name: 'README.md' })).toBeInTheDocument()
    expect(api.requests).toEqual(['12'])
  })
})
