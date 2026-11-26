import { screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { renderRoute } from '../test/renderRoute.tsx'
import { RouteErrorPage } from './RouteErrorPage.tsx'

describe('RouteErrorPage', () => {
  function Broken(): never {
    throw new Error('render failed')
  }

  test('replaces a page that throws, with the way back', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderRoute({
      path: '/',
      element: <p>Home</p>,
      url: '/broken',
      routes: [
        {
          path: '/broken',
          element: <Broken />,
          errorElement: <RouteErrorPage />,
        },
      ],
    })

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Something went wrong',
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Go to your repositories' }),
    ).toHaveAttribute('href', '/')
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  test('shows the status of an error response', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderRoute({
      path: '/',
      element: <p>Home</p>,
      url: '/gone',
      routes: [
        {
          path: '/gone',
          loader: () => {
            throw new Response(null, { status: 404, statusText: 'Not Found' })
          },
          element: <p>Never</p>,
          errorElement: <RouteErrorPage />,
        },
      ],
    })

    expect(await screen.findByText('404 Not Found')).toBeInTheDocument()
    consoleError.mockRestore()
  })
})
