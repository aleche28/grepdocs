import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

// Shown when rendering a page throws, instead of a blank screen. API errors
// are handled by the pages themselves (#66); this is the last resort.
export function RouteErrorPage() {
  const error = useRouteError()
  console.error(error)

  return (
    <main>
      <h1>Something went wrong</h1>
      {isRouteErrorResponse(error) && (
        <p>
          {error.status} {error.statusText}
        </p>
      )}
      <Link to="/">Go to your repositories</Link>
    </main>
  )
}
