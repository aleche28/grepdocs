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

  return (
    <main>
      <h1>Sign in to GrepDocs</h1>
      <a href={googleLoginUrl(redirect)}>Sign in with Google</a>
    </main>
  )
}
