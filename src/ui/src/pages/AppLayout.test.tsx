import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw/http'
import { Outlet } from 'react-router'
import { describe, expect, test } from 'vitest'
import type { User } from '../api/auth.ts'
import { apiUrl } from '../api/client.ts'
import { renderRoute } from '../test/renderRoute.tsx'
import { server } from '../test/server.ts'
import { AppLayout, type LayoutHandle } from './AppLayout.tsx'

const ada: User = {
  id: 1,
  fullname: 'Ada Lovelace',
  username: '',
  email: 'ada@example.com',
  created_at: null,
}

function renderLayout(user: User = ada) {
  server.use(http.get(apiUrl('/users/me'), () => HttpResponse.json(user)))
  return renderRoute({
    path: '/',
    element: <AppLayout />,
    children: [{ index: true, element: <p>Home</p> }],
    routes: [{ path: '/login', element: <p>Login page</p> }],
  })
}

describe('AppLayout user menu', () => {
  test('shows the signed-in user and opens on click', async () => {
    const { user } = renderLayout()

    const trigger = await screen.findByRole('button', { name: 'Ada Lovelace' })
    expect(trigger).toHaveTextContent('AL')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()

    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const panel = document.getElementById(
      trigger.getAttribute('aria-controls')!,
    )!
    expect(panel).toHaveTextContent('ada@example.com')
    expect(
      within(panel).getByRole('button', { name: 'Sign out' }),
    ).toBeVisible()
  })

  test('closes on Esc and gives focus back to the button', async () => {
    const { user } = renderLayout()
    const trigger = await screen.findByRole('button', { name: 'Ada Lovelace' })

    await user.click(trigger)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  test('closes on a click outside it', async () => {
    const { user } = renderLayout()
    await user.click(
      await screen.findByRole('button', { name: 'Ada Lovelace' }),
    )

    await user.click(screen.getByText('Home'))

    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  test('signs out and goes to the login page', async () => {
    let loggedOut = false
    server.use(
      http.post(apiUrl('/auth/logout'), () => {
        loggedOut = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const { user, router } = renderLayout()

    await user.click(
      await screen.findByRole('button', { name: 'Ada Lovelace' }),
    )
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByText('Login page')).toBeVisible()
    expect(loggedOut).toBe(true)
    expect(router.state.location.pathname).toBe('/login')
  })

  test('falls back to the email for a user without a name', async () => {
    const { user } = renderLayout({ ...ada, fullname: '' })

    const trigger = await screen.findByRole('button', {
      name: 'ada@example.com',
    })
    expect(trigger).toHaveTextContent('A')
    await user.click(trigger)

    await waitFor(() =>
      expect(
        screen.getAllByText('ada@example.com').map((el) => el.tagName),
      ).toContain('STRONG'),
    )
  })
})

describe('AppLayout docs layout', () => {
  function renderAt(url: string) {
    server.use(http.get(apiUrl('/users/me'), () => HttpResponse.json(ada)))
    return renderRoute({
      path: '/',
      element: <AppLayout />,
      children: [
        { path: 'list', element: <p>List</p> },
        {
          path: 'docs',
          element: <Outlet />,
          handle: { layout: 'docs' } satisfies LayoutHandle,
          children: [{ path: 'page', element: <p>Docs page</p> }],
        },
      ],
      url,
    })
  }

  test('keeps the width cap on a page that does not ask for the layout', async () => {
    renderAt('/list')

    expect(await screen.findByText('List')).toBeInTheDocument()
    expect(screen.getByRole('main')).not.toHaveClass('docs')
    expect(screen.getByRole('banner')).not.toHaveClass('sticky')
  })

  test('drops the width cap below a route that asks for it', async () => {
    renderAt('/docs/page')

    expect(await screen.findByText('Docs page')).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('docs')
    expect(screen.getByRole('banner')).toHaveClass('sticky')
  })
})
