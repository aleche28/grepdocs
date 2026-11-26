import { FileSearch, LogIn } from 'lucide-react'
import { Navigate, useSearchParams } from 'react-router'
import {
  googleLoginUrl,
  safeRedirectPath,
  useCurrentUser,
} from '../api/auth.ts'

// ?redirect= is the page the auth guard sent the user away from.
export function LoginPage() {
  const [searchParams] = useSearchParams()
  const redirect = safeRedirectPath(searchParams.get('redirect'))
  const { isSuccess } = useCurrentUser()

  // Already signed in, e.g. a bookmarked /login or the back button. Not
  // `data`: when a session expires, the failed refetch keeps the previous
  // user in `data`, and bouncing on it would loop with the auth guard.
  if (isSuccess) {
    return <Navigate to={redirect} replace />
  }

  // Outside AppLayout, so there is no app shell: the page is one card.
  return (
    <main className="login">
      <div className="login-card">
        <p className="login-brand">
          <span className="app-mark">
            <FileSearch size={14} strokeWidth={2.2} />
          </span>
          GrepDocs
        </p>
        <h1>Sign in to GrepDocs</h1>
        <p className="login-lede">
          Browse and edit the Markdown documentation across your git
          repositories.
        </p>
        <a href={googleLoginUrl(redirect)} className="button primary">
          <LogIn size={15} />
          Sign in with Google
        </a>
        {redirect !== '/' && (
          <p className="login-note">
            You'll come back to the page you were on.
          </p>
        )}
      </div>
    </main>
  )
}
