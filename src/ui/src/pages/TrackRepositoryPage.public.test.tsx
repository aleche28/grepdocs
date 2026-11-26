import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw/http'
import { describe, expect, test } from 'vitest'
import { apiUrl } from '../api/client.ts'
import { account } from '../test/accounts.tsx'
import { errorResponse } from '../test/helpers.ts'
import { server } from '../test/server.ts'
import {
  discovered,
  mockTrackApi,
  renderTrackPage,
  trackedFrom,
} from '../test/track.tsx'

const docs = discovered('acme/docs')

// A page whose public form answers POST /repositories with `respond`.
// Without `respond`, no POST is declared, so sending one fails the test.
function renderPublic({
  respond,
  withAccount = false,
}: {
  respond?: () => Response | Promise<Response>
  withAccount?: boolean
} = {}) {
  const bodies: unknown[] = []
  mockTrackApi(
    withAccount
      ? { accounts: [account()], repositories: { 3: [docs] } }
      : { accounts: [] },
  )
  if (respond) {
    server.use(
      http.post(apiUrl('/repositories'), async ({ request }) => {
        bodies.push(await request.json())
        return respond()
      }),
    )
  }
  return { bodies, ...renderTrackPage() }
}

const hint =
  "Read without an account. A private repository must come from a linked account's list."

async function findForm() {
  const section = within(
    await screen.findByRole('region', { name: 'A public repository' }),
  )
  return {
    field: section.getByRole('textbox', { name: 'Public GitHub repository' }),
    button: section.getByRole('button', { name: /Track/ }),
  }
}

describe('TrackRepositoryPage public repository', () => {
  test('tracks by owner/name without an account', async () => {
    const { bodies, user } = renderPublic({
      respond: () =>
        HttpResponse.json(trackedFrom(docs, 12, null), { status: 201 }),
    })
    const { field, button } = await findForm()

    await user.type(field, ' acme/docs ')
    await user.click(button)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Tracking acme/docs on main.',
    )
    expect(bodies).toEqual([
      { provider: 'github', owner: 'acme', name: 'docs' },
    ])
    expect(field).toHaveValue('')
  })

  test('submits with Enter', async () => {
    const { bodies, user } = renderPublic({
      respond: () =>
        HttpResponse.json(trackedFrom(docs, 12, null), { status: 201 }),
    })
    const { field } = await findForm()

    await user.type(field, 'acme/docs{Enter}')

    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(bodies).toHaveLength(1)
  })

  test('refuses anything but owner/name before any request', async () => {
    const { user } = renderPublic()
    const { field, button } = await findForm()

    await user.type(field, 'https://github.com/acme/docs')
    await user.click(button)

    expect(
      screen.getByText('Enter the repository as owner/name.'),
    ).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    // The error first, then the hint.
    expect(field).toHaveAccessibleDescription(
      `Enter the repository as owner/name. ${hint}`,
    )

    await user.type(field, 'x')
    expect(
      screen.queryByText('Enter the repository as owner/name.'),
    ).not.toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'false')
    expect(field).toHaveAccessibleDescription(hint)
  })

  test('says what the field reads, as its description', async () => {
    renderPublic()
    const { field } = await findForm()

    expect(field).toHaveAccessibleDescription(hint)
    expect(field).not.toHaveAttribute('aria-invalid', 'true')
  })

  test('an empty field is refused too', async () => {
    const { user } = renderPublic()
    const { button } = await findForm()

    await user.click(button)

    expect(
      screen.getByText('Enter the repository as owner/name.'),
    ).toBeInTheDocument()
  })

  test('explains a repository that is missing or private', async () => {
    const { user } = renderPublic({
      respond: () => errorResponse(404, 'not_found', 'Repository not found'),
    })
    const { field, button } = await findForm()

    await user.type(field, 'acme/secret')
    await user.click(button)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No public repository acme/secret on GitHub. For a private one, link an account that can see it and pick it from the list.',
    )
    // Kept, to fix a typo.
    expect(field).toHaveValue('acme/secret')
  })

  test('says how long to wait on a rate limit', async () => {
    const { user } = renderPublic({
      respond: () =>
        errorResponse(429, 'rate_limited', 'Rate limit exceeded', {
          headers: { 'Retry-After': '600' },
        }),
    })
    const { field, button } = await findForm()

    await user.type(field, 'acme/docs')
    await user.click(button)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "GitHub's rate limit was reached. Try again in 10 minutes.",
    )
  })

  test('a request from the form disables the list, and the other way round', async () => {
    let release!: () => void
    const released = new Promise<void>((resolve) => {
      release = resolve
    })
    const { user } = renderPublic({
      withAccount: true,
      respond: async () => {
        await released
        return HttpResponse.json(trackedFrom(docs, 12, null), { status: 201 })
      },
    })
    const listButton = await screen.findByRole('button', {
      name: 'Track acme/docs',
    })
    const { field, button } = await findForm()

    await user.type(field, 'acme/docs')
    await user.click(button)

    expect(button).toHaveTextContent('Tracking…')
    expect(button).toBeDisabled()
    // Disabled, but not the one being tracked.
    expect(listButton).toHaveTextContent('Track')
    expect(listButton).toBeDisabled()

    release()
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(button).toHaveTextContent('Track')
    expect(button).toBeEnabled()
  })
})
