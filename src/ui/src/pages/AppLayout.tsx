import { createPath, Navigate, Outlet, useLocation } from 'react-router'
import {
  isNotAuthenticated,
  loginPath,
  useCurrentUser,
  useLogout,
} from '../api/auth.ts'

// The auth guard for every page under it: nothing renders until
// GET /users/me says who is signed in, and a signed-out user goes to the login
// page, which brings them back here afterwards. The navigation shell (#66)
// replaces the minimal header.
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
          <p role="alert">Could not load your session: {error.message}</p>
          <button type="button" onClick={() => void refetch()}>
            Try again
          </button>
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
      <header>
        <span>{user.fullname || user.email}</span>{' '}
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          Sign out
        </button>
        {logout.error && (
          <p role="alert">Could not sign out: {logout.error.message}</p>
        )}
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}
