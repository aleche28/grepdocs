import {
  createPath,
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useMatches,
} from 'react-router'
import { ChevronDown, FileSearch, LoaderCircle, LogOut } from 'lucide-react'
import {
  isNotAuthenticated,
  loginPath,
  type User,
  useCurrentUser,
  useLogout,
} from '../api/auth.ts'
import { ApiErrorMessage } from '../components/ApiErrorMessage.tsx'
import { Menu } from '../components/Menu.tsx'

// What a route under AppLayout can set in its `handle` (router.tsx).
export interface LayoutHandle {
  // 'docs': the page fills the window below the header, without <main>'s
  // width cap and padding, and the header stays on screen (RepositoryPage's
  // sidebar and table of contents stick below it).
  layout?: 'docs'
}

// Whether the deepest route that sets a layout asks for the docs layout.
function useDocsLayout(): boolean {
  const matches = useMatches()
  const layout = matches
    .map((match) => (match.handle as LayoutHandle | undefined)?.layout)
    .findLast((value) => value !== undefined)
  return layout === 'docs'
}

// The auth guard and app shell for every page under it: nothing renders until
// GET /users/me says who is signed in, and a signed-out user goes to the login
// page, which brings them back here afterwards.
export function AppLayout() {
  const location = useLocation()
  const { data: user, error, refetch } = useCurrentUser()
  const logout = useLogout()
  const docsLayout = useDocsLayout()

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
        <div className="empty-state loading">
          <LoaderCircle className="spin" size={16} />
          <p>Loading…</p>
        </div>
      </main>
    )
  }

  const name = user.fullname || user.email

  return (
    <>
      <header className={docsLayout ? 'app-header sticky' : 'app-header'}>
        <Link to="/" className="app-name">
          <span className="app-mark">
            <FileSearch size={14} strokeWidth={2.2} />
          </span>
          GrepDocs
        </Link>
        {/* No `end`: a NavLink is also active below its path, so Repositories
            stays highlighted on a repository's documents and the track page. */}
        <nav aria-label="Main" className="app-nav">
          <NavLink to="/repositories">Repositories</NavLink>
          <NavLink to="/settings/accounts">Accounts</NavLink>
        </nav>
        <div className="app-user">
          <Menu
            triggerClassName="user-button"
            trigger={
              <>
                <span className="avatar" aria-hidden="true">
                  {initials(user)}
                </span>
                <span className="user-name">{name}</span>
                <ChevronDown size={14} />
              </>
            }
          >
            <div className="menu-header">
              <strong>{name}</strong>
              {user.fullname && <span className="muted">{user.email}</span>}
            </div>
            <div className="menu-separator" />
            <button
              type="button"
              className="menu-item"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              <LogOut size={15} />
              Sign out
            </button>
          </Menu>
        </div>
      </header>
      <main className={docsLayout ? 'docs' : undefined}>
        {logout.error && (
          <ApiErrorMessage error={logout.error} title="Could not sign out" />
        )}
        <Outlet />
      </main>
    </>
  )
}

// Up to two letters for the avatar: the first and last word of the name, or
// the start of the email when there is no name.
function initials(user: Pick<User, 'fullname' | 'email'>): string {
  const words = user.fullname.trim().split(/\s+/).filter(Boolean)
  const letters =
    words.length === 0
      ? [user.email]
      : words.length === 1
        ? [words[0]]
        : [words[0], words[words.length - 1]]
  return letters
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase()
}
