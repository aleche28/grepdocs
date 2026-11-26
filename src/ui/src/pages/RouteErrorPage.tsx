import { TriangleAlert } from 'lucide-react'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

// Shown when rendering a page throws, instead of a blank screen. API errors
// are shown by the pages themselves, with ApiErrorMessage; this is the last
// resort. It replaces AppLayout, so there is no app shell.
export function RouteErrorPage() {
  const error = useRouteError()
  console.error(error)

  return (
    <main>
      <div className="empty-state">
        <span className="empty-icon">
          <TriangleAlert size={20} />
        </span>
        <h1>Something went wrong</h1>
        <p>
          This page could not be shown. Reload it, or start again from your
          repositories.
        </p>
        {isRouteErrorResponse(error) && (
          <p>
            <code>
              {error.status} {error.statusText}
            </code>
          </p>
        )}
        <Link to="/" className="button">
          Go to your repositories
        </Link>
      </div>
    </main>
  )
}
