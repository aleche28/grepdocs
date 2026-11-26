import { screen, waitFor, within } from '@testing-library/react'
import { http } from 'msw/http'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { apiUrl } from '../api/client.ts'
import type { DocumentDetail } from '../api/documents.ts'
import { fastPollMs } from '../api/repositories.ts'
import {
  documentDetail,
  mockDocumentsApi,
  renderRepositoryPage,
} from '../test/documents.tsx'
import { errorResponse } from '../test/helpers.ts'
import {
  mockRepositoriesApi,
  repository,
  update,
} from '../test/repositories.tsx'
import { server } from '../test/server.ts'
import { formatDateTime } from './accounts/format.ts'
import { copiedMessageMs } from './repository/clipboard.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const commit = 'abcd1234ef567890abcd1234ef567890abcd1234'

const synced = repository({
  id: 12,
  sync_status: 'ok',
  synced_commit: commit,
  last_sync_at: '2026-11-25T10:12:00Z',
})

// The repository page on one document, with `documents` in the repository
// (the first one opened, unless `url` says otherwise).
function openDocument(
  documents: DocumentDetail[],
  url = `/repositories/12/documents/${documents[0].id}`,
) {
  const repositories = mockRepositoriesApi({ repositories: [synced] })
  const api = mockDocumentsApi(documents)
  return { ...renderRepositoryPage(url), repositories, api }
}

function doc(overrides: Partial<DocumentDetail> = {}) {
  return documentDetail({ upstream_commit: commit, ...overrides })
}

// The rendered document, once it has loaded (the renderer is lazy).
async function findArticle() {
  return within(await screen.findByRole('article'))
}

function rawSource() {
  return document.querySelector('.document-raw code')
}

// Stands in for the Clipboard API, which jsdom does not have (user-event's
// own stub is replaced, so a test can make the write fail).
function stubClipboard(writeText: (text: string) => Promise<void>) {
  const clipboard = { writeText: vi.fn(writeText) }
  Object.defineProperty(navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
  })
  return clipboard
}

describe('DocumentPage', () => {
  test('renders GitHub Flavored Markdown and inline HTML', async () => {
    openDocument([
      doc({
        content: [
          '# Getting started',
          '',
          '| Name | Value |',
          '| ---- | ----- |',
          '| a    | 1     |',
          '',
          '- [x] done',
          '- [ ] todo',
          '',
          '~~old~~ and https://example.com',
          '',
          'Text[^1]',
          '',
          '[^1]: A note.',
          '',
          '<details><summary>More</summary>Hidden text</details>',
        ].join('\n'),
      }),
    ])

    const article = await findArticle()
    const heading = article.getByRole('heading', {
      level: 1,
      name: 'Getting started',
    })
    expect(heading).toHaveAttribute('id', 'user-content-getting-started')
    expect(article.getByRole('table')).toHaveTextContent('Value')
    expect(article.getAllByRole('checkbox')).toHaveLength(2)
    expect(article.getByText('old').tagName).toBe('DEL')
    const autolink = article.getByRole('link', { name: 'https://example.com' })
    expect(autolink).toHaveAttribute('target', '_blank')
    expect(autolink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(article.getByText('More').tagName).toBe('SUMMARY')

    // Footnote IDs carry the prefix once, matching their links.
    const ref = article.getByRole('link', { name: '1' })
    expect(ref).toHaveAttribute('href', '#user-content-fn-1')
    expect(document.getElementById('user-content-fn-1')).toHaveTextContent(
      'A note.',
    )
  })

  test('removes anything that could run from the document', async () => {
    const win = window as unknown as { hacked?: boolean }
    openDocument([
      doc({
        content: [
          '<script>window.hacked = true</script>',
          '',
          '<img src="x.png" onerror="window.hacked = true" alt="pic">',
          '',
          '<iframe src="https://evil.example"></iframe>',
          '',
          '<p style="color: red" onclick="window.hacked = true">styled</p>',
          '',
          '[click](javascript:alert(1)) <a href="javascript:alert(1)">raw</a>',
          '',
          '<form action="https://evil.example"><input name="q"></form>',
          '',
          '<div id="location" name="top">clobber</div>',
        ].join('\n'),
      }),
    ])

    const article = await findArticle()
    const element = screen.getByRole('article')
    expect(article.getByText('styled')).toBeInTheDocument()
    expect(
      element.querySelector('script, iframe, form, [style], [onclick]'),
    ).toBeNull()
    // What is left of an <input> is a disabled checkbox, as for task lists.
    expect(element.querySelector('input:not([disabled])')).toBeNull()
    expect(article.getByRole('img', { name: 'pic' })).not.toHaveAttribute(
      'onerror',
    )
    expect(element.querySelector('[href^="javascript"]')).toBeNull()
    expect(article.getByText('click')).not.toHaveAttribute('href')
    expect(article.getByText('clobber')).toHaveAttribute(
      'id',
      'user-content-location',
    )
    expect(win.hacked).toBeUndefined()
  })

  test('shows the exact source in the raw view', async () => {
    const content = '# Title\n\n<b>bold</b>   and  *spaces*\n'
    const readme = doc({ content })
    openDocument([readme], `/repositories/12/documents/${readme.id}?view=raw`)

    await waitFor(() => expect(rawSource()?.textContent).toBe(content))
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Raw' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('switches between the rendered and the raw view', async () => {
    const readme = doc({ content: '# Title' })
    const { router, user } = openDocument([readme])
    await findArticle()
    const path = `/repositories/12/documents/${readme.id}`

    await user.click(screen.getByRole('link', { name: 'Raw' }))

    expect(rawSource()).toHaveTextContent('# Title')
    expect(router.state.location.pathname).toBe(path)
    expect(router.state.location.search).toBe('?view=raw')
    expect(router.state.historyAction).toBe('REPLACE')

    await user.click(screen.getByRole('link', { name: 'Rendered' }))

    expect(
      (await findArticle()).getByRole('heading', { name: 'Title' }),
    ).toBeInTheDocument()
    expect(router.state.location.search).toBe('')
    expect(screen.getByRole('link', { name: 'Rendered' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  test('says where the document comes from', async () => {
    const guide = doc({ path: 'docs/my guide.md' })
    openDocument([guide])

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'docs/my guide.md',
      }),
    ).toBeInTheDocument()
    const origin = within(screen.getByText('abcd123').closest('p')!)
    expect(origin.getByText('main')).toBeInTheDocument()
    expect(origin.getByTitle(commit)).toHaveTextContent('Commit abcd123')
    const syncedAt = origin.getByText(formatDateTime(guide.synced_at)!)
    expect(syncedAt).toHaveAttribute('datetime', guide.synced_at)
    expect(syncedAt.parentElement).toHaveTextContent(
      `Synced ${formatDateTime(guide.synced_at)}`,
    )
    const upstream = screen.getByRole('link', { name: 'View on GitHub' })
    expect(upstream).toHaveAttribute(
      'href',
      `https://github.com/acme/docs/blob/${commit}/docs/my%20guide.md`,
    )
    expect(upstream).toHaveAttribute('target', '_blank')
  })

  test('points relative links at synced documents or at GitHub', async () => {
    const readme = doc({
      path: 'docs/README.md',
      content: [
        '[Setup](setup.md#step-2)',
        '[Copied](setup.md#user-content-step-2)',
        '[Diagram](diagram.svg?raw=true)',
        '[Top](#intro)',
        '[Out](../../outside.md)',
        '',
        '![Arch](img/arch.png)',
      ].join('\n'),
    })
    const setup = doc({ path: 'docs/setup.md', content: '## Step 2' })
    const { router, user } = openDocument([readme, setup])
    const article = await findArticle()
    const base = `https://github.com/acme/docs`

    expect(article.getByRole('link', { name: 'Setup' })).toHaveAttribute(
      'href',
      `/repositories/12/documents/${setup.id}#user-content-step-2`,
    )
    // A fragment copied from GitHub's page is not prefixed twice.
    expect(article.getByRole('link', { name: 'Copied' })).toHaveAttribute(
      'href',
      `/repositories/12/documents/${setup.id}#user-content-step-2`,
    )
    const diagram = article.getByRole('link', { name: 'Diagram' })
    expect(diagram).toHaveAttribute(
      'href',
      `${base}/blob/${commit}/docs/diagram.svg?raw=true`,
    )
    expect(diagram).toHaveAttribute('target', '_blank')
    expect(article.getByRole('link', { name: 'Top' })).toHaveAttribute(
      'href',
      '#user-content-intro',
    )
    expect(article.getByText('Out')).not.toHaveAttribute('href')
    expect(article.getByRole('img', { name: 'Arch' })).toHaveAttribute(
      'src',
      `${base}/raw/${commit}/docs/img/arch.png`,
    )

    // Inside the app, keeping the tree, and scrolling to the heading.
    const tree = screen.getByRole('navigation', {
      name: 'Documents in acme/docs',
    })
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    await user.click(article.getByRole('link', { name: 'Setup' }))

    const heading = await screen.findByRole('heading', { name: 'Step 2' })
    expect(router.state.location.pathname).toBe(
      `/repositories/12/documents/${setup.id}`,
    )
    expect(router.state.location.hash).toBe('#user-content-step-2')
    expect(
      screen.getByRole('navigation', { name: 'Documents in acme/docs' }),
    ).toBe(tree)
    await waitFor(() => expect(scroll.mock.contexts).toContain(heading))
  })

  test('numbers the lines of the raw view', async () => {
    const readme = doc({ content: '# Title\n\nText\n' })
    openDocument([readme], `/repositories/12/documents/${readme.id}?view=raw`)

    const source = await screen.findByRole('region', {
      name: 'Source of README.md',
    })
    // The final newline ends line 3; it does not start a fourth.
    const numbers = source.querySelector('[aria-hidden="true"]')
    expect(numbers?.textContent).toBe('1\n2\n3')
  })

  test('lists the sections of the document on this page', async () => {
    openDocument([
      doc({
        content: [
          '# Guide',
          '## Install',
          '### On `macOS`',
          '#### Too deep',
          '<h2>From HTML</h2>',
          '',
          '## Install',
          'Text[^1]',
          '',
          '[^1]: A note.',
        ].join('\n'),
      }),
    ])

    const article = await findArticle()
    const toc = within(
      await screen.findByRole('navigation', { name: 'On this page' }),
    )
    const links = toc.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Install',
      'On macOS',
      'From HTML',
      'Install',
    ])
    // The ids as rendered, prefixed and made unique by rehype-slug.
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#user-content-install',
      '#user-content-on-macos',
      '#user-content-from-html',
      '#user-content-install-1',
    ])
    for (const link of links) {
      const id = link.getAttribute('href')!.slice(1)
      expect(article.getAllByRole('heading')).toContain(
        document.getElementById(id),
      )
    }
  })

  test('has no table of contents without sections or in the raw view', async () => {
    const plain = doc({ content: '# Only a title\n\nText' })
    const sections = doc({ path: 'docs/a.md', content: '## Section' })
    const { router } = openDocument([plain, sections])
    await findArticle()

    expect(
      screen.queryByRole('navigation', { name: 'On this page' }),
    ).not.toBeInTheDocument()

    await router.navigate(`/repositories/12/documents/${sections.id}`)
    expect(
      await screen.findByRole('navigation', { name: 'On this page' }),
    ).toBeInTheDocument()

    await router.navigate(`/repositories/12/documents/${sections.id}?view=raw`)
    await waitFor(() => expect(rawSource()).toHaveTextContent('## Section'))
    expect(
      screen.queryByRole('navigation', { name: 'On this page' }),
    ).not.toBeInTheDocument()
  })

  test('copies a link to the document and its path', async () => {
    const guide = doc({ path: 'docs/guide.md' })
    const { user } = openDocument(
      [guide],
      `/repositories/12/documents/${guide.id}?view=raw`,
    )
    const clipboard = stubClipboard(() => Promise.resolve())
    const status = await screen.findByRole('status')
    expect(status).toBeEmptyDOMElement()

    await user.click(
      screen.getByRole('button', { name: 'Copy link to this document' }),
    )

    // Absolute, and without the view.
    expect(clipboard.writeText).toHaveBeenLastCalledWith(
      `${window.location.origin}/repositories/12/documents/${guide.id}`,
    )
    expect(status).toHaveTextContent('Link copied')

    await user.click(screen.getByRole('button', { name: 'Copy file path' }))

    expect(clipboard.writeText).toHaveBeenLastCalledWith('docs/guide.md')
    expect(status).toHaveTextContent('Path copied')
  })

  test('clears the copied message after a while', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { user } = openDocument([doc()])
    stubClipboard(() => Promise.resolve())
    await user.click(
      await screen.findByRole('button', { name: 'Copy file path' }),
    )
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Path copied')

    await vi.advanceTimersByTimeAsync(copiedMessageMs - 100)
    expect(status).toHaveTextContent('Path copied')
    await vi.advanceTimersByTimeAsync(100)

    await waitFor(() => expect(status).toBeEmptyDOMElement())
  })

  test.each([
    [
      'refuses the write',
      () => stubClipboard(() => Promise.reject(new Error('denied'))),
    ],
    [
      'has no Clipboard API',
      () =>
        Object.defineProperty(navigator, 'clipboard', {
          value: undefined,
          configurable: true,
        }),
    ],
  ])('says it could not copy when the browser %s', async (_, stub) => {
    const { user } = openDocument([doc()])
    stub()

    await user.click(
      await screen.findByRole('button', { name: 'Copy link to this document' }),
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'Could not copy the link',
    )
  })

  test('sends no request for an ID that is not one', async () => {
    const { api } = openDocument([doc()], '/repositories/12/documents/abc')

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Document not found',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('There is no document at this address.'),
    ).toBeInTheDocument()
    expect(api.detailRequests).toEqual([])
  })

  test('says a document is not found', async () => {
    openDocument([doc()], '/repositories/12/documents/999')

    expect(
      await screen.findByText('The last sync may have removed it.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Document not found' }),
    ).toBeInTheDocument()
  })

  test('links to a document of another repository', async () => {
    const other = doc({ repository_id: 13 })
    openDocument([other])

    expect(
      await screen.findByText(/^This document is in another repository\./),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open it there' })).toHaveAttribute(
      'href',
      `/repositories/13/documents/${other.id}`,
    )
  })

  test.each([[''], ['?view=raw']])(
    'says the document is empty (view %s)',
    async (search) => {
      const empty = doc({ content: '' })
      openDocument([empty], `/repositories/12/documents/${empty.id}${search}`)

      expect(
        await screen.findByText('This document is empty.'),
      ).toBeInTheDocument()
    },
  )

  test('shows a failure to load the document, and retries', async () => {
    const readme = doc({ content: '# Back' })
    const { api, user } = openDocument([readme])
    let fail = true
    server.use(
      http.get(apiUrl('/documents/:id'), () =>
        fail ? errorResponse(500, 'internal', 'Something broke.') : undefined,
      ),
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the document')
    expect(alert).toHaveTextContent('Something broke.')
    fail = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(
      (await findArticle()).getByRole('heading', { name: 'Back' }),
    ).toBeInTheDocument()
    expect(api.detailRequests).toEqual([String(readme.id)])
  })

  test('shows the new content when a sync of the repository succeeds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const readme = doc({ content: '# Old' })
    const { repositories, api } = openDocument([readme])
    update(repositories, 12, { sync_status: 'running' })
    expect(
      (await findArticle()).getByRole('heading', { name: 'Old' }),
    ).toBeInTheDocument()

    api.documents = [{ ...readme, content: '# New' }]
    update(repositories, 12, {
      sync_status: 'ok',
      last_sync_at: '2026-11-25T11:00:00Z',
    })
    await vi.advanceTimersByTimeAsync(fastPollMs)

    expect(
      await screen.findByRole('heading', { name: 'New' }),
    ).toBeInTheDocument()
    expect(api.detailRequests).toHaveLength(2)
  })

  test('says a document a sync removed is not found', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const readme = doc({ content: '# Old' })
    const { repositories, api } = openDocument([readme])
    update(repositories, 12, { sync_status: 'running' })
    await findArticle()

    api.documents = []
    update(repositories, 12, {
      sync_status: 'ok',
      last_sync_at: '2026-11-25T11:00:00Z',
    })
    await vi.advanceTimersByTimeAsync(fastPollMs)

    expect(
      await screen.findByText('The last sync may have removed it.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })
})
