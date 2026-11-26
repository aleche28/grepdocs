import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw/http'
import { describe, expect, test } from 'vitest'
import { meQueryKey, type User } from '../api/auth.ts'
import { ApiError, apiUrl } from '../api/client.ts'
import { errorResponse } from '../test/helpers.ts'
import { createTestQueryClient } from '../test/queryClient.ts'
import { renderRoute } from '../test/renderRoute.tsx'
import { server } from '../test/server.ts'
import { LoginPage } from './LoginPage.tsx'

const ada: User = {
  id: 1,
  fullname: 'Ada Lovelace',
  username: '',
  email: 'ada@example.com',
  created_at: null,
}

const note = "You'll come back to the page you were on."

function signedOut() {
  server.use(
    http.get(apiUrl('/users/me'), () =>
      errorResponse(401, 'not_authenticated', 'Not signed in'),
    ),
  )
}

function renderLogin(url = '/login', queryClient = createTestQueryClient()) {
  return renderRoute({
    path: '/login',
    element: <LoginPage />,
    url,
    queryClient,
    routes: [
      { path: '/', element: <p>Home</p> },
      { path: '/repositories/:id', element: <p>Repository</p> },
    ],
  })
}

describe('LoginPage', () => {
  test('signs in with Google, before the session check ends', async () => {
    server.use(
      http.get(apiUrl('/users/me'), () => new Promise<Response>(() => {})),
    )
    renderLogin()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Sign in to GrepDocs' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Sign in with Google' }),
    ).toHaveAttribute('href', '/api/auth/google/login')
    expect(screen.queryByText(note)).not.toBeInTheDocument()
  })

  test('passes the page the user came from on to the sign-in', async () => {
    signedOut()
    renderLogin(
      `/login?${new URLSearchParams({ redirect: '/repositories/12?view=raw' })}`,
    )

    expect(
      screen.getByRole('link', { name: 'Sign in with Google' }),
    ).toHaveAttribute(
      'href',
      `/api/auth/google/login?${new URLSearchParams({ redirect: '/repositories/12?view=raw' })}`,
    )
    expect(screen.getByText(note)).toBeInTheDocument()
  })

  test('drops a redirect to another site', async () => {
    signedOut()
    renderLogin('/login?redirect=//evil.example')

    expect(
      screen.getByRole('link', { name: 'Sign in with Google' }),
    ).toHaveAttribute('href', '/api/auth/google/login')
    expect(screen.queryByText(note)).not.toBeInTheDocument()
  })

  test('sends a signed-in user on to the redirect', async () => {
    server.use(http.get(apiUrl('/users/me'), () => HttpResponse.json(ada)))
    const { router } = renderLogin('/login?redirect=/repositories/12')

    expect(await screen.findByText('Repository')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/repositories/12')
  })

  test('sends a signed-in user home without a redirect', async () => {
    server.use(http.get(apiUrl('/users/me'), () => HttpResponse.json(ada)))
    const { router } = renderLogin()

    expect(await screen.findByText('Home')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  // The failed refetch keeps the previous user in `data`: bouncing on it
  // would loop with the auth guard.
  test('stays for a session that expired, though the user is cached', async () => {
    signedOut()
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(meQueryKey, ada)
    queryClient
      .getQueryCache()
      .find({ queryKey: meQueryKey })!
      .setState({
        status: 'error',
        error: new ApiError(401, 'not_authenticated', 'Not signed in'),
      })
    const { router } = renderLogin(
      '/login?redirect=/repositories/12',
      queryClient,
    )

    expect(
      await screen.findByRole('link', { name: 'Sign in with Google' }),
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(queryClient.getQueryData(meQueryKey)).toEqual(ada)
  })
})
