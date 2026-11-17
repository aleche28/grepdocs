import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { apiFetch, ApiError, apiUrl } from './client.ts'

// GET /users/me.
export interface User {
  id: number
  fullname: string
  username: string
  email: string
  created_at: string | null
}

// The signed-in user. The auth guard, the login page and the app shell all
// read this one query, and queryClient.ts refetches it when any other request
// comes back not_authenticated.
export const meQueryKey = ['users', 'me'] as const

export function useCurrentUser() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async () => {
      try {
        return await apiFetch<User>('/users/me')
      } catch (err) {
        // A session whose user was deleted answers 404: as far as the UI is
        // concerned, nobody is signed in.
        if (err instanceof ApiError && err.code === 'not_found') {
          throw new ApiError(401, 'not_authenticated', err.message)
        }
        throw err
      }
    },
  })
}

export function isNotAuthenticated(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'not_authenticated'
}

// Ends the session, then drops every cached query so the next person in this
// tab does not see the previous user's data.
export function useLogout() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  return useMutation({
    mutationFn: () => apiFetch<void>('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      // flushSync commits the navigation now. Router updates are transitions
      // by default, so the mutation's own state update would re-render the
      // guard first, on an empty cache: it would refetch /users/me and send
      // the user to /login?redirect=… instead.
      queryClient.clear()
      void navigate('/login', { replace: true, flushSync: true })
    },
  })
}

// The login page for a user who was on `from` (a path with its query and
// hash), so they land back there after signing in.
export function loginPath(from: string): string {
  if (from === '/') {
    return '/login'
  }
  return `/login?${new URLSearchParams({ redirect: from })}`
}

// Starts Google sign-in. It is a link, not an apiFetch call: the API answers
// with a redirect to Google, which only a full-page navigation can follow.
export function googleLoginUrl(redirect: string): string {
  const url = apiUrl('/auth/google/login')
  if (redirect === '/') {
    return url
  }
  return `${url}?${new URLSearchParams({ redirect })}`
}

// Returns value when it is a path on this origin, or "/" otherwise. The API
// checks the path it redirects to as well; this check guards the client-side
// navigation the login page does for a user who is already signed in.
// Parsing with URL catches what a prefix check would miss: browsers read
// "/\evil.com" and "/\t/evil.com" as "//evil.com", another origin.
export function safeRedirectPath(value: string | null): string {
  if (!value?.startsWith('/')) {
    return '/'
  }
  const url = new URL(value, window.location.origin)
  // Dot segments are resolved after parsing: "/.//evil.com" keeps this
  // origin but has the pathname "//evil.com", which history would read as
  // another origin again.
  if (url.origin !== window.location.origin || url.pathname.startsWith('//')) {
    return '/'
  }
  return url.pathname + url.search + url.hash
}
