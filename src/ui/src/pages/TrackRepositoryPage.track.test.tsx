import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw/http'
import { describe, expect, test } from 'vitest'
import { relinkUrl } from '../api/accounts.ts'
import { apiUrl } from '../api/client.ts'
import type { Repository } from '../api/repositories.ts'
import { account } from '../test/accounts.tsx'
import { server } from '../test/server.ts'
import {
  discovered,
  errorResponse,
  mockTrackApi,
  renderTrackPage,
  trackedFrom,
} from '../test/track.tsx'

const docs = discovered('acme/docs')
const handbook = discovered('acme/handbook')

// A page with one account listing docs and handbook. POST /repositories
// answers with `respond`; a 201 adds the repository to what GET
// /repositories returns next, like the real API.
function renderTracking(respond: () => Response | Promise<Response>) {
  const tracked: Repository[] = []
  const bodies: unknown[] = []
  mockTrackApi({
    accounts: [account()],
    tracked: () => tracked,
    repositories: { 3: [docs, handbook] },
  })
  server.use(
    http.post(apiUrl('/repositories'), async ({ request }) => {
      bodies.push(await request.json())
      const response = await respond()
      if (response.status === 201) {
        tracked.push((await response.clone().json()) as Repository)
      }
      return response
    }),
  )
  return { bodies, tracked, ...renderTrackPage() }
}

async function findRow(fullName: string) {
  const link = await screen.findByRole('link', { name: fullName })
  return within(link.closest('li')!)
}

async function clickTrack(
  user: ReturnType<typeof renderTrackPage>['user'],
  fullName: string,
) {
  const row = await findRow(fullName)
  await user.click(row.getByRole('button', { name: `Track ${fullName}` }))
  return row
}

describe('TrackRepositoryPage tracking from the list', () => {
  test('tracks on the default branch and says so', async () => {
    const { bodies, user } = renderTracking(() =>
      HttpResponse.json(trackedFrom(docs), { status: 201 }),
    )

    const row = await clickTrack(user, 'acme/docs')

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Tracking acme/docs on main.')
    expect(
      within(status).getByRole('link', { name: 'View your repositories' }),
    ).toHaveAttribute('href', '/repositories')
    expect(bodies).toEqual([
      { provider: 'github', owner: 'acme', name: 'docs', account_id: 3 },
    ])
    expect(row.getByText('Tracked')).toBeInTheDocument()
    // The button that had focus is gone; the message takes it.
    expect(status.parentElement).toHaveFocus()
  })

  test('names the repository as the API returns it', async () => {
    const { user } = renderTracking(() =>
      HttpResponse.json(
        { ...trackedFrom(docs), full_name: 'acme/documentation' },
        { status: 201 },
      ),
    )

    await clickTrack(user, 'acme/docs')

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Tracking acme/documentation on main.',
    )
  })

  test('disables every Track button while one request runs', async () => {
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const { user } = renderTracking(async () => {
      await released
      return HttpResponse.json(trackedFrom(docs), { status: 201 })
    })

    const row = await clickTrack(user, 'acme/docs')

    const tracking = row.getByRole('button', { name: 'Track acme/docs' })
    expect(tracking).toHaveTextContent('Tracking…')
    expect(tracking).toBeDisabled()
    const other = (await findRow('acme/handbook')).getByRole('button')
    expect(other).toHaveTextContent('Track')
    expect(other).toBeDisabled()

    release()
    expect(await row.findByText('Tracked')).toBeInTheDocument()
    expect(other).toBeEnabled()
  })

  test('the message can be dismissed', async () => {
    const { user } = renderTracking(() =>
      HttpResponse.json(trackedFrom(docs), { status: 201 }),
    )
    await clickTrack(user, 'acme/docs')

    await user.click(await screen.findByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('a new attempt replaces the previous message', async () => {
    let calls = 0
    const { user } = renderTracking(() => {
      calls++
      return calls === 1
        ? errorResponse(500, 'internal', 'Something went wrong')
        : HttpResponse.json(trackedFrom(handbook, 13), { status: 201 })
    })

    await clickTrack(user, 'acme/docs')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not track acme/docs',
    )
    await clickTrack(user, 'acme/handbook')

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Tracking acme/handbook on main.',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('TrackRepositoryPage tracking failures', () => {
  test('already tracked says so and marks the row', async () => {
    const { tracked, user } = renderTracking(() => {
      // Tracked meanwhile, in another tab.
      tracked.push(trackedFrom(docs))
      return errorResponse(409, 'conflict', 'repository already tracked')
    })

    const row = await clickTrack(user, 'acme/docs')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'acme/docs is already tracked.',
    )
    expect(await row.findByText('Tracked')).toBeInTheDocument()
  })

  test('not found with an install_url links to the installation', async () => {
    const { user } = renderTracking(() =>
      errorResponse(404, 'not_found', 'Repository not found', {
        details: { install_url: 'https://github.com/apps/x/installations/new' },
      }),
    )

    await clickTrack(user, 'acme/docs')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      "GitHub can't find acme/docs, or the GitHub App isn't installed on it.",
    )
    expect(
      within(alert).getByRole('link', {
        name: "Manage the GitHub App's repository access",
      }),
    ).toHaveAttribute('href', 'https://github.com/apps/x/installations/new')
  })

  test('not found without an install_url', async () => {
    const { user } = renderTracking(() =>
      errorResponse(404, 'not_found', 'Repository not found'),
    )

    await clickTrack(user, 'acme/docs')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("GitHub can't find acme/docs.")
    expect(within(alert).queryByRole('link')).not.toBeInTheDocument()
  })

  test('forbidden offers a re-link of the account', async () => {
    const { user } = renderTracking(() =>
      errorResponse(403, 'forbidden', 'Invalid or expired token'),
    )

    await clickTrack(user, 'acme/docs')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'GitHub no longer accepts the access of @octocat.',
    )
    expect(
      within(alert).getByRole('link', { name: 'Re-link @octocat' }),
    ).toHaveAttribute('href', relinkUrl('github', 3))
  })

  test('rate_limited says how long to wait', async () => {
    const { user } = renderTracking(() =>
      errorResponse(429, 'rate_limited', 'Rate limit exceeded', {
        headers: { 'Retry-After': '30' },
      }),
    )

    await clickTrack(user, 'acme/docs')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "GitHub's rate limit was reached. Try again in a minute.",
    )
  })

  test('any other error shows its message', async () => {
    const { user } = renderTracking(() =>
      errorResponse(500, 'internal', 'Something went wrong'),
    )

    const row = await clickTrack(user, 'acme/docs')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not track acme/docs')
    expect(alert).toHaveTextContent('Something went wrong')
    await waitFor(() =>
      expect(
        row.getByRole('button', { name: 'Track acme/docs' }),
      ).toBeEnabled(),
    )
  })
})
