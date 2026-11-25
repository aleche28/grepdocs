import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode, StrictMode } from 'react'
import { createMemoryRouter, type RouteObject } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { createTestQueryClient } from './queryClient.ts'

interface RenderRouteOptions {
  // The route pattern the element is mounted at, such as "/settings/accounts".
  path: string
  element: ReactNode
  // The URL the test starts on, with its query. Defaults to `path`.
  url?: string
  // Other routes, for a test that leaves the page and comes back.
  routes?: RouteObject[]
}

// Renders one page at its route, the way the app would after the auth guard
// let the user through: a memory router instead of the browser's, and a fresh
// QueryClient per test so no cached data leaks between tests. AppLayout is
// left out on purpose, so a page test needs no GET /users/me handler.
//
// Returns the router, to assert on navigation (router.state.location), and a
// userEvent instance, to drive the page.
export function renderRoute({
  path,
  element,
  url = path,
  routes = [],
}: RenderRouteOptions) {
  const queryClient = createTestQueryClient()
  const router = createMemoryRouter([{ path, element }, ...routes], {
    initialEntries: [url],
  })
  const user = userEvent.setup()

  // StrictMode as in main.tsx, so effects run twice here as they do in
  // development.
  const result = render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
  return { ...result, router, queryClient, user }
}
