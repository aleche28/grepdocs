import {
  createPath,
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
} from 'react-router'
import {
  isNotAuthenticated,
  loginPath,
  useCurrentUser,
  useLogout,
} from '../api/auth.ts'
import { ApiErrorMessage } from '../components/ApiErrorMessage.tsx'

// The auth guard and app shell for every page under it: nothing renders until
// GET /users/me says who is signed in, and a signed-out user goes to the login
// page, which brings them back here afterwards.
export function AppLayout() {
  const location = useLocation()
  const { data: user, error, refetch } = useCurrentUser()
  const logout = useLogout()

  // Checked before the cached user, which outlives a session that ended.
  if (isNotAuthenticated(error)) {
    return <Navigate to={loginPath(createPath(location))} replace />
  }

  if (!user) {
    // Any other error (API down, 5xx) is not a reason to sign the user out.
    if (error) {
      return (
        <main>
          <ApiErrorMessage
            error={error}
            title="Could not load your session"
            onRetry={() => void refetch()}
          />
        </main>
      )
    }
    return (
      <main>
        <p>Loading…</p>
      </main>
    )
  }

  return (
    <>
      <header className="app-header">
        <Link to="/" className="app-name">
          GrepDocs
        </Link>
        {/* No `end`: a NavLink is also active below its path, so Repositories
            stays highlighted on a repository's documents and the track page. */}
        <nav aria-label="Main">
          <NavLink to="/repositories">Repositories</NavLink>
          <NavLink to="/settings/accounts">Accounts</NavLink>
        </nav>
        <div className="app-user">
          <span>{user.fullname || user.email}</span>
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Sign out
          </button>
        </div>
      </header>
      <main>
        {logout.error && (
          <ApiErrorMessage error={logout.error} title="Could not sign out" />
        )}
        <Outlet />
      </main>
    </>
  )
}
